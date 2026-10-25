package panel

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/jackc/pgx/v5"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

func proxyConflict(s string) error { return &APIError{Status: 409, Code: "ProxyConflict", Detail: s} }
func proxyID(r *http.Request, k string) int64 {
	n, _ := strconv.ParseInt(r.PathValue(k), 10, 64)
	return n
}
func proxyPrivateURL(s string) error {
	u, e := url.Parse(s)
	if e != nil || (u.Scheme != "http" && u.Scheme != "https") || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") {
		return bad("admin_url must be an HTTP(S) origin on a literal private IP")
	}
	if p := u.Port(); p != "" {
		n, e := strconv.Atoi(p)
		if e != nil || n < 1 || n > 65535 {
			return bad("admin_url has an invalid port")
		}
	}
	ip := net.ParseIP(u.Hostname())
	if ip == nil || ip.IsUnspecified() || !(ip.IsLoopback() || ip.IsPrivate() || (ip.To4() != nil && ip.To4()[0] == 100 && ip.To4()[1] >= 64 && ip.To4()[1] <= 127)) {
		return bad("admin_url must use a loopback, private, or Tailscale IP")
	}
	return nil
}
func proxySafeClient(m M) M {
	delete(m, "credentials_encrypted")
	m["credentials_configured"] = true
	return m
}
func proxySafeGateway(m M) M {
	if m == nil {
		return nil
	}
	m["auth_token_configured"] = str(m["auth_token_encrypted"]) != ""
	delete(m, "auth_token_encrypted")
	return m
}
func (a *App) registerProxyGateways(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/client/servers/{server}/proxy-routes", a.proxyClientRoutes)
	mux.HandleFunc("GET /api/admin/proxy-gateways/{gateway}/config/frps", a.proxyDownload)
	mux.HandleFunc("GET /api/admin/proxy-gateways/{gateway}/clients/{client}/config", a.proxyDownload)
	mux.HandleFunc("POST /api/admin/proxy-gateways/{gateway}/clients/{client}/test", a.proxySetupTest)
	base := "/api/admin/proxy-gateways"
	for _, p := range []string{"GET " + base, "POST " + base, "GET " + base + "/{gateway}", "PATCH " + base + "/{gateway}", "DELETE " + base + "/{gateway}", "GET " + base + "/{gateway}/clients", "POST " + base + "/{gateway}/clients", "PATCH " + base + "/{gateway}/clients/{client}", "DELETE " + base + "/{gateway}/clients/{client}", "GET " + base + "/{gateway}/routes", "POST " + base + "/{gateway}/routes", "DELETE " + base + "/{gateway}/routes/{route}", "POST " + base + "/{gateway}/reconcile"} {
		mux.HandleFunc(p, a.proxyGatewayHTTP)
	}
}
func (a *App) proxyGatewayHTTP(w http.ResponseWriter, r *http.Request) {
	if _, e := a.requireAdmin(r); e != nil {
		fail(w, e)
		return
	}
	result, status, e := a.proxyGatewayRequest(r)
	if e != nil {
		fail(w, e)
		return
	}
	if status == 204 {
		w.WriteHeader(204)
		return
	}
	writeJSON(w, status, result)
}
func (a *App) proxyGatewayRequest(r *http.Request) (any, int, error) {
	ctx := r.Context()
	for _, k := range []string{"gateway", "client", "route"} {
		if r.PathValue(k) != "" && proxyID(r, k) <= 0 {
			return nil, 0, bad("invalid proxy resource ID")
		}
	}
	gid := proxyID(r, "gateway")
	path := r.URL.Path
	method := r.Method
	if gid == 0 {
		if method == "GET" {
			rows, e := a.query(ctx, "SELECT * FROM proxy_gateways ORDER BY id")
			for _, m := range rows {
				proxySafeGateway(m)
			}
			return collection("proxy_gateway", rows), 200, e
		}
		d, e := decode(r)
		if e != nil {
			return nil, 0, e
		}
		if e = proxyGatewayFields(d); e != nil {
			return nil, 0, e
		}
		sealed, e := a.proxyGatewaySecret(d)
		if e != nil {
			return nil, 0, e
		}
		row, e := a.one(ctx, `INSERT INTO proxy_gateways(name,public_host,public_port_start,public_port_end,server_host,server_port,auth_token_encrypted) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`, str(d["name"]), str(d["public_host"]), num(d["public_port_start"]), num(d["public_port_end"]), str(d["server_host"]), num(d["server_port"]), sealed)
		return item("proxy_gateway", proxySafeGateway(row)), 201, e
	}
	tx, e := a.DB.Begin(ctx)
	if e != nil {
		return nil, 0, e
	}
	defer tx.Rollback(ctx)
	if _, e = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtextextended(current_schema()||$1,0))", "proxy-wizard-"+strconv.FormatInt(gid, 10)); e != nil {
		return nil, 0, e
	}
	var exists int64
	e = tx.QueryRow(ctx, "SELECT id FROM proxy_gateways WHERE id=$1 FOR UPDATE", gid).Scan(&exists)
	if e != nil {
		return nil, 0, notFound()
	}
	finish := func(v any, s int, err error) (any, int, error) {
		if err == nil {
			err = tx.Commit(ctx)
		}
		return v, s, err
	}
	query := func(sql string, args ...any) ([]M, error) {
		rows, e := tx.Query(ctx, sql, args...)
		if e != nil {
			return nil, e
		}
		defer rows.Close()
		out := []M{}
		for rows.Next() {
			v, e := rows.Values()
			if e != nil {
				return nil, e
			}
			m := M{}
			for i, f := range rows.FieldDescriptions() {
				m[f.Name] = v[i]
			}
			out = append(out, m)
		}
		return out, rows.Err()
	}
	if strings.HasSuffix(path, "/reconcile") {
		rows, e := query("SELECT * FROM proxy_routes WHERE gateway_id=$1 ORDER BY id", gid)
		if e != nil {
			return nil, 0, e
		}
		for _, route := range rows {
			err := a.proxyApply(ctx, tx, route)
			if err != nil {
				_, e = tx.Exec(ctx, "UPDATE proxy_routes SET status='error',last_error=$2,updated_at=now() WHERE id=$1", num(route["id"]), err.Error())
			} else if !boolean(route["desired_present"]) {
				_, e = tx.Exec(ctx, "DELETE FROM proxy_routes WHERE id=$1", num(route["id"]))
			} else {
				_, e = tx.Exec(ctx, "UPDATE proxy_routes SET status='applied',last_error='',updated_at=now() WHERE id=$1", num(route["id"]))
			}
			if e != nil {
				return nil, 0, e
			}
		}
		rows, e = query("SELECT * FROM proxy_routes WHERE gateway_id=$1 ORDER BY id", gid)
		return finish(collection("proxy_route", rows), 200, e)
	}
	if strings.Contains(path, "/routes") {
		if method == "GET" {
			rows, e := query("SELECT * FROM proxy_routes WHERE gateway_id=$1 ORDER BY id", gid)
			return finish(collection("proxy_route", rows), 200, e)
		}
		if method == "DELETE" {
			tag, e := tx.Exec(ctx, "UPDATE proxy_routes SET desired_present=false,status='pending',last_error='',updated_at=now() WHERE id=$1 AND gateway_id=$2", proxyID(r, "route"), gid)
			if e == nil && tag.RowsAffected() == 0 {
				e = notFound()
			}
			return finish(nil, 204, e)
		}
		d, e := decode(r)
		if e != nil {
			return nil, 0, e
		}
		proto := str(d["protocol"])
		if proto != "tcp" && proto != "udp" {
			return nil, 0, bad("protocol must be tcp or udp")
		}
		var ip string
		var port, lo, hi int64
		e = tx.QueryRow(ctx, `SELECT al.ip,al.port,c.local_port_start,c.local_port_end FROM proxy_node_clients c JOIN allocations al ON al.node_id=c.node_id JOIN servers s ON s.id=al.server_id AND s.node_id=c.node_id WHERE c.id=$1 AND c.gateway_id=$2 AND al.id=$3 AND s.id=$4 FOR SHARE OF c,al,s`, num(d["client_id"]), gid, num(d["allocation_id"]), num(d["server_id"])).Scan(&ip, &port, &lo, &hi)
		if e != nil {
			return nil, 0, bad("allocation must belong to the server and client node")
		}
		if port < lo || port > hi || net.ParseIP(ip) == nil || net.ParseIP(ip).IsUnspecified() {
			return nil, 0, bad("allocation must have a reachable IP and port in the client local pool")
		}
		var start, end int64
		e = tx.QueryRow(ctx, "SELECT public_port_start,public_port_end FROM proxy_gateways WHERE id=$1", gid).Scan(&start, &end)
		if e != nil {
			return nil, 0, e
		}
		public := num(d["public_port"])
		if public == 0 {
			e = tx.QueryRow(ctx, `SELECT p FROM generate_series($1::int,$2::int) p WHERE NOT EXISTS(SELECT 1 FROM proxy_routes WHERE gateway_id=$3 AND protocol=$4 AND public_port=p) AND NOT EXISTS(SELECT 1 FROM proxy_node_clients WHERE gateway_id=$3 AND test_public_port=p) ORDER BY p LIMIT 1`, start, end, gid, proto).Scan(&public)
			if e != nil {
				return nil, 0, proxyConflict("public port pool exhausted")
			}
		}
		if public < start || public > end {
			return nil, 0, bad("public_port is outside gateway public pool")
		}
		var reserved int
		if e = tx.QueryRow(ctx, "SELECT count(*) FROM proxy_node_clients WHERE gateway_id=$1 AND test_public_port=$2", gid, public).Scan(&reserved); e != nil {
			return nil, 0, e
		}
		if reserved > 0 {
			return nil, 0, proxyConflict("public port reserved by setup test")
		}
		rows, e := query(`INSERT INTO proxy_routes(gateway_id,client_id,server_id,allocation_id,protocol,public_port,local_ip,local_port,proxy_name) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING RETURNING *`, gid, num(d["client_id"]), num(d["server_id"]), num(d["allocation_id"]), proto, public, ip, port, "voltra-"+newUUID())
		if e == nil && len(rows) == 0 {
			e = proxyConflict("port or allocation mapping already reserved")
		}
		if e != nil {
			return nil, 0, e
		}
		return finish(item("proxy_route", rows[0]), 201, nil)
	}
	if strings.Contains(path, "/clients") {
		cid := proxyID(r, "client")
		if method == "GET" {
			rows, e := query("SELECT * FROM proxy_node_clients WHERE gateway_id=$1 ORDER BY id", gid)
			for _, m := range rows {
				proxySafeClient(m)
			}
			return finish(collection("proxy_node_client", rows), 200, e)
		}
		var count int
		e = tx.QueryRow(ctx, "SELECT count(*) FROM proxy_routes WHERE gateway_id=$1 AND client_id=$2", gid, cid).Scan(&count)
		if e != nil {
			return nil, 0, e
		}
		var testPort *int
		if cid != 0 {
			_ = tx.QueryRow(ctx, "SELECT test_public_port FROM proxy_node_clients WHERE id=$1 AND gateway_id=$2", cid, gid).Scan(&testPort)
		}
		if testPort != nil {
			return nil, 0, proxyConflict("retry setup test cleanup before changing client")
		}
		if count > 0 {
			return nil, 0, proxyConflict("remove and reconcile client routes before editing this client")
		}
		if method == "DELETE" {
			tag, e := tx.Exec(ctx, "DELETE FROM proxy_node_clients WHERE id=$1 AND gateway_id=$2", cid, gid)
			if e == nil && tag.RowsAffected() == 0 {
				e = notFound()
			}
			return finish(nil, 204, e)
		}
		d, e := decode(r)
		if e != nil {
			return nil, 0, e
		}
		old := M{}
		if cid != 0 {
			rows, e := query("SELECT * FROM proxy_node_clients WHERE id=$1 AND gateway_id=$2", cid, gid)
			if e != nil {
				return nil, 0, e
			}
			if len(rows) == 0 {
				return nil, 0, notFound()
			}
			old = rows[0]
			for _, k := range []string{"admin_url", "local_port_start", "local_port_end"} {
				if _, ok := d[k]; !ok {
					d[k] = old[k]
				}
			}
		}
		if e = proxyPrivateURL(str(d["admin_url"])); e != nil {
			return nil, 0, e
		}
		if num(d["local_port_start"]) < 1 || num(d["local_port_end"]) > 65535 || num(d["local_port_end"]) < num(d["local_port_start"]) {
			return nil, 0, bad("invalid local port pool")
		}
		creds := M{}
		if cid != 0 {
			raw, e := a.unseal(str(old["credentials_encrypted"]))
			if e != nil {
				return nil, 0, bad("unable to decrypt client credentials")
			}
			if json.Unmarshal([]byte(raw), &creds) != nil {
				return nil, 0, bad("invalid stored credentials")
			}
		}
		for _, k := range []string{"admin_user", "admin_password"} {
			if v, ok := d[k]; ok {
				creds[k] = v
			}
		}
		if proxyControls(str(creds["admin_user"])) || proxyControls(str(creds["admin_password"])) || strings.Contains(str(creds["admin_user"]), ":") {
			return nil, 0, bad("FRPC credentials contain unsupported characters")
		}
		if str(creds["admin_user"]) == "" || str(creds["admin_password"]) == "" {
			return nil, 0, bad("admin_user and admin_password are required")
		}
		raw, _ := json.Marshal(creds)
		sealed, e := a.seal(string(raw))
		if e != nil {
			return nil, 0, bad("ENCRYPTION_KEY is required for FRPC credentials")
		}
		var rows []M
		if cid == 0 {
			rows, e = query(`INSERT INTO proxy_node_clients(gateway_id,node_id,admin_url,credentials_encrypted,local_port_start,local_port_end) SELECT $1,id,$3,$4,$5,$6 FROM nodes WHERE id=$2 ON CONFLICT DO NOTHING RETURNING *`, gid, num(d["node_id"]), strings.TrimRight(str(d["admin_url"]), "/"), sealed, num(d["local_port_start"]), num(d["local_port_end"]))
		} else {
			rows, e = query(`UPDATE proxy_node_clients SET setup_complete=false,test_status='pending',test_error='',admin_url=$3,credentials_encrypted=$4,local_port_start=$5,local_port_end=$6,updated_at=now() WHERE id=$1 AND gateway_id=$2 RETURNING *`, cid, gid, strings.TrimRight(str(d["admin_url"]), "/"), sealed, num(d["local_port_start"]), num(d["local_port_end"]))
		}
		if e != nil {
			return nil, 0, e
		}
		if len(rows) == 0 {
			return nil, 0, proxyConflict("node missing or already associated with gateway")
		}
		status := 200
		if cid == 0 {
			status = 201
		}
		return finish(item("proxy_node_client", proxySafeClient(rows[0])), status, nil)
	}
	rows, e := query("SELECT * FROM proxy_gateways WHERE id=$1", gid)
	if e != nil {
		return nil, 0, e
	}
	if method == "GET" {
		return finish(item("proxy_gateway", proxySafeGateway(rows[0])), 200, nil)
	}
	var count int
	e = tx.QueryRow(ctx, "SELECT count(*) FROM proxy_node_clients WHERE gateway_id=$1", gid).Scan(&count)
	if e != nil {
		return nil, 0, e
	}
	if count > 0 {
		return nil, 0, proxyConflict("remove gateway clients before editing or deleting gateway")
	}
	if method == "DELETE" {
		_, e = tx.Exec(ctx, "DELETE FROM proxy_gateways WHERE id=$1", gid)
		return finish(nil, 204, e)
	}
	d, e := decode(r)
	if e != nil {
		return nil, 0, e
	}
	for k, v := range rows[0] {
		if _, ok := d[k]; !ok {
			d[k] = v
		}
	}
	if e = proxyGatewayFields(d); e != nil {
		return nil, 0, e
	}
	sealed := str(rows[0]["auth_token_encrypted"])
	if _, ok := d["auth_token"]; ok {
		sealed, e = a.proxyGatewaySecret(d)
		if e != nil {
			return nil, 0, e
		}
	}
	rows, e = query("UPDATE proxy_gateways SET name=$2,public_host=$3,public_port_start=$4,public_port_end=$5,server_host=$6,server_port=$7,auth_token_encrypted=$8,updated_at=now() WHERE id=$1 RETURNING *", gid, str(d["name"]), str(d["public_host"]), num(d["public_port_start"]), num(d["public_port_end"]), str(d["server_host"]), num(d["server_port"]), sealed)
	if e != nil {
		return nil, 0, e
	}
	return finish(item("proxy_gateway", proxySafeGateway(rows[0])), 200, nil)
}
func proxyGatewayFields(d M) error {
	if proxyControls(str(d["server_host"])) || proxyControls(str(d["public_host"])) {
		return bad("gateway hosts contain unsupported characters")
	}
	if str(d["server_host"]) == "" || strings.ContainsAny(str(d["server_host"]), "/\r\n \t") || num(d["server_port"]) < 1 || num(d["server_port"]) > 65535 {
		return bad("server_host and server_port are required")
	}
	if strings.TrimSpace(str(d["name"])) == "" || strings.TrimSpace(str(d["public_host"])) == "" || strings.ContainsAny(str(d["public_host"]), "/\r\n \t") || num(d["public_port_start"]) < 1 || num(d["public_port_end"]) > 65535 || num(d["public_port_end"]) < num(d["public_port_start"]) {
		return bad("name, public_host and valid public port pool are required")
	}
	return nil
}

// Applied requires matching runtime running status as well as durable Store configuration.
func (a *App) proxyApply(ctx context.Context, tx pgx.Tx, route M) error {
	var origin, sealed string
	if e := tx.QueryRow(ctx, "SELECT admin_url,credentials_encrypted FROM proxy_node_clients WHERE id=$1", num(route["client_id"])).Scan(&origin, &sealed); e != nil {
		return fmt.Errorf("FRPC client unavailable")
	}
	if proxyPrivateURL(origin) != nil {
		return fmt.Errorf("FRPC private admin URL invalid")
	}
	raw, e := a.unseal(sealed)
	if e != nil {
		return fmt.Errorf("FRPC credentials cannot be decrypted")
	}
	var creds M
	if json.Unmarshal([]byte(raw), &creds) != nil {
		return fmt.Errorf("FRPC credentials invalid")
	}
	call := func(method, path string, body any) (M, int, error) {
		return proxyStoreCall(ctx, origin, str(creds["admin_user"]), str(creds["admin_password"]), method, path, body)
	}
	list, code, e := call("GET", "/api/store/proxies", nil)
	if e = proxyCapability(code, e); e != nil {
		return e
	}
	entries, ok := list["proxies"].([]any)
	if !ok {
		return fmt.Errorf("FRPC Store API unsupported response")
	}
	c := M{"admin_url": origin, "credentials_encrypted": sealed}
	var host string
	if e := tx.QueryRow(ctx, "SELECT server_host FROM proxy_gateways WHERE id=$1", num(route["gateway_id"])).Scan(&host); e != nil {
		return fmt.Errorf("gateway missing")
	}
	name := str(route["proxy_name"])
	var found M
	for _, v := range entries {
		m := asMap(v)
		if str(m["name"]) == name {
			found = m
			break
		}
	}
	if found != nil {
		b := asMap(found[str(route["protocol"])])
		if str(found["type"]) != str(route["protocol"]) || str(b["localIP"]) != str(route["local_ip"]) || num(b["localPort"]) != num(route["local_port"]) || num(b["remotePort"]) != num(route["public_port"]) {
			return fmt.Errorf("FRPC managed name contains a different mapping; refusing to modify it")
		}
	}
	if !boolean(route["desired_present"]) {
		if found == nil {
			return a.proxyCheckCollision(ctx, c, name)
		}
		_, code, e = call("DELETE", "/api/store/proxies/"+url.PathEscape(name), nil)
		if e != nil || code < 200 || code >= 300 {
			return fmt.Errorf("FRPC Store delete failed; retry reconcile")
		}
		m, code, e := call("GET", "/api/store/proxies", nil)
		if e = proxyCapability(code, e); e != nil {
			return e
		}
		for _, v := range asSlice(m["proxies"]) {
			if str(asMap(v)["name"]) == name {
				return fmt.Errorf("FRPC Store removal not confirmed; retry reconcile")
			}
		}
		return a.proxyCheckCollision(ctx, c, name)
	}
	var bindIP, clientURL string
	if e := tx.QueryRow(ctx, `SELECT al.ip,c.admin_url FROM allocations al JOIN servers s ON s.id=al.server_id JOIN proxy_node_clients c ON c.node_id=al.node_id WHERE al.id=$1 AND s.id=$2 AND s.node_id=al.node_id AND al.port=$3 AND c.id=$4 AND c.gateway_id=$5 FOR SHARE OF al,s,c`, num(route["allocation_id"]), num(route["server_id"]), num(route["local_port"]), num(route["client_id"]), num(route["gateway_id"])).Scan(&bindIP, &clientURL); e != nil || !gameFRPAllocationTargetMatches(bindIP, clientURL, str(route["local_ip"])) {
		return fmt.Errorf("allocation target changed; remove route before retry")
	}
	proto := str(route["protocol"])
	block := M{"localIP": str(route["local_ip"]), "localPort": num(route["local_port"]), "remotePort": num(route["public_port"])}
	if found != nil {
		b := asMap(found[proto])
		if str(found["type"]) == proto && str(b["localIP"]) == str(route["local_ip"]) && num(b["localPort"]) == num(route["local_port"]) && num(b["remotePort"]) == num(route["public_port"]) {
			return a.proxyRunning(ctx, c, name, proto, host, num(route["public_port"]))
		}
		return fmt.Errorf("FRPC managed proxy differs; remove route and reconcile before replacement")
	}
	if e = a.proxyCheckCollision(ctx, c, name); e != nil {
		return e
	}
	_, code, e = call("POST", "/api/store/proxies", M{"name": name, "type": proto, proto: block})
	if e != nil || code < 200 || code >= 300 {
		return fmt.Errorf("FRPC Store create failed; retry reconcile")
	}
	return a.proxyRunning(ctx, c, name, proto, host, num(route["public_port"]))
}
