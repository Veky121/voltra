package panel

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

var subdomainLabel = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$`)

func subdomainName(raw string) (string, error) {
	name := strings.ToLower(strings.TrimSuffix(strings.TrimSpace(raw), "."))
	if len(name) > 180 || !strings.Contains(name, ".") || net.ParseIP(name) != nil {
		return "", bad("Enter a domain such as njimgang.org.")
	}
	for _, label := range strings.Split(name, ".") {
		if !subdomainLabel.MatchString(label) {
			return "", bad("Use valid DNS labels without wildcards, ports or paths.")
		}
	}
	return name, nil
}
func subdomainHostname(label, domain string) string { return "play." + label + "." + domain }
func subdomainKey(id int64) string                  { return "network.subdomain_gateway." + strconv.FormatInt(id, 10) }
func errorsIsNoRows(err error) bool                 { return errors.Is(err, pgx.ErrNoRows) }
func (a *App) registerSubdomains(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/admin/proxy-gateways/{gateway}/subdomains", a.subdomainGateway)
	mux.HandleFunc("PUT /api/admin/proxy-gateways/{gateway}/subdomains", a.subdomainGateway)
	mux.HandleFunc("GET /api/client/servers/{server}/subdomain", a.subdomainServer)
	mux.HandleFunc("PUT /api/client/servers/{server}/subdomain", a.subdomainServer)
	mux.HandleFunc("DELETE /api/client/servers/{server}/subdomain", a.subdomainServer)
	mux.HandleFunc("POST /api/client/servers/{server}/subdomain/retry", a.subdomainRetry)
}
func (a *App) subdomainConfig(ctx context.Context, id int64) (M, error) {
	row, err := a.one(ctx, "SELECT value FROM settings WHERE key=$1", subdomainKey(id))
	if errorsIsNoRows(err) {
		return M{}, nil
	}
	if err != nil {
		return nil, err
	}
	return asMap(row["value"]), nil
}
func (a *App) subdomainDomain(ctx context.Context, id int64) (string, error) {
	config, err := a.subdomainConfig(ctx, id)
	return str(config["domain"]), err
}
func (a *App) subdomainGateway(w http.ResponseWriter, r *http.Request) {
	if _, err := a.requireAdmin(r); err != nil {
		fail(w, err)
		return
	}
	id := proxyID(r, "gateway")
	gateway, err := a.one(r.Context(), "SELECT id,public_host FROM proxy_gateways WHERE id=$1", id)
	if err != nil {
		fail(w, err)
		return
	}
	if r.Method == "PUT" {
		input, e := decode(r)
		if e != nil {
			fail(w, e)
			return
		}
		domain, e := subdomainName(str(input["domain"]))
		if e != nil {
			fail(w, e)
			return
		}
		integration, e := a.one(r.Context(), "SELECT * FROM integrations WHERE id=$1 AND provider='cloudflare' AND enabled AND egg_id IS NULL", num(input["integration_id"]))
		if e != nil {
			fail(w, bad("Choose an enabled global Cloudflare integration."))
			return
		}
		credentials, e := a.integrationCredentials(integration)
		if e != nil {
			fail(w, e)
			return
		}
		check, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		zone, e := a.subdomainCF(check, credentials, "GET", "", nil)
		cancel()
		if e != nil {
			fail(w, e)
			return
		}
		zoneName := str(asMap(zone["result"])["name"])
		if zoneName == "" || (domain != zoneName && !strings.HasSuffix(domain, "."+zoneName)) {
			fail(w, bad("The domain must belong to the integration's Cloudflare zone."))
			return
		}
		if _, e = subdomainRecord(subdomainHostname("check", domain), str(gateway["public_host"]), "check"); e != nil {
			fail(w, e)
			return
		}
		raw, _ := json.Marshal(M{"domain": domain, "integration_id": integration["id"]})
		if e = a.exec(r.Context(), "INSERT INTO settings(key,value) VALUES($1,$2::jsonb) ON CONFLICT(key) DO UPDATE SET value=excluded.value", subdomainKey(id), string(raw)); e != nil {
			fail(w, e)
			return
		}
		_ = a.audit(r.Context(), UserID(r), 0, "proxy:subdomain-domain", M{"gateway_id": id, "domain": domain})
	}
	config, err := a.subdomainConfig(r.Context(), id)
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, 200, item("subdomain_gateway", M{"domain": config["domain"], "integration_id": config["integration_id"], "target": gateway["public_host"]}))
}

type subdomainLookup func(context.Context, string) ([]net.IPAddr, error)

func subdomainDNS(parent context.Context, name, target string, lookup subdomainLookup) (bool, string) {
	ctx, cancel := context.WithTimeout(parent, 3*time.Second)
	defer cancel()
	expected, err := lookup(ctx, target)
	if err != nil || len(expected) == 0 {
		return false, "Gateway DNS could not be resolved."
	}
	actual, err := lookup(ctx, name)
	if err != nil || len(actual) == 0 {
		return false, "DNS is pending or the record is missing."
	}
	allowed := map[string]bool{}
	for _, addr := range expected {
		if addr.IP.IsGlobalUnicast() && !addr.IP.IsPrivate() {
			allowed[addr.IP.String()] = true
		}
	}
	if len(allowed) == 0 {
		return false, "The gateway needs a public address."
	}
	for _, addr := range actual {
		if !allowed[addr.IP.String()] {
			return false, "DNS does not match the public gateway. Check A, AAAA and CNAME records; use DNS only on Cloudflare."
		}
	}
	return true, "DNS matches the gateway. Game connectivity has not been tested."
}
func (a *App) subdomainRetry(w http.ResponseWriter, r *http.Request) {
	server, err := a.server(r, "allocation.update")
	if err != nil {
		fail(w, err)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	_ = a.reconcileSubdomains(ctx, num(server["id"]))
	a.subdomainServer(w, r.Clone(r.Context()))
}
func (a *App) subdomainServer(w http.ResponseWriter, r *http.Request) {
	permission := "allocation.read"
	if r.Method == "PUT" || r.Method == "DELETE" {
		permission = "allocation.update"
	}
	server, err := a.server(r, permission)
	if err != nil {
		fail(w, err)
		return
	}
	ctx := r.Context()
	sid := num(server["id"])
	routes, err := a.query(ctx, `SELECT r.id,r.gateway_id,r.public_port,r.protocol,r.status,g.public_host FROM proxy_routes r JOIN proxy_gateways g ON g.id=r.gateway_id WHERE r.server_id=$1 AND r.allocation_id=$2 AND r.desired_present ORDER BY r.id`, sid, num(server["allocation_id"]))
	if err != nil {
		fail(w, err)
		return
	}
	choices := []M{}
	for _, route := range routes {
		config, e := a.subdomainConfig(ctx, num(route["gateway_id"]))
		if e != nil {
			fail(w, e)
			return
		}
		if str(config["domain"]) != "" && num(config["integration_id"]) > 0 {
			route["domain"] = config["domain"]
			route["integration_id"] = config["integration_id"]
			choices = append(choices, route)
		}
	}
	if r.Method == "PUT" || r.Method == "DELETE" {
		var chosen M
		var label, hostname string
		if r.Method == "PUT" {
			input, e := decode(r)
			if e != nil {
				fail(w, e)
				return
			}
			label = strings.ToLower(strings.TrimSpace(str(input["label"])))
			if label != "" {
				if !subdomainLabel.MatchString(label) {
					fail(w, bad("Use 1-63 letters, numbers or hyphens; start and end with a letter or number."))
					return
				}
				for _, choice := range choices {
					if num(choice["id"]) == num(input["route_id"]) {
						chosen = choice
						break
					}
				}
				if chosen == nil {
					fail(w, bad("Choose a primary FRP route with managed DNS configured."))
					return
				}
				hostname = subdomainHostname(label, str(chosen["domain"]))
			}
		}
		release, e := a.serverDeleteMutationLock(ctx, server)
		if e != nil {
			fail(w, e)
			return
		}
		defer release()
		tx, e := a.DB.Begin(ctx)
		if e != nil {
			fail(w, e)
			return
		}
		defer tx.Rollback(ctx)
		if _, e = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtextextended(current_schema()||'voltra-subdomains',0))"); e != nil {
			fail(w, e)
			return
		}
		var existing M
		if hostname != "" {
			var raw []byte
			e = tx.QueryRow(ctx, "SELECT value FROM settings WHERE key=$1", "network.subdomain_name."+hostname).Scan(&raw)
			if e != nil && !errorsIsNoRows(e) {
				fail(w, e)
				return
			}
			if e == nil {
				if e = json.Unmarshal(raw, &existing); e != nil {
					fail(w, e)
					return
				}
				if num(existing["server_id"]) != sid {
					fail(w, proxyConflict("That join name is reserved or awaiting DNS cleanup. Choose another name."))
					return
				}
			}
			var present bool
			e = tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM proxy_routes r JOIN servers s ON s.id=r.server_id WHERE r.id=$1 AND r.server_id=$2 AND r.allocation_id=s.allocation_id AND r.desired_present)", num(chosen["id"]), sid).Scan(&present)
			if e != nil {
				fail(w, e)
				return
			}
			if !present {
				fail(w, proxyConflict("The FRP route changed. Refresh and try again."))
				return
			}
		}
		if _, e = tx.Exec(ctx, `UPDATE settings SET value=value||'{"desired":false,"status":"cleanup_pending"}'::jsonb WHERE starts_with(key,'network.subdomain_name.') AND value->>'server_id'=$1`, strconv.FormatInt(sid, 10)); e != nil {
			fail(w, e)
			return
		}
		if hostname != "" {
			integration, e := a.one(ctx, "SELECT * FROM integrations WHERE id=$1 AND provider='cloudflare' AND enabled AND egg_id IS NULL", num(chosen["integration_id"]))
			if e != nil {
				fail(w, bad("The Cloudflare integration is unavailable."))
				return
			}
			if existing != nil && str(existing["owner"]) != "" && str(existing["credentials"]) != str(integration["credentials"]) {
				oldCredentials, oldErr := a.integrationCredentials(M{"credentials": existing["credentials"]})
				newCredentials, newErr := a.integrationCredentials(integration)
				if oldErr != nil || newErr != nil || str(oldCredentials["zone_id"]) != str(newCredentials["zone_id"]) {
					fail(w, proxyConflict("Clear this join name before changing its DNS zone."))
					return
				}
			}
			owner := str(existing["owner"])
			if owner == "" {
				owner = "voltra:" + newUUID()
			}
			job := M{"server_id": sid, "hostname": hostname, "label": label, "gateway_id": chosen["gateway_id"], "route_id": chosen["id"], "integration_id": integration["id"], "credentials": integration["credentials"], "owner": owner, "desired": true, "status": "pending"}
			raw, _ := json.Marshal(job)
			if _, e = tx.Exec(ctx, "INSERT INTO settings(key,value) VALUES($1,$2::jsonb) ON CONFLICT(key) DO UPDATE SET value=excluded.value", "network.subdomain_name."+hostname, string(raw)); e != nil {
				fail(w, e)
				return
			}
		}
		if e = tx.Commit(ctx); e != nil {
			fail(w, e)
			return
		}
		_ = a.audit(ctx, UserID(r), sid, "server:subdomain", M{"hostname": hostname})
		op, cancel := context.WithTimeout(ctx, 20*time.Second)
		_ = a.reconcileSubdomains(op, sid)
		cancel()
	}
	saved, err := a.query(ctx, `SELECT value FROM settings WHERE starts_with(key,'network.subdomain_name.') AND value->>'server_id'=$1 ORDER BY (value->>'desired') DESC,key`, strconv.FormatInt(sid, 10))
	if err != nil {
		fail(w, err)
		return
	}
	out := M{"choices": choices, "hostname": "", "label": "", "dns_matches": false, "detail": "Leave Join name empty to keep domains disabled.", "cleanup_pending": false}
	for _, record := range saved {
		job := asMap(record["value"])
		if !boolean(job["desired"]) {
			out["cleanup_pending"] = true
			continue
		}
		out["hostname"] = job["hostname"]
		out["label"] = job["label"]
		out["dns_status"] = job["status"]
		out["detail"] = job["detail"]
		for _, route := range choices {
			if num(route["id"]) == num(job["route_id"]) && str(job["hostname"]) == subdomainHostname(str(job["label"]), str(route["domain"])) {
				out["route"] = route
				if str(job["status"]) == "applied" {
					out["dns_matches"], out["detail"] = subdomainDNS(ctx, str(job["hostname"]), str(route["public_host"]), net.DefaultResolver.LookupIPAddr)
				}
				break
			}
		}
	}
	writeJSON(w, 200, item("server_subdomain", out))
}
