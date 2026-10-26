package panel

import (
	"context"
	"encoding/json"
	"fmt"
	"gopkg.in/yaml.v3"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
	"unicode"
)

func proxyControls(s string) bool {
	for _, r := range s {
		if unicode.IsControl(r) {
			return true
		}
	}
	return false
}
func (a *App) proxyGatewaySecret(d M) (string, error) {
	if proxyControls(str(d["auth_token"])) {
		return "", bad("auth_token must not contain control characters")
	}
	if str(d["auth_token"]) == "" {
		return "", bad("auth_token is required")
	}
	v, e := a.seal(str(d["auth_token"]))
	if e != nil {
		return "", bad("ENCRYPTION_KEY is required for FRP credentials")
	}
	return v, nil
}
func (a *App) proxyClientRoutes(w http.ResponseWriter, r *http.Request) {
	s, e := a.server(r, "allocation.read")
	if e != nil {
		fail(w, e)
		return
	}
	rows, e := a.query(r.Context(), `SELECT r.id,g.public_host,r.public_port,r.local_port,r.protocol,r.status FROM proxy_routes r JOIN proxy_gateways g ON g.id=r.gateway_id WHERE r.server_id=$1 AND r.desired_present ORDER BY r.id`, num(s["id"]))
	if e != nil {
		fail(w, e)
		return
	}
	writeJSON(w, 200, collection("proxy_route", rows))
}
func (a *App) proxyDownload(w http.ResponseWriter, r *http.Request) {
	if _, e := a.requireAdmin(r); e != nil {
		fail(w, e)
		return
	}
	ctx := r.Context()
	gid := proxyID(r, "gateway")
	g, e := a.one(ctx, "SELECT * FROM proxy_gateways WHERE id=$1", gid)
	if e != nil {
		fail(w, notFound())
		return
	}
	token, e := a.unseal(str(g["auth_token_encrypted"]))
	if e != nil {
		fail(w, bad("gateway token cannot be decrypted"))
		return
	}
	q := strconv.Quote
	content := fmt.Sprintf("bindPort = %d\nauth.method = \"token\"\nauth.token = %s\nallowPorts = [{ start = %d, end = %d }]\n", num(g["server_port"]), q(token), num(g["public_port_start"]), num(g["public_port_end"]))
	name := "frps.toml"
	if cid := proxyID(r, "client"); cid != 0 {
		c, e := a.one(ctx, "SELECT * FROM proxy_node_clients WHERE id=$1 AND gateway_id=$2", cid, gid)
		if e != nil {
			fail(w, notFound())
			return
		}
		raw, e := a.unseal(str(c["credentials_encrypted"]))
		if e != nil {
			fail(w, bad("FRPC credentials cannot be decrypted"))
			return
		}
		var creds M
		if json.Unmarshal([]byte(raw), &creds) != nil {
			fail(w, bad("FRPC credentials invalid"))
			return
		}
		u, _ := url.Parse(str(c["admin_url"]))
		port := u.Port()
		if port == "" {
			if u.Scheme == "https" {
				port = "443"
			} else {
				port = "80"
			}
		}
		content = fmt.Sprintf("serverAddr = %s\nserverPort = %d\nauth.method = \"token\"\nauth.token = %s\nwebServer.addr = %s\nwebServer.port = %s\nwebServer.user = %s\nwebServer.password = %s\nstore.path = \"/var/lib/voltra-frp/frpc-store.json\"\n", q(str(g["server_host"])), num(g["server_port"]), q(token), q(u.Hostname()), port, q(str(creds["admin_user"])), q(str(creds["admin_password"])))
		if u.Scheme == "https" {
			content += "webServer.tls.certFile = \"/etc/voltra-frp/admin.crt\"\nwebServer.tls.keyFile = \"/etc/voltra-frp/admin.key\"\n"
		}
		name = "frpc.toml"
	}
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/toml")
	w.Header().Set("Content-Disposition", `attachment; filename="`+name+`"`)
	io.WriteString(w, content)
}
func (a *App) proxyClientCall(ctx context.Context, c M, method, path string, body any) (M, int, error) {
	raw, e := a.unseal(str(c["credentials_encrypted"]))
	if e != nil {
		return nil, 0, fmt.Errorf("FRPC credentials cannot be decrypted")
	}
	var creds M
	if json.Unmarshal([]byte(raw), &creds) != nil {
		return nil, 0, fmt.Errorf("FRPC credentials invalid")
	}
	return proxyStoreCall(ctx, str(c["admin_url"]), str(creds["admin_user"]), str(creds["admin_password"]), method, path, body)
}
func proxyCapability(code int, e error) error {
	if code == 401 || code == 403 {
		return fmt.Errorf("FRPC admin authentication failed")
	}
	if code == 404 {
		return fmt.Errorf("FRPC Store unsupported or disabled; require FRP v0.68.0 or newer and store.path")
	}
	if e != nil || code != 200 {
		return fmt.Errorf("FRPC Store unavailable or incompatible")
	}
	return nil
}
func (a *App) proxyRunning(ctx context.Context, c M, name, proto, host string, port int64) error {
	m, code, e := a.proxyClientCall(ctx, c, "GET", "/api/status", nil)
	if e != nil || code != 200 {
		return fmt.Errorf("FRPC runtime status unavailable")
	}
	for _, v := range asSlice(m[proto]) {
		s := asMap(v)
		if str(s["name"]) != name {
			continue
		}
		if str(s["status"]) != "running" || str(s["err"]) != "" {
			return fmt.Errorf("FRPC proxy is not running; inspect private FRPC logs")
		}
		h, p, e := net.SplitHostPort(str(s["remote_addr"]))
		if e != nil || p != strconv.FormatInt(port, 10) || !strings.EqualFold(h, host) {
			return fmt.Errorf("FRPC runtime remote binding does not match gateway")
		}
		return nil
	}
	return fmt.Errorf("FRPC proxy is starting or absent; retry reconcile")
}

// The saved config comparison is not an attestation of the running session's token.
func (a *App) proxyCheckConfig(ctx context.Context, c, g M) error {
	m, code, e := a.proxyClientCall(ctx, c, "GET", "/api/config", nil)
	if e != nil || code != 200 {
		return fmt.Errorf("FRPC saved configuration cannot be verified")
	}
	raw := str(m["_raw_config"])
	cfg := M{}
	if json.Unmarshal([]byte(raw), &cfg) != nil {
		if yaml.Unmarshal([]byte(raw), &cfg) != nil || cfg["serverAddr"] == nil {
			cfg = M{}
			for _, line := range strings.Split(raw, "\n") {
				k, v, ok := strings.Cut(strings.TrimSpace(line), "=")
				if !ok {
					continue
				}
				k = strings.TrimSpace(k)
				v = strings.TrimSpace(v)
				if strings.HasPrefix(v, "\"") {
					x, e := strconv.Unquote(v)
					if e != nil {
						return fmt.Errorf("FRPC saved configuration format cannot be verified")
					}
					cfg[k] = x
				} else {
					cfg[k] = v
				}
			}
		}
	}
	auth := asMap(cfg["auth"])
	method := str(cfg["auth.method"])
	token := str(cfg["auth.token"])
	if method == "" {
		method = str(auth["method"])
	}
	if token == "" {
		token = str(auth["token"])
	}
	saved, e := a.unseal(str(g["auth_token_encrypted"]))
	if e != nil {
		return fmt.Errorf("gateway token cannot be decrypted")
	}
	if str(cfg["serverAddr"]) != str(g["server_host"]) || num(cfg["serverPort"]) != num(g["server_port"]) || method != "token" || token != saved {
		return fmt.Errorf("FRPC saved host, control port or token differs; install downloaded config and start FRPC with it")
	}
	return nil
}
func (a *App) proxySetupTest(w http.ResponseWriter, r *http.Request) {
	if _, e := a.requireAdmin(r); e != nil {
		fail(w, e)
		return
	}
	ctx := r.Context()
	gid, cid := proxyID(r, "gateway"), proxyID(r, "client")
	// Session advisory lock survives commits, serializes wizard/reconcile/route allocation via gateway row lock below.
	conn, e := a.DB.Acquire(ctx)
	if e != nil {
		fail(w, e)
		return
	}
	defer conn.Release()
	key := "proxy-wizard-" + strconv.FormatInt(gid, 10)
	if _, e = conn.Exec(ctx, "SELECT pg_advisory_lock(hashtextextended(current_schema()||$1,0))", key); e != nil {
		fail(w, e)
		return
	}
	defer func() {
		unlockCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if _, e := conn.Exec(unlockCtx, "SELECT pg_advisory_unlock(hashtextextended(current_schema()||$1,0))", key); e != nil {
			_ = conn.Conn().Close(unlockCtx)
		}
	}()
	tx, e := conn.Begin(ctx)
	if e != nil {
		fail(w, e)
		return
	}
	defer tx.Rollback(ctx)
	var id int64
	if e = tx.QueryRow(ctx, "SELECT id FROM proxy_gateways WHERE id=$1 FOR UPDATE", gid).Scan(&id); e != nil {
		fail(w, notFound())
		return
	}
	g, e := a.one(ctx, "SELECT * FROM proxy_gateways WHERE id=$1", gid)
	if e != nil {
		fail(w, notFound())
		return
	}
	c, e := a.one(ctx, "SELECT * FROM proxy_node_clients WHERE id=$1 AND gateway_id=$2", cid, gid)
	if e != nil {
		fail(w, notFound())
		return
	}
	if c["test_public_port"] == nil {
		var port int64
		e = tx.QueryRow(ctx, `SELECT p FROM generate_series($1::int,$2::int) p WHERE NOT EXISTS(SELECT 1 FROM proxy_routes WHERE gateway_id=$3 AND public_port=p) AND NOT EXISTS(SELECT 1 FROM proxy_node_clients WHERE gateway_id=$3 AND test_public_port=p) ORDER BY p LIMIT 1`, num(g["public_port_start"]), num(g["public_port_end"]), gid).Scan(&port)
		if e != nil {
			fail(w, proxyConflict("no unused public port available for setup test"))
			return
		}
		c["test_public_port"] = port
		c["test_proxy_name"] = "voltra-test-" + newUUID()
	}
	_, e = tx.Exec(ctx, "UPDATE proxy_node_clients SET setup_complete=false,test_status='testing',test_error='',test_public_port=$2,test_proxy_name=$3 WHERE id=$1", cid, num(c["test_public_port"]), str(c["test_proxy_name"]))
	if e == nil {
		e = tx.Commit(ctx)
	}
	if e != nil {
		fail(w, e)
		return
	}
	// Reservation is now durable even if this process dies. All later cleanup uses the same owned name.
	testErr := a.proxyRunTest(ctx, c, g)
	cleanupCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	cleanErr := a.proxyTestCleanup(cleanupCtx, c)
	complete := testErr == nil && cleanErr == nil
	message := ""
	status := "complete"
	if testErr != nil {
		message = testErr.Error()
		status = "error"
	}
	if cleanErr != nil {
		message = "temporary proxy cleanup unconfirmed; retry test to release reserved port"
		status = "cleanup_error"
	}
	var port any
	if cleanErr != nil {
		port = num(c["test_public_port"])
	}
	saveCtx, saveCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer saveCancel()
	_, e = conn.Exec(saveCtx, "UPDATE proxy_node_clients SET setup_complete=$2,test_status=$3,test_error=$4,test_public_port=$5,updated_at=now() WHERE id=$1", cid, complete, status, message, port)
	if e != nil {
		fail(w, fmt.Errorf("setup result could not be saved; retry test cleanup"))
		return
	}
	row, e := a.one(saveCtx, "SELECT * FROM proxy_node_clients WHERE id=$1", cid)
	if e != nil {
		fail(w, e)
		return
	}
	writeJSON(w, 200, item("proxy_node_client", proxySafeClient(row)))
}
func (a *App) proxyTestCleanup(ctx context.Context, c M) error {
	name := str(c["test_proxy_name"])
	m, code, e := a.proxyClientCall(ctx, c, "GET", "/api/store/proxies", nil)
	if proxyCapability(code, e) != nil {
		return fmt.Errorf("cleanup unavailable")
	}
	present := false
	for _, v := range asSlice(m["proxies"]) {
		if str(asMap(v)["name"]) == name {
			m := asMap(v)
			b := asMap(m["tcp"])
			if str(m["type"]) != "tcp" || str(b["localIP"]) != "127.0.0.1" || num(b["localPort"]) != 9 || num(b["remotePort"]) != num(c["test_public_port"]) {
				return fmt.Errorf("temporary proxy name has a different mapping; cleanup refused")
			}
			present = true
		}
	}
	if present {
		_, code, e = a.proxyClientCall(ctx, c, "DELETE", "/api/store/proxies/"+url.PathEscape(name), nil)
		if e != nil || code < 200 || code >= 300 {
			return fmt.Errorf("cleanup failed")
		}
	}
	m, code, e = a.proxyClientCall(ctx, c, "GET", "/api/store/proxies", nil)
	if proxyCapability(code, e) != nil {
		return fmt.Errorf("cleanup not confirmed")
	}
	for _, v := range asSlice(m["proxies"]) {
		if str(asMap(v)["name"]) == name {
			return fmt.Errorf("cleanup not confirmed")
		}
	}
	return a.proxyCheckCollision(ctx, c, name)
}
func (a *App) proxyRunTest(ctx context.Context, c, g M) error {
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	if e := a.proxyTestCleanup(ctx, c); e != nil {
		return e
	}
	if e := a.proxyCheckConfig(ctx, c, g); e != nil {
		return e
	}
	name := str(c["test_proxy_name"])
	if e := a.proxyCheckCollision(ctx, c, name); e != nil {
		return e
	}
	_, code, e := a.proxyClientCall(ctx, c, "POST", "/api/store/proxies", M{"name": name, "type": "tcp", "tcp": M{"localIP": "127.0.0.1", "localPort": 9, "remotePort": num(c["test_public_port"])}})
	if e != nil || code < 200 || code >= 300 {
		return fmt.Errorf("temporary proxy creation failed")
	}
	for i := 0; i < 12; i++ {
		if e = a.proxyRunning(ctx, c, name, "tcp", str(g["server_host"]), num(c["test_public_port"])); e == nil {
			return nil
		}
		select {
		case <-ctx.Done():
			return fmt.Errorf("temporary proxy runtime verification timed out")
		case <-time.After(250 * time.Millisecond):
		}
	}
	return fmt.Errorf("temporary proxy did not reach running state at intended gateway")
}
func (a *App) proxyCheckCollision(ctx context.Context, c M, name string) error {
	m, code, e := a.proxyClientCall(ctx, c, "GET", "/api/status", nil)
	if e != nil || code != 200 {
		return fmt.Errorf("FRPC status capability unavailable")
	}
	found, e := proxyStatusContains(m, name)
	if e != nil {
		return e
	}
	if found {
		return fmt.Errorf("FRPC proxy name already exists outside managed Store entry")
	}
	return nil
}
