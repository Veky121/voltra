package panel

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
)

var subdomainCFID = regexp.MustCompile(`^[a-fA-F0-9]{32}$`)

// Only Voltra-owned records are changed. The durable ownership comment also
// recovers a successful create whose response was lost before a panel restart.
func (a *App) subdomainCF(ctx context.Context, credentials M, method, path string, body any) (M, error) {
	zone := str(credentials["zone_id"])
	if !subdomainCFID.MatchString(zone) || str(credentials["api_token"]) == "" {
		return nil, bad("Configure a Cloudflare integration with a zone ID and DNS-edit token.")
	}
	var reader io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		reader = bytes.NewReader(raw)
	}
	req, err := http.NewRequestWithContext(ctx, method, "https://api.cloudflare.com/client/v4/zones/"+zone+path, reader)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+str(credentials["api_token"]))
	req.Header.Set("Content-Type", "application/json")
	client := http.Client{Timeout: 8 * time.Second}
	if a.HTTP != nil {
		client = *a.HTTP
	}
	client.Timeout = 8 * time.Second
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	response, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("Cloudflare DNS request failed; it will be retried")
	}
	defer response.Body.Close()
	if response.StatusCode == 404 && method == "DELETE" {
		return M{}, nil
	}
	var out M
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, fmt.Errorf("Cloudflare DNS returned HTTP %d; check the integration permissions", response.StatusCode)
	}
	if err = json.NewDecoder(io.LimitReader(response.Body, 2<<20)).Decode(&out); err != nil || !boolean(out["success"]) {
		return nil, fmt.Errorf("Cloudflare DNS did not confirm the operation")
	}
	return out, nil
}
func (a *App) subdomainRecords(ctx context.Context, credentials M, hostname string) ([]M, error) {
	out, err := a.subdomainCF(ctx, credentials, "GET", "/dns_records?"+url.Values{"name": {hostname}, "per_page": {"100"}}.Encode(), nil)
	if err != nil {
		return nil, err
	}
	if num(asMap(out["result_info"])["total_pages"]) > 1 {
		return nil, fmt.Errorf("Too many DNS records at the selected name; review them in Cloudflare")
	}
	records := []M{}
	for _, v := range asSlice(out["result"]) {
		record := asMap(v)
		if strings.EqualFold(str(record["name"]), hostname) {
			records = append(records, record)
		}
	}
	return records, nil
}
func subdomainRecord(hostname, target, owner string) (M, error) {
	kind := "CNAME"
	if ip := net.ParseIP(target); ip != nil {
		if !ip.IsGlobalUnicast() || ip.IsPrivate() {
			return nil, bad("The FRP gateway needs a public DNS target.")
		}
		kind = "AAAA"
		if ip.To4() != nil {
			kind = "A"
		}
	} else {
		valid, err := subdomainName(target)
		if err != nil {
			return nil, err
		}
		target = valid
		if strings.EqualFold(hostname, target) {
			return nil, bad("The DNS target cannot be the join hostname itself.")
		}
	}
	return M{"type": kind, "name": hostname, "content": target, "proxied": false, "ttl": int64(60), "comment": owner}, nil
}
func (a *App) subdomainApply(ctx context.Context, job M, target string) error {
	raw, err := a.unseal(str(job["credentials"]))
	if err != nil {
		return fmt.Errorf("DNS credentials could not be decrypted")
	}
	credentials := M{}
	if json.Unmarshal([]byte(raw), &credentials) != nil {
		return fmt.Errorf("DNS credentials are invalid")
	}
	hostname, owner := str(job["hostname"]), str(job["owner"])
	if owner == "" {
		return fmt.Errorf("DNS ownership is missing; administrator review required")
	}
	records, err := a.subdomainRecords(ctx, credentials, hostname)
	if err != nil {
		return err
	}
	owned := []M{}
	for _, record := range records {
		if str(record["comment"]) == owner {
			owned = append(owned, record)
		} else if boolean(job["desired"]) {
			return proxyConflict("A DNS record already exists at that name. Choose another join name.")
		}
	}
	if !boolean(job["desired"]) {
		for _, record := range owned {
			id := str(record["id"])
			if !subdomainCFID.MatchString(id) {
				return fmt.Errorf("Cloudflare returned an invalid record ID")
			}
			if _, err = a.subdomainCF(ctx, credentials, "DELETE", "/dns_records/"+id, nil); err != nil {
				return err
			}
		}
		return nil
	}
	desired, err := subdomainRecord(hostname, target, owner)
	if err != nil {
		return err
	}
	if len(owned) > 1 {
		return fmt.Errorf("Multiple managed DNS records need administrator review")
	}
	if len(owned) == 0 {
		created, createErr := a.subdomainCF(ctx, credentials, "POST", "/dns_records", desired)
		if createErr != nil {
			return createErr
		}
		return subdomainConfirmRecord(asMap(created["result"]), desired)
	}
	record := owned[0]
	if record["type"] == desired["type"] && strings.EqualFold(strings.TrimSuffix(str(record["content"]), "."), str(desired["content"])) && !boolean(record["proxied"]) {
		return nil
	}
	id := str(record["id"])
	if !subdomainCFID.MatchString(id) {
		return fmt.Errorf("Cloudflare returned an invalid record ID")
	}
	updated, err := a.subdomainCF(ctx, credentials, "PUT", "/dns_records/"+id, desired)
	if err != nil {
		return err
	}
	return subdomainConfirmRecord(asMap(updated["result"]), desired)
}

func subdomainConfirmRecord(record, desired M) error {
	if !subdomainCFID.MatchString(str(record["id"])) || !strings.EqualFold(str(record["name"]), str(desired["name"])) || record["type"] != desired["type"] || !strings.EqualFold(strings.TrimSuffix(str(record["content"]), "."), str(desired["content"])) || str(record["comment"]) != str(desired["comment"]) || boolean(record["proxied"]) {
		return fmt.Errorf("Cloudflare did not confirm the expected DNS record; verification will retry")
	}
	return nil
}

// Persistent jobs live independently of server rows, so out-of-band server or
// route removal cannot discard the information required to clean up DNS.
func (a *App) reconcileSubdomains(ctx context.Context, serverID int64) error {
	var acquired bool
	conn, err := a.DB.Acquire(ctx)
	if err != nil {
		return err
	}
	defer conn.Release()
	if err = conn.QueryRow(ctx, "SELECT pg_try_advisory_lock(hashtextextended(current_schema()||'voltra-subdomains',0))").Scan(&acquired); err != nil {
		return err
	}
	if !acquired {
		return proxyConflict("Join name changes are busy. Retry shortly.")
	}
	defer func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		if _, e := conn.Exec(cleanup, "SELECT pg_advisory_unlock(hashtextextended(current_schema()||'voltra-subdomains',0))"); e != nil {
			_ = conn.Conn().Close(cleanup)
		}
	}()
	records, err := a.query(ctx, `SELECT key,value FROM settings WHERE starts_with(key,'network.subdomain_name.') AND ($1::bigint=0 OR value->>'server_id'=$1::text) ORDER BY COALESCE(value->>'checked_at',''),key LIMIT 20`, serverID)
	if err != nil {
		return err
	}
	var first error
	for _, record := range records {
		job := asMap(record["value"])
		// Retire old wildcard-era claims without touching provider records.
		if str(job["owner"]) == "" {
			if err = a.exec(ctx, "DELETE FROM settings WHERE key=$1", record["key"]); err != nil {
				return err
			}
			continue
		}
		route, e := a.one(ctx, `SELECT g.public_host,c.value FROM proxy_routes r JOIN servers s ON s.id=r.server_id JOIN proxy_gateways g ON g.id=r.gateway_id JOIN settings c ON c.key=$3 WHERE r.id=$1 AND r.server_id=$2 AND r.gateway_id=$4 AND r.allocation_id=s.allocation_id AND r.desired_present`, num(job["route_id"]), num(job["server_id"]), subdomainKey(num(job["gateway_id"])), num(job["gateway_id"]))
		if e != nil && !errorsIsNoRows(e) {
			return e
		}
		config := asMap(route["value"])
		// A rotated token for the same zone can recover pending cleanup. Keep the
		// encrypted snapshot when an integration is removed or moved to a new zone.
		integration, refreshErr := a.one(ctx, "SELECT * FROM integrations WHERE id=$1 AND provider='cloudflare'", num(job["integration_id"]))
		if refreshErr != nil && !errorsIsNoRows(refreshErr) {
			return refreshErr
		}
		if refreshErr == nil {
			oldCredentials, oldErr := a.integrationCredentials(M{"credentials": job["credentials"]})
			newCredentials, newErr := a.integrationCredentials(integration)
			if oldErr == nil && newErr == nil && str(oldCredentials["zone_id"]) == str(newCredentials["zone_id"]) && str(newCredentials["api_token"]) != "" {
				job["credentials"] = integration["credentials"]
			}
		}
		if e != nil || str(job["hostname"]) != subdomainHostname(str(job["label"]), str(config["domain"])) {
			job["desired"] = false
		}
		if !boolean(job["desired"]) {
			job["status"] = "cleanup_pending"
			if err = a.saveSubdomainJob(ctx, str(record["key"]), job); err != nil {
				return err
			}
		}
		op, cancel := context.WithTimeout(ctx, 10*time.Second)
		e = a.subdomainApply(op, job, str(route["public_host"]))
		cancel()
		job["checked_at"] = time.Now().UTC().Format(time.RFC3339Nano)
		if e != nil {
			job["status"] = "error"
			job["detail"] = e.Error()
			if first == nil {
				first = e
			}
		} else if !boolean(job["desired"]) {
			if err = a.exec(ctx, "DELETE FROM settings WHERE key=$1", record["key"]); err != nil {
				return err
			}
			continue
		} else {
			job["status"] = "applied"
			job["detail"] = "DNS record created. Propagation and game connectivity are separate checks."
		}
		if err = a.saveSubdomainJob(ctx, str(record["key"]), job); err != nil {
			return err
		}
	}
	return first
}
func (a *App) saveSubdomainJob(ctx context.Context, key string, job M) error {
	raw, err := json.Marshal(job)
	if err != nil {
		return err
	}
	return a.exec(ctx, "UPDATE settings SET value=$2::jsonb WHERE key=$1", key, string(raw))
}
func (a *App) RunSubdomainReconciler(ctx context.Context) {
	for {
		pass, cancel := context.WithTimeout(ctx, 30*time.Second)
		_ = a.reconcileSubdomains(pass, 0)
		cancel()
		select {
		case <-ctx.Done():
			return
		case <-time.After(30 * time.Second):
		}
	}
}

// Deletion keeps DNS cleanup intent and credentials until the provider confirms
// removal. Force deletion does not silently abandon managed DNS records.
func (a *App) cleanupServerSubdomains(ctx context.Context, serverID int64) error {
	tx, err := a.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtextextended(current_schema()||'voltra-subdomains',0))"); err != nil {
		return err
	}
	changed, err := tx.Exec(ctx, `UPDATE settings SET value=value||'{"desired":false,"status":"cleanup_pending"}'::jsonb WHERE starts_with(key,'network.subdomain_name.') AND value->>'server_id'=$1`, strconv.FormatInt(serverID, 10))
	if err != nil {
		return err
	}
	if err = tx.Commit(ctx); err != nil {
		return err
	}
	if changed.RowsAffected() == 0 {
		return nil
	}
	op, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	if err = a.reconcileSubdomains(op, serverID); err != nil {
		return proxyConflict("DNS cleanup could not be confirmed. The server and pending cleanup have been kept; retry deletion when Cloudflare is reachable.")
	}
	var pending bool
	if err = a.DB.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM settings WHERE starts_with(key,'network.subdomain_name.') AND value->>'server_id'=$1)`, strconv.FormatInt(serverID, 10)).Scan(&pending); err != nil {
		return err
	}
	if pending {
		return proxyConflict("DNS cleanup is still pending. Retry deletion shortly.")
	}
	return nil
}
