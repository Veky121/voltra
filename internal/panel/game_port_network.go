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
	"strconv"
	"time"
	"voltra/internal/nodeagent"
)

// probeGamePortAvailability never falls back to binding on the panel host.
func (a *App) probeGamePortAvailability(ctx context.Context, node M, ip string, ports []int64) (M, error) {
	q := nodeagent.NetworkProbeRequest{IP: ip, Ports: ports}
	if err := q.Validate(); err != nil {
		return nil, err
	}
	unverified := M{"status": "unverified", "snapshot": true, "ports": []M{}, "detail": "Node bind checks unavailable. Update and reconnect the node agent; manually verify local ports and forwarding."}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	tr := http.DefaultTransport.(*http.Transport).Clone()
	tr.Proxy = nil
	tr.DisableKeepAlives = true
	tr.DialContext = func(ctx context.Context, _, _ string) (net.Conn, error) {
		return a.dialNodeService(ctx, num(node["id"]), "network")
	}
	defer tr.CloseIdleConnections()
	body, _ := json.Marshal(q)
	req, _ := http.NewRequestWithContext(ctx, "POST", "http://node-network/probe", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Transport: tr, Timeout: 10 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	resp, err := client.Do(req)
	if err != nil {
		return unverified, nil
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return unverified, nil
	}
	var result nodeagent.NetworkProbeResult
	dec := json.NewDecoder(io.LimitReader(resp.Body, 32769))
	if dec.Decode(&result) != nil || result.Status != "verified" || !result.Snapshot || len(result.Ports) != len(ports) {
		return unverified, nil
	}
	for i, p := range result.Ports {
		if p.Port != ports[i] {
			return unverified, nil
		}
	}
	raw, _ := json.Marshal(result)
	var out M
	_ = json.Unmarshal(raw, &out)
	return out, nil
}

// Only reviewed gameplay roles may be forwarded. An arbitrary role supplied by
// a template or caller cannot expose RCON, admin APIs, file transfer or console.
func gameForwardProtocols(id, role string) []string {
	if role != "game" {
		return nil
	}
	switch id {
	case "minecraft/java/paper/egg-paper.json", "minecraft/java/forge/egg-forge-enhanced.json", "minecraft/java/fabric/egg-fabric.json", "minecraft/java/neoforge/egg-neoforge.json", "minecraft/java/purpur/egg-purpur.json", "minecraft/java/spigot/egg-spigot.json", "terraria/vanilla/egg-terraria-vanilla.json", "terraria/tmodloader/egg-t-modloader.json", "terraria/tshock/egg-tshock.json", "terraria/tshock/egg-tshock-legacy.json":
		return []string{"tcp"}
	case "palworld/egg-palworld.json", "palworld/egg-palworld-proton.json", "factorio/factorio/egg-factorio.json", "factorio/factorio/egg-factorio-a-r-m64.json", "factorio/factorio-modupdate/egg-factorio-modupdate.json":
		return []string{"udp"}
	}
	return nil
}

// forwardGamePorts is post-create only. It uses saved FRP clients and durable
// proxy_routes, without discovery, router commands, new credentials or schema.
func (a *App) forwardGamePorts(ctx context.Context, node M, server M, entry gameTemplate, plan gamePortPlan) M {
	out := M{"status": "manual", "externally_verified": false, "detail": "Manual forwarding required: no reviewed gameplay protocol or configured FRP pool fits these allocations. Router forwarding is not configured.", "routes": []M{}}
	ctx, cancel := context.WithTimeout(ctx, 25*time.Second)
	defer cancel()
	routes := []M{}
	mapped := 0
	eligible := 0
	manual := 0
	for _, port := range plan.Ports {
		protocols := gameForwardProtocols(entry.Path, port.Role)
		if entry.Path == "" {
			switch entry.ID {
			case "minecraft":
				if port.Role == "game" {
					protocols = []string{"tcp"}
				}
			case "palworld", "palworld-native", "palworld-proton":
				if port.Role == "game" {
					protocols = []string{"udp"}
				}
			}
		}
		if len(protocols) == 0 {
			manual++
			routes = append(routes, M{"internal_port": port.Port, "role": port.Role, "status": "manual", "detail": "Gameplay protocol has not been audited for this recipe and role; no mapping was created."})
		}
		for _, proto := range protocols {
			eligible++
			route, err := a.createGameFRPRoute(ctx, node, server, plan.IP, port.Port, proto)
			if err != nil {
				routes = append(routes, M{"internal_port": port.Port, "protocol": proto, "status": "manual", "detail": err.Error()})
				continue
			}
			route, err = a.applyGameFRPRoute(ctx, route)
			detail := "FRP mapping registered; external reachability and gameplay have not been verified."
			status := "mapped"
			if err != nil {
				status = "pending"
				detail = err.Error()
			} else {
				mapped++
			}
			if num(route["public_port"]) != port.Port {
				detail = fmt.Sprintf("Public port %d forwards to unchanged internal port %d. ", num(route["public_port"]), port.Port) + detail
			}
			routes = append(routes, M{"route_id": route["id"], "protocol": proto, "internal_port": port.Port, "public_port": route["public_port"], "public_host": route["public_host"], "status": status, "detail": detail})
		}
	}
	out["routes"] = routes
	if eligible > 0 && len(routes) > 0 {
		out["detail"] = "Only audited gameplay protocols are considered. Unlisted roles require manual forwarding. External reachability is unverified."
		out["status"] = "manual"
		if mapped == eligible && manual == 0 {
			out["status"] = "mapped"
		} else if mapped > 0 {
			out["status"] = "partial"
		} else {
			for _, r := range routes {
				if str(r["status"]) == "pending" {
					out["status"] = "pending"
				}
			}
		}
	}
	return out
}

func (a *App) createGameFRPRoute(ctx context.Context, node, server M, ip string, port int64, proto string) (M, error) {
	parsed := net.ParseIP(ip)
	if parsed == nil || parsed.IsLoopback() || parsed.IsMulticast() || parsed.IsLinkLocalUnicast() {
		return nil, fmt.Errorf("FRP needs a reachable node address; this allocation is local-only or invalid")
	}
	clients, err := a.query(ctx, `SELECT c.id,c.gateway_id,c.admin_url,g.public_host,g.public_port_start,g.public_port_end FROM proxy_node_clients c JOIN proxy_gateways g ON g.id=c.gateway_id WHERE c.node_id=$1 AND c.setup_complete AND c.test_status='complete' AND $2 BETWEEN c.local_port_start AND c.local_port_end ORDER BY c.id LIMIT 2`, num(node["id"]), port)
	if err != nil {
		return nil, fmt.Errorf("FRP configuration could not be read")
	}
	if len(clients) != 1 {
		return nil, fmt.Errorf("manual forwarding required: exactly one tested FRP client with a matching local pool is required")
	}
	c := clients[0]
	target, err := gameFRPTarget(ip, str(c["admin_url"]))
	if err != nil {
		return nil, err
	}
	gid := num(c["gateway_id"])
	tx, err := a.DB.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("FRP route transaction unavailable")
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtextextended(current_schema()||$1,0))", "proxy-wizard-"+strconv.FormatInt(gid, 10)); err != nil {
		return nil, err
	}
	var aid int64
	if err = tx.QueryRow(ctx, `SELECT id FROM allocations WHERE node_id=$1 AND server_id=$2 AND ip=$3 AND port=$4 FOR SHARE`, num(node["id"]), num(server["id"]), ip, port).Scan(&aid); err != nil {
		return nil, fmt.Errorf("allocation is not assigned to this server on this node")
	}
	existing, err := tx.Query(ctx, `SELECT id,public_port,desired_present FROM proxy_routes WHERE client_id=$1 AND allocation_id=$2 AND protocol=$3`, num(c["id"]), aid, proto)
	if err != nil {
		return nil, err
	}
	var rid, public int64
	var desired bool
	if existing.Next() {
		err = existing.Scan(&rid, &public, &desired)
		existing.Close()
		if err != nil {
			return nil, err
		}
		if !desired {
			return nil, fmt.Errorf("mapping is awaiting removal; reconcile it before retry")
		}
	} else {
		existing.Close()
		start := max(port, num(c["public_port_start"]))
		end := min(num(c["public_port_end"]), start+127)
		if start > end {
			return nil, fmt.Errorf("manual forwarding required: preferred public port exceeds configured FRP pool")
		}
		err = tx.QueryRow(ctx, `SELECT p FROM generate_series($1::int,$2::int) p WHERE NOT EXISTS(SELECT 1 FROM proxy_routes WHERE gateway_id=$3 AND protocol=$4 AND public_port=p) AND NOT EXISTS(SELECT 1 FROM proxy_node_clients WHERE gateway_id=$3 AND test_public_port=p) ORDER BY p LIMIT 1`, start, end, gid, proto).Scan(&public)
		if err != nil {
			return nil, fmt.Errorf("FRP public port conflict: no free port in bounded upward search of configured pool")
		}
		err = tx.QueryRow(ctx, `INSERT INTO proxy_routes(gateway_id,client_id,server_id,allocation_id,protocol,public_port,local_ip,local_port,proxy_name) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`, gid, num(c["id"]), num(server["id"]), aid, proto, public, target, port, "voltra-"+newUUID()).Scan(&rid)
		if err != nil {
			return nil, fmt.Errorf("FRP route conflict; existing mapping preserved")
		}
	}
	if err = tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("FRP desired mapping could not be persisted")
	}
	route, err := a.one(ctx, "SELECT * FROM proxy_routes WHERE id=$1", rid)
	if route != nil {
		route["public_host"] = c["public_host"]
	}
	return route, err
}

// A wildcard listens on the tested client's node interfaces, but cannot itself
// be dialed. Resolve it to that client's literal address without changing the
// allocation or widening a loopback-only bind.
func gameFRPTarget(bind, adminURL string) (string, error) {
	ip := net.ParseIP(bind)
	if ip == nil || ip.IsLoopback() || ip.IsMulticast() || ip.IsLinkLocalUnicast() {
		return "", fmt.Errorf("FRP needs a reachable node address")
	}
	if !ip.IsUnspecified() {
		return ip.String(), nil
	}
	u, err := url.Parse(adminURL)
	if err != nil || proxyPrivateURL(adminURL) != nil {
		return "", fmt.Errorf("Configure a reachable FRP client address for this node")
	}
	target := net.ParseIP(u.Hostname())
	if target == nil || target.IsLoopback() || target.IsUnspecified() || target.IsLinkLocalUnicast() || (ip.To4() == nil) != (target.To4() == nil) {
		return "", fmt.Errorf("Configure an FRP client address matching the node's network interface")
	}
	return target.String(), nil
}

func gameFRPAllocationTargetMatches(bind, adminURL, target string) bool {
	if bind == target {
		return true
	}
	ip := net.ParseIP(bind)
	if ip == nil || !ip.IsUnspecified() {
		return false
	}
	resolved, err := gameFRPTarget(bind, adminURL)
	return err == nil && resolved == target
}

func (a *App) applyGameFRPRoute(ctx context.Context, route M) (M, error) {
	tx, err := a.DB.Begin(ctx)
	if err != nil {
		return route, fmt.Errorf("desired FRP route saved; reconcile required")
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtextextended(current_schema()||$1,0))", "proxy-wizard-"+strconv.FormatInt(num(route["gateway_id"]), 10)); err != nil {
		return route, fmt.Errorf("desired FRP route saved; reconcile required")
	}
	// Reload intent after acquiring the same lock as administrator reconciliation.
	var desired bool
	if err = tx.QueryRow(ctx, "SELECT desired_present FROM proxy_routes WHERE id=$1 FOR UPDATE", num(route["id"])).Scan(&desired); err != nil || !desired {
		return route, fmt.Errorf("FRP mapping changed; manual reconciliation required")
	}
	applyErr := a.proxyApply(ctx, tx, route)
	status, detail := "applied", ""
	if applyErr != nil {
		status = "error"
		detail = applyErr.Error()
	}
	if _, err = tx.Exec(ctx, "UPDATE proxy_routes SET status=$2,last_error=$3,updated_at=now() WHERE id=$1", num(route["id"]), status, detail); err != nil {
		return route, fmt.Errorf("desired FRP mapping retained; reconcile required")
	}
	if err = tx.Commit(ctx); err != nil {
		return route, fmt.Errorf("desired FRP mapping retained; reconcile required")
	}
	return route, applyErr
}
