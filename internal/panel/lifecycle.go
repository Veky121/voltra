package panel

import (
	"bytes"
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/ssh"
)

// Keep the default daemon transports pooled across requests. Configuring a
// connect timeout must not disable HTTP keep-alive by creating a new transport
// for every file operation or resource poll.
var daemonTransports sync.Map

type daemonTimeoutContextKey struct{}

// withDaemonTimeout supplies an operation-specific network timeout. Archive
// creation/extraction use the native fifteen-minute allowance rather than the
// normal short daemon request timeout configured in panel settings.
func withDaemonTimeout(ctx context.Context, duration time.Duration) context.Context {
	return context.WithValue(ctx, daemonTimeoutContextKey{}, duration)
}

func (a *App) registerLifecycle(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/application/servers", a.lifecycleList)
	mux.HandleFunc("POST /api/application/servers", a.lifecycleCreate)
	// The core dispatches external-ID lookups before ServeMux to avoid an
	// ambiguous pattern intersection with native server database routes.
	mux.HandleFunc("GET /api/application/servers/{server}", a.lifecycleGet)
	mux.HandleFunc("PATCH /api/application/servers/{server}/details", a.lifecycleDetails)
	mux.HandleFunc("PATCH /api/application/servers/{server}/build", a.lifecycleBuild)
	mux.HandleFunc("PATCH /api/application/servers/{server}/startup", a.lifecycleStartup)
	mux.HandleFunc("POST /api/application/servers/{server}/suspend", a.lifecycleSuspend)
	mux.HandleFunc("POST /api/application/servers/{server}/unsuspend", a.lifecycleSuspend)
	mux.HandleFunc("POST /api/application/servers/{server}/reinstall", a.lifecycleReinstall)
	mux.HandleFunc("DELETE /api/application/servers/{server}", a.lifecycleDelete)
	mux.HandleFunc("DELETE /api/application/servers/{server}/{force}", a.lifecycleDelete)
	mux.HandleFunc("POST /api/admin/servers/{server}/install", a.lifecycleInstallToggle)
	mux.HandleFunc("GET /api/admin/servers/{server}/configuration", a.lifecycleConfiguration)
	for _, prefix := range []string{"/api/admin/servers", "/api/application/servers"} {
		if prefix == "/api/admin/servers" {
			mux.HandleFunc("GET "+prefix+"/{server}/mounts", a.lifecycleMounts)
			mux.HandleFunc("GET "+prefix+"/{server}/transfer", a.lifecycleTransfer)
		}
		mux.HandleFunc("POST "+prefix+"/{server}/mounts", a.lifecycleMounts)
		mux.HandleFunc("DELETE "+prefix+"/{server}/mounts/{mount}", a.lifecycleMounts)
		mux.HandleFunc("POST "+prefix+"/{server}/transfer", a.lifecycleTransfer)
		mux.HandleFunc("DELETE "+prefix+"/{server}/transfer", a.lifecycleTransfer)
	}
	mux.HandleFunc("GET /api/remote/servers", a.remoteServers)
	mux.HandleFunc("POST /api/remote/servers/reset", a.remoteReset)
	mux.HandleFunc("GET /api/remote/servers/{uuid}", a.remoteServer)
	mux.HandleFunc("GET /api/remote/servers/{uuid}/install", a.remoteInstall)
	mux.HandleFunc("POST /api/remote/servers/{uuid}/install", a.remoteInstall)
	mux.HandleFunc("POST /api/remote/servers/{uuid}/transfer/{result}", a.remoteTransfer)
	mux.HandleFunc("POST /api/remote/activity", a.remoteActivity)
	mux.HandleFunc("POST /api/remote/sftp/auth", a.remoteSFTP)
	mux.HandleFunc("POST /api/remote/backups/{backup}", a.remoteBackup)
	mux.HandleFunc("POST /api/remote/backups/{backup}/restore", a.remoteBackup)
}

func (a *App) lifecycleConfiguration(w http.ResponseWriter, r *http.Request) {
	s, e := a.lifecycleAdminServer(r)
	if e != nil {
		fail(w, e)
		return
	}
	v, e := a.remoteEnvelope(r.Context(), s)
	if e != nil {
		fail(w, e)
		return
	}
	writeJSON(w, 200, v)
}
func (a *App) lifecycleInstallToggle(w http.ResponseWriter, r *http.Request) {
	s, e := a.lifecycleAdminServer(r)
	if e != nil {
		fail(w, e)
		return
	}
	d, e := decode(r)
	if e != nil {
		fail(w, e)
		return
	}
	installed, ok := d["installed"].(bool)
	if !ok {
		fail(w, bad("installed must be a boolean."))
		return
	}
	patch := M{"status": "installing", "installed_at": nil}
	if installed {
		patch = M{"status": nil, "installed_at": time.Now().UTC()}
	}
	if str(s["status"]) == "suspended" {
		patch["status"] = "suspended"
	}
	_, e = a.update(r.Context(), "servers", num(s["id"]), patch)
	if e != nil {
		fail(w, e)
		return
	}
	_ = a.audit(r.Context(), UserID(r), num(s["id"]), "server:install.toggle", d)
	writeJSON(w, 204, nil)
}

func (a *App) node(ctx context.Context, id int64) (M, error) {
	node, err := a.one(ctx, "SELECT * FROM nodes WHERE id=$1", id)
	if err != nil {
		return nil, err
	}
	token, err := a.unseal(str(node["daemon_token"]))
	if err != nil {
		return nil, err
	}
	node["daemon_token"] = token
	return node, nil
}

func daemonAddress(node M) string {
	host := str(node["fqdn"])
	if strings.Contains(host, "://") {
		if u, e := url.Parse(host); e == nil {
			host = u.Hostname()
		}
	}
	scheme := str(node["scheme"])
	if scheme == "" {
		scheme = "http"
	}
	return scheme + "://" + net.JoinHostPort(strings.Trim(host, "[]"), strconv.FormatInt(num(node["daemon_listen"]), 10))
}

func (a *App) daemon(ctx context.Context, node M, method, path string, body any) (*http.Response, error) {
	if !strings.HasPrefix(path, "/") || strings.HasPrefix(path, "//") {
		return nil, bad("Invalid Wings request path.")
	}
	var reader io.Reader
	if body != nil {
		if r, ok := body.(io.Reader); ok {
			reader = r
		} else {
			b, e := json.Marshal(body)
			if e != nil {
				return nil, e
			}
			reader = bytes.NewReader(b)
		}
	}
	req, err := http.NewRequestWithContext(ctx, method, daemonAddress(node)+path, reader)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+str(node["daemon_token"]))
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	client := a.HTTP
	if client == nil {
		client = &http.Client{Timeout: 45 * time.Second}
	}
	if a.DB != nil {
		settings, e := a.query(ctx, "SELECT key,value FROM settings WHERE key IN ('pterodactyl:guzzle:timeout','pterodactyl:guzzle:connect_timeout')")
		if e != nil {
			return nil, e
		}
		timeout, connect := 30*time.Second, 10*time.Second
		for _, s := range settings {
			duration := time.Duration(num(s["value"])) * time.Second
			if duration < time.Second || duration > 60*time.Second {
				continue
			}
			if str(s["key"]) == "pterodactyl:guzzle:timeout" {
				timeout = duration
			} else {
				connect = duration
			}
		}
		configured := *client
		configured.Timeout = timeout
		if client.Transport == nil {
			transport, ok := daemonTransports.Load(connect)
			if !ok {
				candidate := http.DefaultTransport.(*http.Transport).Clone()
				candidate.DialContext = (&net.Dialer{Timeout: connect, KeepAlive: 30 * time.Second}).DialContext
				transport, _ = daemonTransports.LoadOrStore(connect, candidate)
			}
			configured.Transport = transport.(*http.Transport)
		}
		client = &configured
	}
	if duration, ok := ctx.Value(daemonTimeoutContextKey{}).(time.Duration); ok && duration > 0 {
		configured := *client
		configured.Timeout = duration
		client = &configured
	}
	if str(node["connection_mode"]) == "outbound" {
		configured := *client
		configured.Transport = a.connectorTransport(node)
		client = &configured
	}
	res, err := client.Do(req)
	if err != nil {
		return nil, &APIError{Status: 502, Code: "DaemonConnectionException", Detail: "Could not communicate with Wings: " + err.Error()}
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		defer res.Body.Close()
		data, _ := io.ReadAll(io.LimitReader(res.Body, 8192))
		var d M
		_ = json.Unmarshal(data, &d)
		detail := str(d["error"])
		if detail == "" {
			detail = http.StatusText(res.StatusCode)
		}
		status := 502
		if res.StatusCode == 409 || res.StatusCode == 400 || res.StatusCode == 422 || res.StatusCode == 404 || res.StatusCode == 413 || res.StatusCode == 429 {
			status = res.StatusCode
		}
		return nil, &APIError{Status: status, Code: "DaemonRequestException", Detail: fmt.Sprintf("Wings returned %d: %s", res.StatusCode, detail)}
	}
	return res, nil
}

func (a *App) daemonServer(ctx context.Context, server M, method, pathSuffix string, body any) (*http.Response, error) {
	if method == http.MethodPost && pathSuffix == "/reinstall" {
		if err := blockPublicSteamOwnership(ctx, a.DB, num(server["id"])); err != nil {
			return nil, err
		}
	}
	if method == http.MethodPost && pathSuffix == "/power" {
		return a.managedServerPower(ctx, server, str(asMap(body)["action"]))
	}
	return a.daemonServerRaw(ctx, server, method, pathSuffix, body)
}
func (a *App) daemonServerRaw(ctx context.Context, server M, method, pathSuffix string, body any) (*http.Response, error) {
	node, err := a.node(ctx, num(server["node_id"]))
	if err != nil {
		return nil, err
	}
	return a.daemon(ctx, node, method, "/api/servers/"+url.PathEscape(str(server["uuid"]))+pathSuffix, body)
}
func (a *App) syncServer(ctx context.Context, server M) error {
	res, err := a.daemonServer(ctx, server, "POST", "/sync", nil)
	if err == nil {
		res.Body.Close()
	}
	return err
}

func (a *App) serverEnvironment(ctx context.Context, server M) (M, error) {
	vars, err := a.query(ctx, "SELECT ev.env_variable,COALESCE(sv.variable_value,ev.default_value) AS value FROM egg_variables ev LEFT JOIN server_variables sv ON sv.variable_id=ev.id AND sv.server_id=$1 WHERE ev.egg_id=$2", server["id"], server["egg_id"])
	if err != nil {
		return nil, err
	}
	env := M{}
	for _, v := range vars {
		env[str(v["env_variable"])] = v["value"]
	}
	env["STARTUP"] = server["startup"]
	env["P_SERVER_UUID"] = server["uuid"]
	loc, err := a.one(ctx, "SELECT l.short FROM locations l JOIN nodes n ON n.location_id=l.id WHERE n.id=$1", server["node_id"])
	if err != nil {
		return nil, err
	}
	env["P_SERVER_LOCATION"] = loc["short"]
	return env, nil
}

func (a *App) serverConfig(ctx context.Context, server M) (M, error) {
	env, err := a.serverEnvironment(ctx, server)
	if err != nil {
		return nil, err
	}
	if err = a.resolveServerIntegrationSecrets(ctx, num(server["id"]), env); err != nil {
		return nil, err
	}
	if err = a.steamCatalogRuntimeEnvironment(ctx, server, env); err != nil {
		return nil, err
	}
	egg, err := a.serverEffectiveEgg(ctx, server)
	if err != nil {
		return nil, err
	}
	if err = templateRuntimeEnvironment(egg, env); err != nil {
		return nil, err
	}

	effective, err := a.javaResolve(ctx, egg, asMap(server["java_config"]), num(server["memory"]))
	if err != nil {
		return nil, err
	}
	invocation, javaEnv, err := javaInvocation(egg, server, effective)
	if err != nil {
		return nil, err
	}
	for k, v := range javaEnv {
		env[k] = v
	}
	env["STARTUP"] = invocation
	image := server["image"]
	if len(effective) > 0 {
		image = effective["image"]
		for _, k := range []string{"JAVA_TOOL_OPTIONS", "JDK_JAVA_OPTIONS", "_JAVA_OPTIONS"} {
			if v, ok := env[k]; ok {
				env[k] = javaStripMemory(str(v))
			}
		}
	}
	minecraftRuntimePropertyEnums(egg, env, str(image))
	allocs, err := a.query(ctx, "SELECT * FROM allocations WHERE server_id=$1 AND node_id=$2 ORDER BY id", server["id"], server["node_id"])
	if err != nil {
		return nil, err
	}
	mappings := M{}
	def := M{}
	for _, v := range allocs {
		ip := str(v["ip"])
		ports, _ := mappings[ip].([]int64)
		mappings[ip] = append(ports, num(v["port"]))
		if num(v["id"]) == num(server["allocation_id"]) {
			def = M{"ip": v["ip"], "port": v["port"]}
		}
	}
	if len(def) == 0 {
		return nil, bad("Server has no valid primary allocation.")
	}
	// Multi-instance games can use only ports allocated on their advertised IP.
	// Derive this after egg variables so a submitted environment cannot spoof it.
	allocatedPorts := []string{}
	seenPorts := map[int64]bool{}
	for _, allocation := range allocs {
		port := num(allocation["port"])
		if str(allocation["ip"]) == str(def["ip"]) && !seenPorts[port] {
			allocatedPorts = append(allocatedPorts, strconv.FormatInt(port, 10))
			seenPorts[port] = true
		}
	}
	env["VOLTRA_ALLOCATED_PORTS"] = strings.Join(allocatedPorts, ",")
	mounts, err := a.query(ctx, "SELECT m.source,m.target,m.read_only FROM mounts m JOIN mount_servers ms ON ms.mount_id=m.id WHERE ms.server_id=$1 ORDER BY m.id", server["id"])
	if err != nil {
		return nil, err
	}
	if mounts == nil {
		mounts = []M{}
	}
	return M{"uuid": server["uuid"], "meta": M{"name": server["name"], "description": server["description"]}, "suspended": str(server["status"]) == "suspended", "environment": env, "invocation": invocation, "skip_egg_scripts": server["skip_scripts"], "build": M{"memory_limit": server["memory"], "swap": server["swap"], "io_weight": server["io"], "cpu_limit": server["cpu"], "threads": server["threads"], "disk_space": server["disk"], "oom_disabled": server["oom_disabled"]}, "container": M{"image": image, "oom_disabled": server["oom_disabled"], "requires_rebuild": false}, "allocations": M{"force_outgoing_ip": egg["force_outgoing_ip"], "default": def, "mappings": mappings}, "mounts": mounts, "egg": M{"id": egg["uuid"], "file_denylist": egg["file_denylist"]}}, nil
}

func serverLimits(s M) M {
	v := M{}
	for _, k := range []string{"memory", "swap", "disk", "io", "cpu", "threads", "oom_disabled"} {
		v[k] = s[k]
	}
	return v
}
func serverInstalled(s M) bool {
	return str(s["status"]) != "installing" && str(s["status"]) != "install_failed"
}
func serverFeatures(s M) M {
	return M{"databases": s["database_limit"], "allocations": s["allocation_limit"], "backups": s["backup_limit"]}
}

func (a *App) clientServer(ctx context.Context, user M, s M) (M, error) {
	node, err := a.node(ctx, num(s["node_id"]))
	if err != nil {
		return nil, err
	}
	egg, err := a.serverEffectiveEgg(ctx, s)
	if err != nil {
		return nil, err
	}
	allocs, err := a.query(ctx, "SELECT * FROM allocations WHERE server_id=$1 ORDER BY id", s["id"])
	if err != nil {
		return nil, err
	}
	visible := []M{}
	canRead := a.can(ctx, user, s, "allocation.read")
	for _, v := range allocs {
		if !canRead && num(v["id"]) != num(s["allocation_id"]) {
			continue
		}
		if !canRead {
			v["notes"] = nil
		}
		v["is_default"] = num(v["id"]) == num(s["allocation_id"])
		v["alias"] = v["ip_alias"]
		visible = append(visible, v)
	}
	variables := []M{}
	invocation := str(s["startup"])
	vars, err := a.query(ctx, "SELECT ev.*,sv.id IS NOT NULL AS is_overridden,COALESCE(sv.variable_value,ev.default_value) server_value FROM egg_variables ev LEFT JOIN server_variables sv ON sv.variable_id=ev.id AND sv.server_id=$1 WHERE ev.egg_id=$2 ORDER BY ev.id", s["id"], s["egg_id"])
	if err != nil {
		return nil, err
	}
	startupRead := a.can(ctx, user, s, "startup.read")
	invocation, javaDisplay := a.javaReadable(ctx, egg, s, startupRead)
	if err = a.maskIntegrationVariables(ctx, num(s["id"]), vars); err != nil {
		return nil, err
	}
	if err = a.steamCatalogMaskVariables(ctx, s, vars); err != nil {
		return nil, err
	}
	if err = a.annotateStartupFields(ctx, s, vars); err != nil {
		return nil, err
	}
	for _, v := range vars {
		value := str(v["server_value"])
		if !startupRead || !boolean(v["user_viewable"]) || boolean(v["secret"]) {
			value = "[hidden]"
		}
		invocation = strings.ReplaceAll(invocation, "{{"+str(v["env_variable"])+"}}", value)
		if startupRead && boolean(v["user_viewable"]) {
			variables = append(variables, v)
		}
	}
	allocation, err := a.one(ctx, "SELECT * FROM allocations WHERE id=$1", s["allocation_id"])
	if err != nil {
		return nil, err
	}
	invocation = strings.ReplaceAll(invocation, "{{SERVER_PORT}}", str(allocation["port"]))
	invocation = strings.ReplaceAll(invocation, "{{SERVER_MEMORY}}", str(s["memory"]))
	invocation = strings.ReplaceAll(invocation, "{{SERVER_IP}}", str(allocation["ip"]))
	invocation = maskStartupArguments(invocation)
	transfers, err := a.query(ctx, "SELECT id FROM server_transfers WHERE server_id=$1 AND successful IS NULL", s["id"])
	if err != nil {
		return nil, err
	}
	return M{"server_owner": num(user["id"]) == num(s["owner_id"]), "identifier": s["uuid_short"], "__deprecated_uuid_short": s["uuid_short"], "server_identifier": s["identifier"], "internal_id": s["id"], "uuid": s["uuid"], "name": s["name"], "node": node["name"], "is_node_under_maintenance": node["maintenance_mode"], "sftp_details": M{"ip": node["fqdn"], "port": node["daemon_sftp"]}, "description": s["description"], "limits": serverLimits(s), "feature_limits": serverFeatures(s), "invocation": invocation, "java_managed": javaDisplay["java_managed"], "java_effective_error": javaDisplay["java_effective_error"], "docker_image": s["image"], "game": clientGameID(egg), "steam_managed": steamGameID(egg) != "", "egg_features": egg["features"], "status": s["status"], "is_suspended": str(s["status"]) == "suspended", "is_installing": !serverInstalled(s), "is_transferring": len(transfers) > 0, "skip_scripts": s["skip_scripts"], "artwork": a.clientArtworkMetadata(ctx, user, s, egg), "relationships": M{"allocations": collection("allocation", visible), "variables": collection("egg_variable", variables)}}, nil
}

func (a *App) applicationServer(ctx context.Context, s M) (M, error) {
	env, err := a.serverEnvironment(ctx, s)
	if err != nil {
		return nil, err
	}
	out := M{"id": s["id"], "java_config": asMap(s["java_config"]), "external_id": s["external_id"], "uuid": s["uuid"], "identifier": s["uuid_short"], "name": s["name"], "description": s["description"], "status": s["status"], "suspended": str(s["status"]) == "suspended", "limits": serverLimits(s), "feature_limits": serverFeatures(s), "user": s["owner_id"], "node": s["node_id"], "allocation": s["allocation_id"], "nest": s["nest_id"], "egg": s["egg_id"], "container": M{"startup_command": s["startup"], "image": s["image"], "installed": map[bool]int{true: 1, false: 0}[serverInstalled(s)], "environment": env, "skip_scripts": s["skip_scripts"]}, "created_at": s["created_at"], "updated_at": s["updated_at"]}
	return out, nil
}

func (a *App) lifecycleClientList(w http.ResponseWriter, r *http.Request) {
	user, err := a.user(r)
	if err != nil {
		fail(w, err)
		return
	}
	q := "SELECT DISTINCT s.* FROM servers s LEFT JOIN subusers su ON su.server_id=s.id WHERE ($1::boolean OR s.owner_id=$2 OR su.user_id=$2) ORDER BY s.id"
	servers, err := a.query(r.Context(), q, boolean(user["root_admin"]), user["id"])
	if err != nil {
		fail(w, err)
		return
	}
	out := []M{}
	for _, s := range servers {
		if f := r.URL.Query().Get("filter[name]"); f != "" && !strings.Contains(strings.ToLower(str(s["name"])), strings.ToLower(f)) {
			continue
		}
		if r.URL.Query().Get("type") == "owner" && num(s["owner_id"]) != num(user["id"]) {
			continue
		}
		v, e := a.clientServer(r.Context(), user, s)
		if e != nil {
			fail(w, e)
			return
		}
		out = append(out, v)
	}
	writeJSON(w, 200, collection("server", out))
}
func (a *App) lifecycleClientGet(w http.ResponseWriter, r *http.Request) {
	s, err := a.server(r, "")
	if err != nil {
		fail(w, err)
		return
	}
	u, err := a.user(r)
	if err != nil {
		fail(w, err)
		return
	}
	v, err := a.clientServer(r.Context(), u, s)
	if err != nil {
		fail(w, err)
		return
	}
	out := item("server", v)
	permissions := []string{}
	if boolean(u["root_admin"]) || num(u["id"]) == num(s["owner_id"]) {
		permissions = []string{"*"}
	} else {
		sub, e := a.one(r.Context(), "SELECT permissions FROM subusers WHERE user_id=$1 AND server_id=$2", u["id"], s["id"])
		if e != nil {
			fail(w, e)
			return
		}
		for _, p := range asSlice(sub["permissions"]) {
			permissions = append(permissions, str(p))
		}
	}
	out["meta"] = M{"is_server_owner": num(u["id"]) == num(s["owner_id"]), "user_permissions": permissions}
	writeJSON(w, 200, out)
}
func (a *App) lifecycleAdminServer(r *http.Request) (M, error) {
	if _, err := a.requireAdmin(r); err != nil {
		return nil, err
	}
	id := r.PathValue("server")
	return a.one(r.Context(), "SELECT * FROM servers WHERE id::text=$1 OR uuid=$1 OR uuid_short=$1 OR identifier=$1", id)
}
func (a *App) lifecycleList(w http.ResponseWriter, r *http.Request) {
	if _, err := a.requireAdmin(r); err != nil {
		fail(w, err)
		return
	}
	ss, err := a.query(r.Context(), "SELECT * FROM servers ORDER BY id")
	if err != nil {
		fail(w, err)
		return
	}
	out := []M{}
	for _, s := range ss {
		if f := r.URL.Query().Get("filter[name]"); f != "" && !strings.Contains(strings.ToLower(str(s["name"])), strings.ToLower(f)) {
			continue
		}
		matched := true
		for _, k := range []string{"id", "uuid", "external_id", "owner_id", "node_id"} {
			if f := r.URL.Query().Get("filter[" + k + "]"); f != "" && str(s[k]) != f {
				matched = false
				break
			}
		}
		if !matched {
			continue
		}
		v, e := a.applicationServer(r.Context(), s)
		if e != nil {
			fail(w, e)
			return
		}
		if e = a.applicationServerIncludes(r, s, v); e != nil {
			fail(w, e)
			return
		}
		out = append(out, v)
	}
	per, _ := strconv.Atoi(r.URL.Query().Get("per_page"))
	if per < 1 {
		per = 50
	}
	if per > 100 {
		per = 100
	}
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	if page < 1 {
		page = 1
	}
	total := len(out)
	start := (page - 1) * per
	if start > total {
		start = total
	}
	end := start + per
	if end > total {
		end = total
	}
	last := (total + per - 1) / per
	if last == 0 {
		last = 1
	}
	response := collection("server", out[start:end])
	response["meta"] = M{"pagination": M{"total": total, "count": end - start, "per_page": per, "current_page": page, "total_pages": last, "links": M{}}}
	writeJSON(w, 200, response)
}
func (a *App) lifecycleGet(w http.ResponseWriter, r *http.Request) {
	s, e := a.lifecycleAdminServer(r)
	if e != nil {
		fail(w, e)
		return
	}
	v, e := a.applicationServer(r.Context(), s)
	if e != nil {
		fail(w, e)
		return
	}
	if e = a.applicationServerIncludes(r, s, v); e != nil {
		fail(w, e)
		return
	}
	writeJSON(w, 200, item("server", v))
}
func (a *App) lifecycleExternal(w http.ResponseWriter, r *http.Request) {
	if _, e := a.requireAdmin(r); e != nil {
		fail(w, e)
		return
	}
	s, e := a.one(r.Context(), "SELECT * FROM servers WHERE external_id=$1", r.PathValue("external"))
	if e != nil {
		fail(w, e)
		return
	}
	v, e := a.applicationServer(r.Context(), s)
	if e != nil {
		fail(w, e)
		return
	}
	if e = a.applicationServerIncludes(r, s, v); e != nil {
		fail(w, e)
		return
	}
	writeJSON(w, 200, item("server", v))
}

func (a *App) applicationServerIncludes(r *http.Request, s, out M) error {
	relationships := M{}
	ctx := r.Context()
	for _, include := range strings.Split(r.URL.Query().Get("include"), ",") {
		scope := map[string]string{"allocations": "allocations", "user": "users", "subusers": "users", "nest": "nests", "egg": "eggs", "variables": "servers", "location": "locations", "node": "nodes", "databases": "server_databases", "transfer": "servers"}[include]
		if scope == "" {
			continue
		}
		if key, ok := r.Context().Value(apiKeyContextKey{}).(M); ok && !applicationScopeAllowed(asMap(key["permissions"]), http.MethodGet, "/api/application/"+scope) {
			relationships[include] = M{"object": "null", "attributes": nil}
			continue
		}
		var row M
		var rows []M
		var err error
		object := include
		switch include {
		case "allocations":
			object = "allocation"
			rows, err = a.query(ctx, "SELECT * FROM allocations WHERE server_id=$1 ORDER BY id", s["id"])
		case "user":
			row, err = a.one(ctx, "SELECT id,uuid,external_id,username,email,name_first,name_last,root_admin,language,created_at,updated_at FROM users WHERE id=$1", s["owner_id"])
		case "subusers":
			object = "subuser"
			rows, err = a.query(ctx, "SELECT * FROM subusers WHERE server_id=$1 ORDER BY id", s["id"])
		case "nest":
			row, err = a.one(ctx, "SELECT * FROM nests WHERE id=$1", s["nest_id"])
		case "egg":
			row, err = a.effectiveEgg(ctx, num(s["egg_id"]))
		case "variables":
			object = "server_variable"
			rows, err = a.query(ctx, "SELECT * FROM server_variables WHERE server_id=$1 ORDER BY id", s["id"])
		case "location":
			row, err = a.one(ctx, "SELECT l.* FROM locations l JOIN nodes n ON n.location_id=l.id WHERE n.id=$1", s["node_id"])
		case "node":
			row, err = a.one(ctx, "SELECT id,uuid,name,description,location_id,fqdn,scheme,behind_proxy,public,memory,memory_overallocate,disk,disk_overallocate,upload_size,daemon_listen,daemon_sftp,daemon_base,maintenance_mode,created_at,updated_at FROM nodes WHERE id=$1", s["node_id"])
		case "databases":
			object = "server_database"
			rows, err = a.query(ctx, "SELECT id,server_id,database_host_id,database,username,remote,max_connections,created_at,updated_at FROM databases WHERE server_id=$1 ORDER BY id", s["id"])
		case "transfer":
			rows, err = a.query(ctx, "SELECT * FROM server_transfers WHERE server_id=$1 AND successful IS NULL ORDER BY id DESC LIMIT 1", s["id"])
			if len(rows) > 0 {
				row = rows[0]
			}
			rows = nil
		default:
			continue
		}
		if err != nil {
			return err
		}
		if include == "user" && row != nil {
			row = userAttributes(row)
		}
		if include == "allocations" {
			for i, v := range rows {
				rows[i] = M{"id": v["id"], "ip": v["ip"], "alias": v["ip_alias"], "port": v["port"], "notes": v["notes"], "assigned": v["server_id"] != nil}
			}
		}
		if include == "egg" && row != nil {
			row, err = a.eggAttributes(r, row)
			if err != nil {
				return err
			}
		}
		if row != nil {
			relationships[include] = item(object, row)
		} else if include == "transfer" {
			relationships[include] = M{"object": "null", "attributes": nil}
		} else {
			relationships[include] = collection(object, rows)
		}
	}
	if len(relationships) > 0 {
		out["relationships"] = relationships
	}
	return nil
}

func flattenServerInput(data M) M {
	out := M{}
	for k, v := range data {
		out[k] = v
	}
	for k, v := range asMap(data["limits"]) {
		out[k] = v
	}
	for k, v := range asMap(data["feature_limits"]) {
		switch k {
		case "databases":
			out["database_limit"] = v
		case "allocations":
			out["allocation_limit"] = v
		case "backups":
			out["backup_limit"] = v
		}
	}
	for _, pair := range [][2]string{{"user", "owner_id"}, {"egg", "egg_id"}, {"nest", "nest_id"}, {"docker_image", "image"}} {
		if v, ok := data[pair[0]]; ok {
			out[pair[1]] = v
		}
	}
	alloc := asMap(data["allocation"])
	if v, ok := alloc["default"]; ok {
		out["allocation_id"] = v
	}
	if v, ok := alloc["additional"]; ok {
		out["allocation_additional"] = v
	}
	return out
}

func validateServerLimits(d M) error {
	for _, k := range []string{"memory", "disk", "cpu", "allocation_limit", "database_limit", "backup_limit"} {
		if v, ok := d[k]; ok && num(v) < 0 {
			return bad(k + " must be non-negative.")
		}
	}
	if v, ok := d["swap"]; ok && num(v) < -1 {
		return bad("swap must be -1 or non-negative.")
	}
	if v, ok := d["io"]; ok && (num(v) < 10 || num(v) > 1000) {
		return bad("io must be between 10 and 1000.")
	}
	return nil
}

var applicationImagePattern = regexp.MustCompile(`^~?[A-Za-z0-9_./:@ -]*$`)
var applicationThreadsPattern = regexp.MustCompile(`^[0-9,-]+$`)
var applicationIntegerPattern = regexp.MustCompile(`^[+-]?(0|[1-9][0-9]*)$`)
var applicationNumericPattern = regexp.MustCompile(`^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$`)

func applicationInteger(value any) (int64, bool) {
	switch n := value.(type) {
	case int:
		return int64(n), true
	case int64:
		return n, true
	case json.Number:
		if v, e := n.Int64(); e == nil {
			return v, true
		}
		f, e := n.Float64()
		return int64(f), e == nil && !math.IsInf(f, 0) && !math.IsNaN(f) && math.Trunc(f) == f && f < float64(math.MaxInt64) && f >= float64(math.MinInt64)
	case float64:
		return int64(n), !math.IsInf(n, 0) && !math.IsNaN(n) && math.Trunc(n) == n && n < float64(math.MaxInt64) && n >= float64(math.MinInt64)
	case string:
		if !applicationIntegerPattern.MatchString(n) {
			return 0, false
		}
		v, e := strconv.ParseInt(n, 10, 64)
		return v, e == nil
	}
	return 0, false
}
func applicationNumeric(value any) (float64, bool) {
	var text string
	switch n := value.(type) {
	case int:
		return float64(n), true
	case int64:
		return float64(n), true
	case float64:
		return n, !math.IsInf(n, 0) && !math.IsNaN(n)
	case json.Number:
		text = string(n)
	case string:
		text = n
	default:
		return 0, false
	}
	if !applicationNumericPattern.MatchString(text) {
		return 0, false
	}
	n, e := strconv.ParseFloat(text, 64)
	return n, e == nil && !math.IsInf(n, 0) && !math.IsNaN(n)
}
func applicationBoolean(value any) (bool, bool) {
	if b, ok := value.(bool); ok {
		return b, true
	}
	if s, ok := value.(string); ok {
		return s == "1", s == "0" || s == "1"
	}
	n, ok := applicationInteger(value)
	return n == 1, ok && (n == 0 || n == 1)
}

// Match StoreServerRequest's public contract before service-level inference.
// The native service infers node/nest, while its HTTP request requires image,
// startup, every resource limit, and explicit database/backup feature limits.
func validateApplicationServerCreate(input M) (M, error) {
	out := M{}
	for _, key := range []string{"name", "docker_image", "startup"} {
		value, ok := input[key].(string)
		if !ok || strings.TrimSpace(value) == "" {
			return nil, bad(key + " is required and must be a string.")
		}
		if key != "startup" && len([]rune(value)) > 191 {
			return nil, bad(key + " must not exceed 191 characters.")
		}
		out[key] = value
	}
	if !applicationImagePattern.MatchString(str(out["docker_image"])) {
		return nil, bad("docker_image contains invalid characters.")
	}
	for _, key := range []string{"user", "egg"} {
		value, ok := applicationInteger(input[key])
		if !ok {
			return nil, bad(key + " is required and must be an integer.")
		}
		out[key] = value
	}
	if value, exists := input["description"]; exists && value != nil {
		if _, ok := value.(string); !ok {
			return nil, bad("description must be a string.")
		}
		out["description"] = value
	}
	if value, exists := input["external_id"]; exists {
		if value != nil {
			v, ok := value.(string)
			if !ok || len([]rune(v)) < 1 || len([]rune(v)) > 191 {
				return nil, bad("external_id must be a string between 1 and 191 characters.")
			}
		}
		out["external_id"] = value
	}
	for _, key := range []string{"skip_scripts", "oom_disabled", "start_on_completion"} {
		if value, exists := input[key]; exists {
			b, ok := applicationBoolean(value)
			if !ok {
				return nil, bad(key + " must be a boolean.")
			}
			out[key] = b
		}
	}
	if value, exists := input["environment"]; exists {
		switch environment := value.(type) {
		case M:
			out["environment"] = environment
		case []any:
			out["environment"] = M{}
		default:
			return nil, bad("environment must be an array.")
		}
	} else {
		return nil, bad("environment must be present.")
	}
	limits, ok := input["limits"].(M)
	if !ok {
		return nil, bad("limits is required and must be an array.")
	}
	normalizedLimits := M{}
	for _, key := range []string{"memory", "swap", "disk", "io", "cpu"} {
		value, valid := applicationNumeric(limits[key])
		if !valid || value >= float64(math.MaxInt64) || value < float64(math.MinInt64) {
			return nil, bad("limits." + key + " is required and must be numeric.")
		}
		minimum := float64(0)
		if key == "swap" {
			minimum = -1
		}
		if key == "io" {
			minimum = 10
		}
		if value < minimum || (key == "io" && value > 1000) {
			return nil, bad("limits." + key + " is outside the allowed range.")
		}
		normalizedLimits[key] = int64(value)
	}
	if value, exists := limits["threads"]; exists {
		if value != nil && !applicationThreadsPattern.MatchString(str(value)) {
			return nil, bad("limits.threads has an invalid CPU set format.")
		}
		if value != nil {
			normalizedLimits["threads"] = str(value)
		} else {
			normalizedLimits["threads"] = nil
		}
	}
	out["limits"] = normalizedLimits
	features, ok := input["feature_limits"].(M)
	if !ok {
		return nil, bad("feature_limits is required and must be an array.")
	}
	normalizedFeatures := M{}
	for _, key := range []string{"databases", "allocations", "backups"} {
		value, exists := features[key]
		if !exists {
			if key != "allocations" {
				return nil, bad("feature_limits." + key + " must be present.")
			}
			continue
		}
		if value == nil {
			normalizedFeatures[key] = int64(0)
			continue
		}
		n, valid := applicationInteger(value)
		if !valid || n < 0 {
			return nil, bad("feature_limits." + key + " must be a non-negative integer or null.")
		}
		normalizedFeatures[key] = n
	}
	out["feature_limits"] = normalizedFeatures
	if value, exists := input["deploy"]; exists {
		deployment, valid := value.(M)
		if !valid || len(deployment) == 0 {
			return nil, bad("deploy must be a non-empty array.")
		}
		for _, key := range []string{"locations", "port_range"} {
			if _, ok := deployment[key].([]any); !ok {
				return nil, bad("deploy." + key + " must be present and an array.")
			}
		}
		for _, location := range asSlice(deployment["locations"]) {
			n, valid := applicationInteger(location)
			if !valid || n < 1 {
				return nil, bad("deploy.locations must contain positive integers.")
			}
		}
		for _, port := range asSlice(deployment["port_range"]) {
			if _, ok := port.(string); !ok {
				return nil, bad("deploy.port_range must contain strings.")
			}
		}
		if value, ok := deployment["dedicated_ip"]; !ok || value == nil {
			return nil, bad("deploy.dedicated_ip must be present.")
		}
		out["deploy"] = deployment
	} else {
		allocation := asMap(input["allocation"])
		id, valid := applicationInteger(allocation["default"])
		if !valid {
			return nil, bad("allocation.default is required and must be an integer.")
		}
		normalized := M{"default": id}
		if additional, ok := allocation["additional"].([]any); ok {
			values := []any{}
			for _, v := range additional {
				n, valid := applicationInteger(v)
				if !valid {
					return nil, bad("allocation.additional must contain integers.")
				}
				values = append(values, n)
			}
			normalized["additional"] = values
		}
		out["allocation"] = normalized
	}

	if value, exists := input["java_config"]; exists {
		config, err := javaNormalize(value, false)
		if err != nil {
			return nil, err
		}
		out["java_config"] = config
	}
	return out, nil
}

func (a *App) createServer(ctx context.Context, input M) (M, error) {
	d := flattenServerInput(input)
	// Only the provider-verified internal plan can set pack identity.
	d["minecraft_pack"] = M{}
	if pack, ok := input["_minecraft_pack_artwork"].(*minecraftPackArtwork); ok && pack != nil {
		d["minecraft_pack"] = pack
	}
	if strings.TrimSpace(str(d["name"])) == "" {
		return nil, bad("Server name is required.")
	}
	if len([]rune(str(d["name"]))) > 191 {
		return nil, bad("Server name is too long.")
	}
	for _, key := range []string{"startup", "image"} {
		if value, ok := d[key].(string); !ok || strings.TrimSpace(value) == "" {
			return nil, bad(key + " is required and must be a string.")
		}
	}
	for _, key := range []string{"memory", "swap", "disk", "io", "cpu"} {
		value, ok := applicationNumeric(d[key])
		if !ok || value >= float64(math.MaxInt64) || value < float64(math.MinInt64) {
			return nil, bad(key + " is required and must be numeric.")
		}
		minimum := float64(0)
		if key == "swap" {
			minimum = -1
		}
		if key == "io" {
			minimum = 10
		}
		if value < minimum || (key == "io" && value > 1000) {
			return nil, bad(key + " is outside the allowed range.")
		}
		d[key] = int64(value)
	}
	if err := validateServerLimits(d); err != nil {
		return nil, err
	}
	if _, err := a.one(ctx, "SELECT id FROM users WHERE id=$1 AND disabled=false", num(d["owner_id"])); err != nil {
		return nil, bad("Select a valid active owner.")
	}
	egg, err := a.effectiveEgg(ctx, num(d["egg_id"]))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, bad("Select a valid egg.")
		}
		return nil, err
	}
	d["nest_id"] = egg["nest_id"]
	if _, err = a.javaPrepare(ctx, egg, d); err != nil {
		return nil, err
	}
	globalEnv, _, err := a.integrationEnvironment(ctx, num(egg["id"]))
	if err != nil {
		return nil, err
	}
	inputEnv := M{}
	for k, v := range asMap(d["environment"]) {
		inputEnv[k] = v
	}
	bound := M{}
	for k, v := range globalEnv {
		if _, present := inputEnv[k]; !present {
			inputEnv[k], bound[k] = v, v
		}
	}
	env, err := a.validateEggEnvironment(ctx, num(egg["id"]), inputEnv, false)
	if err != nil {
		return nil, err
	}
	vars, err := a.eggVariables(ctx, num(egg["id"]))
	if err != nil {
		return nil, err
	}
	for k, v := range (M{"oom_disabled": true, "allocation_limit": 0, "database_limit": 0, "backup_limit": 0, "description": "", "skip_scripts": false}) {
		if _, ok := d[k]; !ok || d[k] == nil {
			d[k] = v
		}
	}
	// FS25 licence and password overrides use the existing encrypted snapshot
	// storage, just like values supplied by Admin integrations.
	for _, feature := range asSlice(egg["features"]) {
		if str(feature) == "voltra_fs25" {
			for key, value := range env {
				if fs25Secret(key) && str(value) != "" {
					bound[key] = value
				}
			}
		}
	}
	tx, err := a.DB.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	if fs25Egg(egg) {
		if err = a.fs25ReserveLicences(ctx, tx, 0, env); err != nil {
			return nil, err
		}
	}
	allocationID := num(d["allocation_id"])
	if allocationID == 0 {
		allocationID, err = a.selectDeployment(ctx, tx, d)
		if err != nil {
			return nil, err
		}
	}
	var nodeID int64
	var assigned *int64
	err = tx.QueryRow(ctx, "SELECT node_id,server_id FROM allocations WHERE id=$1 FOR UPDATE", allocationID).Scan(&nodeID, &assigned)
	if err != nil {
		return nil, bad("Select a valid primary allocation.")
	}
	if assigned != nil {
		return nil, bad("The primary allocation is already assigned.")
	}
	if num(d["node_id"]) != 0 && num(d["node_id"]) != nodeID {
		return nil, bad("Allocation does not belong to the selected node.")
	}
	uuid := newUUID()
	columns := []string{"uuid", "uuid_short", "identifier", "name", "description", "owner_id", "node_id", "nest_id", "egg_id", "allocation_id", "startup", "image", "status", "skip_scripts", "memory", "swap", "disk", "io", "cpu", "threads", "oom_disabled", "allocation_limit", "database_limit", "backup_limit", "external_id", "installation_id", "java_config", "minecraft_pack"}
	d["installation_id"] = "pending:initial:" + newUUID()
	d["uuid"] = uuid
	d["uuid_short"] = uuid[:8]
	d["identifier"] = uuid[:8]
	d["status"] = "installing"
	d["node_id"] = nodeID
	d["allocation_id"] = allocationID
	values := []any{}
	placeholders := []string{}
	for i, k := range columns {
		values = append(values, d[k])
		placeholders = append(placeholders, fmt.Sprintf("$%d", i+1))
	}
	var id int64
	err = tx.QueryRow(ctx, "INSERT INTO servers ("+strings.Join(columns, ",")+") VALUES ("+strings.Join(placeholders, ",")+") RETURNING id", values...).Scan(&id)
	if err != nil {
		return nil, err
	}
	allocations := []int64{allocationID}
	for _, v := range asSlice(d["allocation_additional"]) {
		allocations = append(allocations, num(v))
	}
	seen := map[int64]bool{}
	for _, alloc := range allocations {
		if seen[alloc] {
			continue
		}
		seen[alloc] = true
		tag, e := tx.Exec(ctx, "UPDATE allocations SET server_id=$1 WHERE id=$2 AND node_id=$3 AND server_id IS NULL", id, alloc, nodeID)
		if e != nil {
			return nil, e
		}
		if tag.RowsAffected() != 1 {
			return nil, bad("An additional allocation is assigned or on another node.")
		}
	}
	for _, v := range vars {
		name := str(v["env_variable"])
		value := str(env[name])
		if _, ok := bound[name]; ok {
			sealed, e := a.seal(value)
			if e != nil {
				return nil, e
			}
			if _, e = tx.Exec(ctx, "INSERT INTO server_integration_secrets(server_id,variable_id,value) VALUES($1,$2,$3)", id, v["id"], sealed); e != nil {
				return nil, e
			}
			value = integrationPlaceholder
		}
		_, err = tx.Exec(ctx, "INSERT INTO server_variables(server_id,variable_id,variable_value) VALUES($1,$2,$3)", id, v["id"], value)
		if err != nil {
			return nil, err
		}
	}
	if err = tx.Commit(ctx); err != nil {
		return nil, err
	}
	s, err := a.one(ctx, "SELECT * FROM servers WHERE id=$1", id)
	if err != nil {
		return nil, err
	}
	node, err := a.node(ctx, nodeID)
	if err == nil {
		var res *http.Response
		res, err = a.daemon(ctx, node, "POST", "/api/servers", M{"uuid": uuid, "start_on_completion": boolean(d["start_on_completion"])})
		if res != nil {
			res.Body.Close()
		}
	}
	if err != nil {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		cleanup, e := a.DB.Begin(cleanupCtx)
		if e == nil {
			_, _ = cleanup.Exec(cleanupCtx, "UPDATE allocations SET server_id=NULL WHERE server_id=$1", id)
			_, _ = cleanup.Exec(cleanupCtx, "DELETE FROM servers WHERE id=$1", id)
			_ = cleanup.Commit(cleanupCtx)
		}
		return nil, err
	}
	return s, nil
}

func (a *App) selectDeployment(ctx context.Context, tx pgx.Tx, d M) (int64, error) {
	deploy := asMap(d["deploy"])
	if len(deploy) == 0 {
		deploy = asMap(d["deployment"])
	}
	if len(deploy) == 0 {
		return 0, bad("Select a primary allocation or provide deployment constraints.")
	}
	allocations, err := tx.Query(ctx, "SELECT al.id,al.port,al.ip,n.id,n.location_id,n.memory,n.memory_overallocate,n.disk,n.disk_overallocate,COALESCE((SELECT SUM(memory) FROM servers WHERE node_id=n.id),0),COALESCE((SELECT SUM(disk) FROM servers WHERE node_id=n.id),0),EXISTS(SELECT 1 FROM allocations used WHERE used.node_id=al.node_id AND used.ip=al.ip AND used.server_id IS NOT NULL) FROM allocations al JOIN nodes n ON n.id=al.node_id WHERE al.server_id IS NULL AND n.public=true AND n.maintenance_mode=false ORDER BY n.id,al.id FOR UPDATE OF al SKIP LOCKED")
	if err != nil {
		return 0, err
	}
	defer allocations.Close()
	for allocations.Next() {
		var id, port, node, loc, mem, memOver, disk, diskOver, usedMem, usedDisk int64
		var ip string
		var ipUsed bool
		if err = allocations.Scan(&id, &port, &ip, &node, &loc, &mem, &memOver, &disk, &diskOver, &usedMem, &usedDisk, &ipUsed); err != nil {
			return 0, err
		}
		if num(d["node_id"]) > 0 && num(d["node_id"]) != node {
			continue
		}
		if !deploymentContains(asSlice(deploy["locations"]), loc) || !deploymentPort(asSlice(deploy["port_range"]), port) {
			continue
		}
		if boolean(deploy["dedicated_ip"]) && ipUsed {
			continue
		}
		if memOver != -1 && usedMem+num(d["memory"]) > mem*(100+memOver)/100 {
			continue
		}
		if diskOver != -1 && usedDisk+num(d["disk"]) > disk*(100+diskOver)/100 {
			continue
		}
		return id, nil
	}
	if err = allocations.Err(); err != nil {
		return 0, err
	}
	return 0, &APIError{Status: 422, Code: "NoViableAllocationException", Detail: "No allocation satisfies the requested deployment constraints and node capacity."}
}
func deploymentContains(values []any, value int64) bool {
	if len(values) == 0 {
		return true
	}
	for _, v := range values {
		if num(v) == value {
			return true
		}
	}
	return false
}
func deploymentPort(values []any, port int64) bool {
	if len(values) == 0 {
		return true
	}
	for _, v := range values {
		parts := strings.SplitN(str(v), "-", 2)
		lo, _ := strconv.ParseInt(parts[0], 10, 64)
		hi := lo
		if len(parts) == 2 {
			hi, _ = strconv.ParseInt(parts[1], 10, 64)
		}
		if port >= lo && port <= hi {
			return true
		}
	}
	return false
}

func (a *App) lifecycleCreate(w http.ResponseWriter, r *http.Request) {
	if _, e := a.requireAdmin(r); e != nil {
		fail(w, e)
		return
	}
	d, e := decode(r)
	if e != nil {
		fail(w, e)
		return
	}
	d, e = validateApplicationServerCreate(d)
	if e != nil {
		fail(w, e)
		return
	}
	s, e := a.createServer(r.Context(), d)
	if e != nil {
		fail(w, e)
		return
	}
	v, e := a.applicationServer(r.Context(), s)
	if e != nil {
		fail(w, e)
		return
	}
	w.Header().Set("Location", "/api/application/servers/"+str(s["id"]))
	writeJSON(w, 201, item("server", v))
}
func (a *App) lifecycleDetails(w http.ResponseWriter, r *http.Request) {
	s, e := a.lifecycleAdminServer(r)
	if e != nil {
		fail(w, e)
		return
	}
	d, e := decode(r)
	if e != nil {
		fail(w, e)
		return
	}
	d = flattenServerInput(d)
	patch := M{}
	for _, k := range []string{"name", "description", "owner_id", "external_id"} {
		if v, ok := d[k]; ok {
			patch[k] = v
		}
	}
	if v, ok := patch["name"]; ok && strings.TrimSpace(str(v)) == "" {
		fail(w, bad("Server name is required."))
		return
	}
	if v, ok := patch["owner_id"]; ok {
		if _, e = a.one(r.Context(), "SELECT id FROM users WHERE id=$1 AND disabled=false", num(v)); e != nil {
			fail(w, bad("Invalid owner."))
			return
		}
	}
	a.lifecyclePatchResponse(w, r, s, patch)
}
func (a *App) lifecyclePatchResponse(w http.ResponseWriter, r *http.Request, s, patch M) {
	if len(patch) > 0 {
		ctx := r.Context()
		tx, e := a.DB.Begin(ctx)
		if e != nil {
			fail(w, e)
			return
		}
		defer tx.Rollback(ctx)
		locked, e := tx.Query(ctx, "SELECT * FROM servers WHERE id=$1 FOR UPDATE", s["id"])
		if e != nil {
			fail(w, e)
			return
		}
		previous, e := pgx.CollectOneRow(locked, pgx.RowToMap)
		if e != nil {
			fail(w, e)
			return
		}
		sets := []string{}
		values := []any{previous["id"]}
		for _, key := range []string{"name", "description", "owner_id", "external_id"} {
			if value, ok := patch[key]; ok {
				values = append(values, value)
				sets = append(sets, fmt.Sprintf("%s=$%d", key, len(values)))
			}
		}
		if len(sets) == 0 {
			fail(w, bad("No valid server detail fields were provided."))
			return
		}
		updated, e := tx.Query(ctx, "UPDATE servers SET "+strings.Join(sets, ",")+",updated_at=NOW() WHERE id=$1 RETURNING *", values...)
		if e != nil {
			fail(w, e)
			return
		}
		s, e = pgx.CollectOneRow(updated, pgx.RowToMap)
		if e != nil {
			fail(w, e)
			return
		}
		if num(previous["owner_id"]) != num(s["owner_id"]) {
			ownerRows, err := tx.Query(ctx, "SELECT * FROM users WHERE id=$1", previous["owner_id"])
			if err != nil {
				fail(w, err)
				return
			}
			oldOwner, err := pgx.CollectOneRow(ownerRows, pgx.RowToMap)
			if err != nil {
				fail(w, err)
				return
			}
			if err = a.queueRevocationTx(ctx, tx, s, oldOwner); err != nil {
				fail(w, err)
				return
			}
		}
		if e = tx.Commit(ctx); e != nil {
			fail(w, e)
			return
		}
	}
	v, e := a.applicationServer(r.Context(), s)
	if e != nil {
		fail(w, e)
		return
	}
	writeJSON(w, 200, item("server", v))
}

func (a *App) lifecycleBuild(w http.ResponseWriter, r *http.Request) {
	s, e := a.lifecycleAdminServer(r)
	if e != nil {
		fail(w, e)
		return
	}
	release, e := a.javaMutationLock(r.Context(), num(s["id"]))
	if e != nil {
		fail(w, e)
		return
	}
	defer release()
	s, e = a.one(r.Context(), "SELECT * FROM servers WHERE id=$1", s["id"])
	if e != nil {
		fail(w, e)
		return
	}
	d, e := decode(r)
	if e != nil {
		fail(w, e)
		return
	}
	d = flattenServerInput(d)
	if e = validateServerLimits(d); e != nil {
		fail(w, e)
		return
	}

	candidate := M{}
	for k, v := range s {
		candidate[k] = v
	}
	for _, k := range []string{"memory", "java_config"} {
		if v, ok := d[k]; ok {
			candidate[k] = v
		}
	}
	egg, e := a.effectiveEgg(r.Context(), num(s["egg_id"]))
	if e != nil {
		fail(w, e)
		return
	}
	if _, e = a.javaPrepare(r.Context(), egg, candidate); e != nil {
		fail(w, e)
		return
	}
	oldServer := s
	oldAllocations, e := a.query(r.Context(), "SELECT id FROM allocations WHERE server_id=$1", s["id"])
	if e != nil {
		fail(w, e)
		return
	}
	tx, e := a.DB.Begin(r.Context())
	if e != nil {
		fail(w, e)
		return
	}
	defer tx.Rollback(r.Context())
	ctx := r.Context()
	for _, key := range []string{"add_allocations", "remove_allocations"} {
		for _, id := range asSlice(d[key]) {
			if key == "remove_allocations" {
				if num(id) == num(s["allocation_id"]) && num(d["allocation"]) == 0 && num(d["allocation_id"]) == 0 {
					fail(w, bad("Cannot remove the primary allocation."))
					return
				}
				_, e = tx.Exec(ctx, "UPDATE allocations SET server_id=NULL WHERE id=$1 AND server_id=$2", num(id), s["id"])
			} else {
				result, err := tx.Exec(ctx, "UPDATE allocations SET server_id=$1 WHERE id=$2 AND node_id=$3 AND (server_id IS NULL OR server_id=$1)", s["id"], num(id), s["node_id"])
				e = err
				if e == nil && result.RowsAffected() != 1 {
					e = bad("Allocation is not available on this node.")
				}
			}
			if e != nil {
				fail(w, e)
				return
			}
		}
	}
	patch := M{"java_config": candidate["java_config"], "image": candidate["image"]}
	for _, k := range []string{"memory", "swap", "disk", "io", "cpu", "threads", "oom_disabled", "allocation_limit", "database_limit", "backup_limit"} {
		if v, ok := d[k]; ok {
			patch[k] = v
		}
	}
	primary := num(d["allocation_id"])
	if primary == 0 {
		if _, ok := d["allocation"].(map[string]any); !ok {
			primary = num(d["allocation"])
		}
	}
	if primary != 0 {
		var exists bool
		e = tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM allocations WHERE id=$1 AND server_id=$2)", primary, s["id"]).Scan(&exists)
		if e != nil || !exists {
			fail(w, bad("Primary allocation must be assigned to this server."))
			return
		}
		patch["allocation_id"] = primary
	}
	keys := []string{}
	vals := []any{s["id"]}
	for k, v := range patch {
		vals = append(vals, v)
		keys = append(keys, fmt.Sprintf("%s=$%d", k, len(vals)))
	}
	if len(keys) > 0 {
		_, e = tx.Exec(ctx, "UPDATE servers SET "+strings.Join(keys, ",")+",updated_at=NOW() WHERE id=$1", vals...)
		if e != nil {
			fail(w, e)
			return
		}
	}
	if e = tx.Commit(ctx); e != nil {
		fail(w, e)
		return
	}
	s, e = a.one(ctx, "SELECT * FROM servers WHERE id=$1", s["id"])
	if e != nil {
		fail(w, e)
		return
	}
	if e = a.syncServer(ctx, s); e != nil {
		restoreErr := a.javaRestore(oldServer, []string{"memory", "swap", "disk", "io", "cpu", "threads", "oom_disabled", "allocation_limit", "database_limit", "backup_limit", "allocation_id", "java_config", "image"}, oldAllocations, nil, nil)
		fail(w, errors.Join(e, restoreErr))
		return
	}
	v, e := a.applicationServer(ctx, s)
	if e != nil {
		fail(w, e)
		return
	}
	writeJSON(w, 200, item("server", v))
}

func (a *App) lifecycleStartup(w http.ResponseWriter, r *http.Request) {
	s, e := a.lifecycleAdminServer(r)
	if e != nil {
		fail(w, e)
		return
	}
	release, e := a.javaMutationLock(r.Context(), num(s["id"]))
	if e != nil {
		fail(w, e)
		return
	}
	defer release()
	s, e = a.one(r.Context(), "SELECT * FROM servers WHERE id=$1", s["id"])
	if e != nil {
		fail(w, e)
		return
	}
	d, e := decode(r)
	if e != nil {
		fail(w, e)
		return
	}
	d = flattenServerInput(d)
	eggID := num(s["egg_id"])
	if num(d["egg_id"]) != 0 {
		eggID = num(d["egg_id"])
	}
	egg, e := a.effectiveEgg(r.Context(), eggID)
	if e != nil {
		fail(w, e)
		return
	}
	env, e := a.serverEnvironment(r.Context(), s)
	if e != nil {
		fail(w, e)
		return
	}
	secrets, e := a.serverIntegrationSecrets(r.Context(), num(s["id"]))
	if e != nil {
		fail(w, e)
		return
	}
	keepSecrets := M{}
	keepSecretSources := M{}
	if eggID == num(s["egg_id"]) {
		for _, secret := range secrets {
			name := str(secret["env_variable"])
			value, provided := asMap(d["environment"])[name]
			if !provided || value == integrationPlaceholder {
				plain, err := a.unseal(str(secret["value"]))
				if err != nil {
					fail(w, err)
					return
				}
				env[name] = plain
				keepSecrets[name] = secret["value"]
				keepSecretSources[name] = secret["source"]
			}
		}
	}
	for k, v := range asMap(d["environment"]) {
		if _, keep := keepSecrets[k]; !keep {
			env[k] = v
		}
	}
	if eggID != num(s["egg_id"]) {
		env = asMap(d["environment"])
	}
	env, e = a.validateEggEnvironment(r.Context(), eggID, env, false)
	if e != nil {
		fail(w, e)
		return
	}
	vars, e := a.eggVariables(r.Context(), eggID)
	if e != nil {
		fail(w, e)
		return
	}

	candidate := M{}
	for k, v := range s {
		candidate[k] = v
	}
	for _, k := range []string{"startup", "image", "skip_scripts", "java_config"} {
		if v, ok := d[k]; ok {
			candidate[k] = v
		}
	}
	candidate["egg_id"], candidate["nest_id"] = eggID, egg["nest_id"]
	if eggID != num(s["egg_id"]) {
		candidate["configuration_overrides"] = M{}
	}
	if _, e = a.javaPrepare(r.Context(), egg, candidate); e != nil {
		fail(w, e)
		return
	}
	oldServer := s
	oldVariables, e := a.query(r.Context(), "SELECT variable_id,variable_value FROM server_variables WHERE server_id=$1", s["id"])
	if e != nil {
		fail(w, e)
		return
	}
	ctx := r.Context()
	tx, e := a.DB.Begin(ctx)
	if e != nil {
		fail(w, e)
		return
	}
	defer tx.Rollback(ctx)
	if _, e = tx.Exec(ctx, "DELETE FROM server_integration_secrets WHERE server_id=$1", s["id"]); e != nil {
		fail(w, e)
		return
	}
	_, e = tx.Exec(ctx, "DELETE FROM server_variables WHERE server_id=$1", s["id"])
	if e != nil {
		fail(w, e)
		return
	}
	for _, v := range vars {
		name := str(v["env_variable"])
		value := str(env[name])
		if _, kept := keepSecrets[name]; !kept && startupSecretName(name) && value != "" {
			sealed, sealErr := a.seal(value)
			if sealErr != nil {
				fail(w, sealErr)
				return
			}
			keepSecrets[name], keepSecretSources[name] = sealed, "server"
		}
		if sealed, keep := keepSecrets[name]; keep {
			if _, e = tx.Exec(ctx, "INSERT INTO server_integration_secrets(server_id,variable_id,value,source) VALUES($1,$2,$3,$4)", s["id"], v["id"], sealed, keepSecretSources[name]); e != nil {
				fail(w, e)
				return
			}
			value = integrationPlaceholder
		}
		_, e = tx.Exec(ctx, "INSERT INTO server_variables(server_id,variable_id,variable_value) VALUES($1,$2,$3)", s["id"], v["id"], value)
		if e != nil {
			fail(w, e)
			return
		}
	}
	_, e = tx.Exec(ctx, "UPDATE servers SET egg_id=$2,nest_id=$3,startup=$4,image=$5,skip_scripts=$6,java_config=$7,configuration_overrides=$8,updated_at=NOW() WHERE id=$1", s["id"], eggID, egg["nest_id"], candidate["startup"], candidate["image"], candidate["skip_scripts"], candidate["java_config"], asMap(candidate["configuration_overrides"]))
	if e != nil {
		fail(w, e)
		return
	}
	if e = tx.Commit(ctx); e != nil {
		fail(w, e)
		return
	}
	s, e = a.one(ctx, "SELECT * FROM servers WHERE id=$1", s["id"])
	if e != nil {
		fail(w, e)
		return
	}
	if e = a.syncServer(ctx, s); e != nil {
		restoreErr := a.javaRestore(oldServer, []string{"egg_id", "nest_id", "startup", "image", "skip_scripts", "java_config", "configuration_overrides"}, nil, oldVariables, secrets)
		fail(w, errors.Join(e, restoreErr))
		return
	}
	v, e := a.applicationServer(ctx, s)
	if e != nil {
		fail(w, e)
		return
	}
	writeJSON(w, 200, item("server", v))
}

func (a *App) lifecycleSuspend(w http.ResponseWriter, r *http.Request) {
	s, e := a.lifecycleAdminServer(r)
	if e != nil {
		fail(w, e)
		return
	}
	var status any = "suspended"
	if strings.HasSuffix(r.URL.Path, "/unsuspend") {
		status = nil
	}
	if (str(s["status"]) == "suspended") == (status != nil) {
		writeJSON(w, 204, nil)
		return
	}
	active, e := a.query(r.Context(), "SELECT id FROM server_transfers WHERE server_id=$1 AND successful IS NULL", s["id"])
	if e != nil {
		fail(w, e)
		return
	}
	if len(active) > 0 {
		fail(w, &APIError{Status: 409, Code: "ConflictException", Detail: "Cannot change suspension while a server transfer is active."})
		return
	}
	old := s["status"]
	s, e = a.update(r.Context(), "servers", num(s["id"]), M{"status": status})
	if e == nil {
		e = a.syncServer(r.Context(), s)
	}
	if e != nil {
		_, _ = a.update(r.Context(), "servers", num(s["id"]), M{"status": old})
		fail(w, e)
		return
	}
	writeJSON(w, 204, nil)
}
func (a *App) lifecycleReinstall(w http.ResponseWriter, r *http.Request) {
	s, e := a.lifecycleAdminServer(r)
	if e != nil {
		fail(w, e)
		return
	}
	if a.managedSteamReinstall(w, r, s, http.StatusNoContent) {
		return
	}
	tx, e := a.DB.Begin(r.Context())
	if e != nil {
		fail(w, e)
		return
	}
	defer tx.Rollback(r.Context())
	locked, e := tx.Query(r.Context(), "SELECT * FROM servers WHERE id=$1 FOR UPDATE", s["id"])
	if e != nil {
		fail(w, e)
		return
	}
	s, e = pgx.CollectOneRow(locked, pgx.RowToMap)
	if e != nil {
		fail(w, e)
		return
	}
	old := s["status"]
	oldInstalledAt := s["installed_at"]
	oldInstallationID := s["installation_id"]
	var active bool
	e = tx.QueryRow(r.Context(), "SELECT EXISTS(SELECT 1 FROM server_transfers WHERE server_id=$1 AND successful IS NULL)", s["id"]).Scan(&active)
	if e != nil {
		fail(w, e)
		return
	}
	if active || str(old) == "restoring_backup" || str(old) == "installing" || strings.HasPrefix(str(oldInstallationID), "pending:") {
		fail(w, &APIError{Status: 409, Code: "ConflictException", Detail: "Cannot reinstall a server during installation, restoration, or transfer."})
		return
	}
	status := "installing"
	if str(old) == "suspended" {
		status = "suspended"
	}
	cycle := "pending:reinstall:" + newUUID()
	_, e = tx.Exec(r.Context(), "UPDATE servers SET status=$2,installation_id=$3,updated_at=NOW() WHERE id=$1", s["id"], status, cycle)
	if e != nil {
		fail(w, e)
		return
	}
	if e = tx.Commit(r.Context()); e != nil {
		fail(w, e)
		return
	}
	res, e := a.daemonServer(r.Context(), s, "POST", "/reinstall", nil)
	if e != nil {
		cleanup, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		_ = a.exec(cleanup, "UPDATE servers SET status=$2,installed_at=$3,installation_id=$4,updated_at=NOW() WHERE id=$1 AND installation_id=$5", s["id"], old, oldInstalledAt, oldInstallationID, cycle)
		cancel()
		fail(w, e)
		return
	}
	res.Body.Close()
	writeJSON(w, 204, nil)
}
func (a *App) lifecycleDelete(w http.ResponseWriter, r *http.Request) {
	s, e := a.lifecycleAdminServer(r)
	if e != nil {
		fail(w, e)
		return
	}
	ctx := r.Context()
	release, e := a.serverDeleteMutationLock(ctx, s)
	if e != nil {
		fail(w, e)
		return
	}
	defer release()
	if e = a.cleanupServerProxyRoutes(ctx, s); e != nil {
		fail(w, e)
		return
	}
	tx, e := a.DB.Begin(ctx)
	if e != nil {
		fail(w, e)
		return
	}
	defer tx.Rollback(ctx)
	// Provisioning databases takes this same row lock. Keep the lock across
	// external cleanup so provisioning cannot race the final server deletion;
	// process termination rolls the lock back without a persistent transient state.
	if s, e = lockServerForDeletion(ctx, tx, s["id"]); e != nil {
		fail(w, e)
		return
	}
	if e = lockDeletionAllocations(ctx, tx, s["id"]); e != nil {
		fail(w, e)
		return
	}
	// Cleanup is committed before daemon deletion. Keep this final race check:
	// the server row lock blocks new route references until deletion commits.
	var hasRoutes bool
	if e = tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM proxy_routes WHERE server_id=$1)", s["id"]).Scan(&hasRoutes); e != nil {
		fail(w, e)
		return
	}
	if hasRoutes {
		fail(w, proxyConflict("Public ports changed during deletion. The server has been kept; retry deletion to clean them up automatically."))
		return
	}
	res, e := a.daemonServer(r.Context(), s, "DELETE", "", nil)
	force := r.PathValue("force") == "force"
	var daemonError *APIError
	missing := errors.As(e, &daemonError) && daemonError.Status == 404
	if e != nil && !force && !missing {
		fail(w, e)
		return
	}
	if res != nil {
		res.Body.Close()
	}
	if force {
		databases, err := a.query(ctx, "SELECT * FROM databases WHERE server_id=$1 ORDER BY id", s["id"])
		if err != nil {
			fail(w, err)
			return
		}
		for _, database := range databases {
			if err = a.collabDeleteDatabase(ctx, database); err != nil {
				_, _ = tx.Exec(ctx, "INSERT INTO activity_logs(actor_id,server_id,event,properties) VALUES($1,$2,$3,$4)", UserID(r), s["id"], "server:delete.database-cleanup-failed", M{"database_id": database["id"], "error": err.Error()})
			}
		}
	} else if e = a.deleteServerDatabases(ctx, s); e != nil {
		fail(w, e)
		return
	}
	_, e = tx.Exec(ctx, "UPDATE allocations SET server_id=NULL,notes=NULL WHERE server_id=$1", s["id"])
	if e == nil {
		_, e = tx.Exec(ctx, "DELETE FROM servers WHERE id=$1", s["id"])
	}
	if e == nil {
		e = tx.Commit(ctx)
	}
	if e != nil {
		fail(w, e)
		return
	}
	writeJSON(w, 204, nil)
}

func (a *App) lifecycleMounts(w http.ResponseWriter, r *http.Request) {
	s, e := a.lifecycleAdminServer(r)
	if e != nil {
		fail(w, e)
		return
	}
	ctx := r.Context()
	if r.Method == "GET" {
		rows, e := a.query(ctx, "SELECT m.*,EXISTS(SELECT 1 FROM mount_servers ms WHERE ms.mount_id=m.id AND ms.server_id=$1) AS attached FROM mounts m JOIN mount_nodes mn ON mn.mount_id=m.id JOIN mount_eggs me ON me.mount_id=m.id WHERE mn.node_id=$2 AND me.egg_id=$3 ORDER BY m.id", s["id"], s["node_id"], s["egg_id"])
		if e != nil {
			fail(w, e)
			return
		}
		writeJSON(w, 200, collection("mount", rows))
		return
	}
	if r.Method == "DELETE" {
		e = a.exec(ctx, "DELETE FROM mount_servers WHERE server_id=$1 AND mount_id=$2", s["id"], num(r.PathValue("mount")))
	} else {
		d, err := decode(r)
		if err != nil {
			fail(w, err)
			return
		}
		id := num(d["mount_id"])
		if id == 0 {
			id = num(d["mount"])
		}
		var valid bool
		e = a.DB.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM mount_nodes mn JOIN mount_eggs me ON me.mount_id=mn.mount_id WHERE mn.mount_id=$1 AND mn.node_id=$2 AND me.egg_id=$3)", id, s["node_id"], s["egg_id"]).Scan(&valid)
		if e == nil && !valid {
			e = bad("Mount is not available for the server's egg and node.")
		}
		if e == nil {
			e = a.exec(ctx, "INSERT INTO mount_servers(mount_id,server_id) VALUES($1,$2) ON CONFLICT DO NOTHING", id, s["id"])
		}
	}
	if e == nil {
		e = a.syncServer(ctx, s)
	}
	if e != nil {
		fail(w, e)
		return
	}
	writeJSON(w, 204, nil)
}

func (a *App) remoteNode(r *http.Request) (M, error) {
	token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	parts := strings.SplitN(token, ".", 2)
	if len(parts) != 2 {
		return nil, &APIError{Status: 401, Code: "InvalidDaemonToken", Detail: "A valid daemon token is required."}
	}
	node, err := a.one(r.Context(), "SELECT id FROM nodes WHERE daemon_token_id=$1", parts[0])
	if err != nil {
		return nil, forbidden()
	}
	node, err = a.node(r.Context(), num(node["id"]))
	if err != nil {
		return nil, err
	}
	if subtle.ConstantTimeCompare([]byte(parts[1]), []byte(str(node["daemon_token"]))) != 1 {
		return nil, forbidden()
	}
	return node, nil
}
func (a *App) remoteOwnedServer(r *http.Request, node M, transfer bool) (M, error) {
	s, err := a.one(r.Context(), "SELECT * FROM servers WHERE uuid=$1", r.PathValue("uuid"))
	if err != nil {
		return nil, err
	}
	if num(s["node_id"]) == num(node["id"]) {
		return s, nil
	}
	if transfer {
		rows, e := a.query(r.Context(), "SELECT id FROM server_transfers WHERE server_id=$1 AND successful IS NULL AND (old_node=$2 OR new_node=$2)", s["id"], node["id"])
		if e != nil {
			return nil, e
		}
		if len(rows) > 0 {
			return s, nil
		}
	}
	return nil, forbidden()
}
func (a *App) remoteEnvelope(ctx context.Context, s M) (M, error) {
	settings, err := a.serverConfig(ctx, s)
	if err != nil {
		return nil, err
	}
	env := asMap(settings["environment"])
	process, err := a.eggDaemonConfiguration(ctx, s, env)
	if err != nil {
		return nil, err
	}
	return M{"uuid": s["uuid"], "settings": settings, "process_configuration": process}, nil
}
func (a *App) remoteServers(w http.ResponseWriter, r *http.Request) {
	node, e := a.remoteNode(r)
	if e != nil {
		fail(w, e)
		return
	}
	per, _ := strconv.Atoi(r.URL.Query().Get("per_page"))
	if per < 1 {
		per = 50
	}
	if per > 500 {
		per = 500
	}
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	if page < 1 {
		page = 1
	}
	var total int64
	e = a.DB.QueryRow(r.Context(), "SELECT COUNT(*) FROM servers WHERE node_id=$1", node["id"]).Scan(&total)
	if e != nil {
		fail(w, e)
		return
	}
	servers, e := a.query(r.Context(), "SELECT * FROM servers WHERE node_id=$1 ORDER BY id LIMIT $2 OFFSET $3", node["id"], per, (page-1)*per)
	if e != nil {
		fail(w, e)
		return
	}
	data := []M{}
	for _, s := range servers {
		v, err := a.remoteEnvelope(r.Context(), s)
		if err != nil {
			fail(w, err)
			return
		}
		data = append(data, v)
	}
	last := (int(total) + per - 1) / per
	if last < 1 {
		last = 1
	}
	from := 0
	to := 0
	if len(data) > 0 {
		from = (page-1)*per + 1
		to = from + len(data) - 1
	}
	writeJSON(w, 200, M{"data": data, "meta": M{"current_page": page, "from": from, "last_page": last, "per_page": per, "to": to, "total": total}})
}
func (a *App) remoteServer(w http.ResponseWriter, r *http.Request) {
	node, e := a.remoteNode(r)
	if e != nil {
		fail(w, e)
		return
	}
	s, e := a.remoteOwnedServer(r, node, true)
	if e != nil {
		fail(w, e)
		return
	}
	transfers, e := a.query(r.Context(), "SELECT * FROM server_transfers WHERE server_id=$1 AND successful IS NULL AND new_node=$2", s["id"], node["id"])
	if e != nil {
		fail(w, e)
		return
	}
	if len(transfers) > 0 {
		s["node_id"] = transfers[0]["new_node"]
		s["allocation_id"] = transfers[0]["new_allocation"]
	}
	v, e := a.remoteEnvelope(r.Context(), s)
	if e != nil {
		fail(w, e)
		return
	}
	delete(v, "uuid")
	writeJSON(w, 200, v)
}
func (a *App) remoteReset(w http.ResponseWriter, r *http.Request) {
	node, e := a.remoteNode(r)
	if e != nil {
		fail(w, e)
		return
	}
	e = a.exec(r.Context(), "UPDATE servers SET status=NULL,updated_at=NOW() WHERE node_id=$1 AND status IN ('installing','restoring_backup')", node["id"])
	if e != nil {
		fail(w, e)
		return
	}
	writeJSON(w, 204, nil)
}
func (a *App) remoteInstall(w http.ResponseWriter, r *http.Request) {
	node, e := a.remoteNode(r)
	if e != nil {
		fail(w, e)
		return
	}
	s, e := a.remoteOwnedServer(r, node, false)
	if e != nil {
		fail(w, e)
		return
	}
	if r.Method == "GET" {
		egg, err := a.serverEffectiveEgg(r.Context(), s)
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, 200, M{"container_image": egg["script_container"], "entrypoint": egg["script_entry"], "script": egg["script_install"]})
		return
	}
	d, e := decode(r)
	if e != nil {
		fail(w, e)
		return
	}
	success, ok := d["successful"].(bool)
	if !ok {
		fail(w, bad("successful must be a boolean."))
		return
	}
	tx, e := a.DB.Begin(r.Context())
	if e != nil {
		fail(w, e)
		return
	}
	defer tx.Rollback(r.Context())
	locked, e := tx.Query(r.Context(), "SELECT * FROM servers WHERE id=$1 FOR UPDATE", s["id"])
	if e != nil {
		fail(w, e)
		return
	}
	s, e = pgx.CollectOneRow(locked, pgx.RowToMap)
	if e != nil {
		fail(w, e)
		return
	}
	if num(s["node_id"]) != num(node["id"]) {
		fail(w, forbidden())
		return
	}
	var status any
	if !success {
		status = "install_failed"
		if boolean(d["reinstall"]) {
			status = "reinstall_failed"
		}
	}
	if str(s["status"]) == "suspended" {
		status = "suspended"
	}
	installedAt := s["installed_at"]
	installationID := str(s["installation_id"])
	if installedAt == nil || strings.HasPrefix(installationID, "pending:") || (installationID == "" && str(s["status"]) == "installing") {
		installedAt = time.Now().UTC()
	}
	if installationID == "" {
		kind := "initial"
		if boolean(d["reinstall"]) {
			kind = "reinstall"
		}
		installationID = "complete:" + kind + ":" + newUUID()
	} else {
		installationID = strings.Replace(installationID, "pending:", "complete:", 1)
	}
	_, e = tx.Exec(r.Context(), "UPDATE servers SET status=$2,installed_at=$3,installation_id=$4,updated_at=NOW() WHERE id=$1", s["id"], status, installedAt, installationID)
	if e != nil {
		fail(w, e)
		return
	}
	s["status"] = status
	s["installed_at"] = installedAt
	s["installation_id"] = installationID
	if e = tx.Commit(r.Context()); e != nil {
		fail(w, e)
		return
	}
	_ = a.audit(r.Context(), 0, num(s["id"]), "server:install.complete", d)
	writeJSON(w, 204, nil)
}
func (a *App) remoteSFTP(w http.ResponseWriter, r *http.Request) {
	node, e := a.remoteNode(r)
	if e != nil {
		fail(w, e)
		return
	}
	d, e := decode(r)
	if e != nil {
		fail(w, e)
		return
	}
	if str(d["type"]) != "public_key" && str(d["type"]) != "password" {
		fail(w, forbidden())
		return
	}
	username := str(d["username"])
	pos := strings.LastIndex(username, ".")
	if pos < 1 {
		fail(w, forbidden())
		return
	}
	user, e := a.one(r.Context(), "SELECT * FROM users WHERE username=$1 AND disabled=false", username[:pos])
	if e != nil {
		fail(w, forbidden())
		return
	}
	s, e := a.one(r.Context(), "SELECT * FROM servers WHERE (uuid=$1 OR uuid_short=$1 OR identifier=$1) AND node_id=$2", username[pos+1:], node["id"])
	if e != nil {
		fail(w, forbidden())
		return
	}
	transfers, err := a.query(r.Context(), "SELECT id FROM server_transfers WHERE server_id=$1 AND successful IS NULL", s["id"])
	if err != nil {
		fail(w, err)
		return
	}
	if (str(s["status"]) != "" && str(s["status"]) != "reinstall_failed") || boolean(node["maintenance_mode"]) || len(transfers) > 0 || !a.can(r.Context(), user, s, "file.sftp") {
		fail(w, forbidden())
		return
	}
	if str(d["type"]) == "password" {
		if e = a.sftpPasswordAttempt(r.Context(), "auth:"+str(user["id"])); e != nil {
			fail(w, e)
			return
		}
		if !validSFTPPassword(str(user["sftp_password_hash"]), str(d["password"])) {
			fail(w, forbidden())
			return
		}
	} else if e = a.sftpPublicKey(r.Context(), user, str(d["password"])); e != nil {
		fail(w, e)
		return
	}
	permissions := []string{"*"}
	if !boolean(user["root_admin"]) && num(user["id"]) != num(s["owner_id"]) {
		sub, err := a.one(r.Context(), "SELECT permissions FROM subusers WHERE user_id=$1 AND server_id=$2", user["id"], s["id"])
		if err != nil {
			fail(w, forbidden())
			return
		}
		permissions = []string{}
		for _, p := range asSlice(sub["permissions"]) {
			permissions = append(permissions, str(p))
		}
	}
	writeJSON(w, 200, M{"user": user["uuid"], "server": s["uuid"], "permissions": permissions})
}

func (a *App) sftpPublicKey(ctx context.Context, user M, password string) error {
	key, _, _, _, e := ssh.ParseAuthorizedKey([]byte(password))
	if e != nil {
		return forbidden()
	}
	keys, e := a.query(ctx, "SELECT public_key FROM ssh_keys WHERE user_id=$1", user["id"])
	if e != nil {
		return e
	}
	for _, k := range keys {
		stored, _, _, _, err := ssh.ParseAuthorizedKey([]byte(str(k["public_key"])))
		if err == nil && bytes.Equal(stored.Marshal(), key.Marshal()) {
			return nil
		}
	}
	return forbidden()
}
func (a *App) remoteActivity(w http.ResponseWriter, r *http.Request) {
	node, e := a.remoteNode(r)
	if e != nil {
		fail(w, e)
		return
	}
	d, e := decode(r)
	if e != nil {
		fail(w, e)
		return
	}
	entries := asSlice(d["data"])
	if len(entries) > 1000 {
		fail(w, bad("At most 1000 activity entries are accepted."))
		return
	}
	for _, v := range entries {
		event := asMap(v)
		if !strings.HasPrefix(str(event["event"]), "server:") {
			continue
		}
		s, err := a.one(r.Context(), "SELECT id FROM servers WHERE uuid=$1 AND node_id=$2", event["server"], node["id"])
		if err != nil {
			continue
		}
		var actor any
		if str(event["user"]) != "" {
			u, err := a.one(r.Context(), "SELECT id FROM users WHERE uuid=$1", event["user"])
			if err == nil {
				actor = u["id"]
			}
		}
		timestamp, err := time.Parse(time.RFC3339Nano, str(event["timestamp"]))
		properties := asMap(event["metadata"])
		if properties == nil {
			properties = M{}
		}
		if err != nil {
			timestamp = time.Now().UTC()
			properties["original_timestamp"] = event["timestamp"]
		}
		_, err = a.insert(r.Context(), "activity_logs", M{"event": event["event"], "ip": event["ip"], "server_id": s["id"], "actor_id": actor, "properties": properties, "created_at": timestamp})
		if err != nil {
			fail(w, err)
			return
		}
	}
	writeJSON(w, 204, nil)
}
func (a *App) remoteBackup(w http.ResponseWriter, r *http.Request) {
	node, e := a.remoteNode(r)
	if e != nil {
		fail(w, e)
		return
	}
	backup, e := a.one(r.Context(), "SELECT b.* FROM backups b JOIN servers s ON s.id=b.server_id WHERE b.uuid=$1 AND s.node_id=$2 AND b.deleted_at IS NULL", r.PathValue("backup"), node["id"])
	if e != nil {
		fail(w, e)
		return
	}
	d, e := decode(r)
	if e != nil {
		fail(w, e)
		return
	}
	success, ok := d["successful"].(bool)
	if !ok {
		fail(w, bad("successful must be a boolean."))
		return
	}
	event := "server:backup.complete"
	if strings.HasSuffix(r.URL.Path, "/restore") {
		event = "server:backup.restore-complete"
		if !success {
			event = "server:backup.restore-failed"
		}
		e = a.exec(r.Context(), "UPDATE servers SET status=CASE WHEN status='suspended' THEN status ELSE NULL END,updated_at=NOW() WHERE id=$1", backup["server_id"])
	} else {
		if boolean(backup["is_successful"]) {
			fail(w, bad("Cannot update a completed backup."))
			return
		}
		if str(backup["disk"]) == "s3" {
			e = a.completeS3Backup(r.Context(), backup, asSlice(d["parts"]), success)
			if e != nil {
				fail(w, e)
				return
			}
		}
		patch := M{"is_successful": success, "completed_at": time.Now().UTC(), "checksum": nil, "bytes": 0}
		if success {
			if str(d["checksum"]) == "" || str(d["checksum_type"]) == "" || num(d["size"]) < 0 {
				fail(w, bad("A successful backup requires checksum, checksum_type and non-negative size."))
				return
			}
			patch["checksum"] = str(d["checksum_type"]) + ":" + str(d["checksum"])
			patch["bytes"] = num(d["size"])
		} else {
			patch["is_locked"] = false
			event = "server:backup.fail"
		}
		_, e = a.update(r.Context(), "backups", num(backup["id"]), patch)
	}
	if e != nil {
		fail(w, e)
		return
	}
	_ = a.audit(r.Context(), 0, num(backup["server_id"]), event, M{"backup": backup["uuid"], "name": backup["name"]})
	writeJSON(w, 204, nil)
}

func (a *App) lifecycleTransfer(w http.ResponseWriter, r *http.Request) {
	s, e := a.lifecycleAdminServer(r)
	if e != nil {
		fail(w, e)
		return
	}
	ctx := r.Context()
	transfers, e := a.query(ctx, "SELECT * FROM server_transfers WHERE server_id=$1 ORDER BY id DESC", s["id"])
	if e != nil {
		fail(w, e)
		return
	}
	if r.Method == "GET" {
		writeJSON(w, 200, collection("server_transfer", transfers))
		return
	}
	var active M
	for _, t := range transfers {
		if t["successful"] == nil {
			active = t
			break
		}
	}
	if r.Method == "DELETE" {
		if active == nil {
			fail(w, bad("Server is not transferring."))
			return
		}
		res, err := a.daemonServer(ctx, s, "DELETE", "/transfer", nil)
		if err != nil {
			fail(w, err)
			return
		}
		res.Body.Close()
		if e = a.finishTransfer(ctx, s, active, false); e != nil {
			fail(w, e)
			return
		}
		writeJSON(w, 204, nil)
		return
	}
	if active != nil || !serverInstalled(s) || str(s["status"]) == "restoring_backup" || str(s["status"]) == "deleting" {
		fail(w, bad("Server must be installed and not transferring."))
		return
	}
	d, e := decode(r)
	if e != nil {
		fail(w, e)
		return
	}
	nodeID := num(d["node_id"])
	if nodeID == 0 {
		nodeID = num(d["node"])
	}
	if nodeID == num(s["node_id"]) {
		fail(w, bad("Destination must be a different node."))
		return
	}
	target, e := a.node(ctx, nodeID)
	if e != nil {
		fail(w, e)
		return
	}
	if boolean(target["maintenance_mode"]) {
		fail(w, bad("Destination node is under maintenance."))
		return
	}
	allocationID := num(d["allocation_id"])
	if allocationID == 0 {
		allocationID = num(d["allocation"])
	}
	additional := asSlice(d["allocation_additional"])
	if additional == nil {
		additional = asSlice(d["additional_allocations"])
	}
	oldIDs := []any{}
	tx, e := a.DB.Begin(ctx)
	if e != nil {
		fail(w, e)
		return
	}
	defer tx.Rollback(ctx)
	locked, e := tx.Query(ctx, "SELECT * FROM servers WHERE id=$1 FOR UPDATE", s["id"])
	if e != nil {
		fail(w, e)
		return
	}
	s, e = pgx.CollectOneRow(locked, pgx.RowToMap)
	if e != nil {
		fail(w, e)
		return
	}
	var transferActive bool
	if e = tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM server_transfers WHERE server_id=$1 AND successful IS NULL)", s["id"]).Scan(&transferActive); e != nil {
		fail(w, e)
		return
	}
	if transferActive || !serverInstalled(s) || str(s["status"]) == "restoring_backup" || strings.HasPrefix(str(s["installation_id"]), "pending:") || num(s["node_id"]) == nodeID {
		fail(w, &APIError{Status: 409, Code: "ServerStateConflict", Detail: "The server is already transferring, installing, or assigned to the target node."})
		return
	}
	oldRows, err := tx.Query(ctx, "SELECT id FROM allocations WHERE server_id=$1 AND id<>$2", s["id"], s["allocation_id"])
	if err != nil {
		fail(w, err)
		return
	}
	old, err := pgx.CollectRows(oldRows, pgx.RowToMap)
	if err != nil {
		fail(w, err)
		return
	}
	for _, v := range old {
		oldIDs = append(oldIDs, v["id"])
	}
	allocs := append([]any{allocationID}, additional...)
	for _, id := range allocs {
		tag, err := tx.Exec(ctx, "UPDATE allocations SET server_id=$1 WHERE id=$2 AND node_id=$3 AND server_id IS NULL", s["id"], num(id), nodeID)
		if err != nil {
			fail(w, err)
			return
		}
		if tag.RowsAffected() != 1 {
			fail(w, bad("Destination allocation is unavailable."))
			return
		}
	}
	oldJSON, _ := json.Marshal(oldIDs)
	newJSON, _ := json.Marshal(additional)
	var transferID int64
	e = tx.QueryRow(ctx, "INSERT INTO server_transfers(server_id,old_node,new_node,old_allocation,new_allocation,old_additional_allocations,new_additional_allocations) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id", s["id"], s["node_id"], nodeID, s["allocation_id"], allocationID, oldJSON, newJSON).Scan(&transferID)
	if e != nil {
		fail(w, e)
		return
	}
	if e = tx.Commit(ctx); e != nil {
		fail(w, e)
		return
	}
	claims := jwt.MapClaims{"iss": a.Config.PublicURL, "sub": s["uuid"], "aud": []string{daemonAddress(target)}, "iat": time.Now().Unix(), "nbf": time.Now().Add(-time.Second).Unix(), "exp": time.Now().Add(15 * time.Minute).Unix(), "jti": newUUID(), "scope": "transfer"}
	token, e := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(str(target["daemon_token"])))
	if e == nil {
		var response *http.Response
		response, e = a.daemonServer(ctx, s, "POST", "/transfer", M{"server_id": s["uuid"], "url": daemonAddress(target) + "/api/transfers", "token": "Bearer " + token, "server": M{"uuid": s["uuid"], "start_on_completion": false}})
		if response != nil {
			response.Body.Close()
		}
	}
	if e != nil {
		transfer, _ := a.one(ctx, "SELECT * FROM server_transfers WHERE id=$1", transferID)
		_ = a.finishTransfer(ctx, s, transfer, false)
		fail(w, e)
		return
	}
	transfer, e := a.one(ctx, "SELECT * FROM server_transfers WHERE id=$1", transferID)
	if e != nil {
		fail(w, e)
		return
	}
	writeJSON(w, 202, item("server_transfer", transfer))
}
func (a *App) remoteTransfer(w http.ResponseWriter, r *http.Request) {
	node, e := a.remoteNode(r)
	if e != nil {
		fail(w, e)
		return
	}
	s, e := a.remoteOwnedServer(r, node, true)
	if e != nil {
		fail(w, e)
		return
	}
	t, e := a.one(r.Context(), "SELECT * FROM server_transfers WHERE server_id=$1 AND successful IS NULL ORDER BY id DESC LIMIT 1", s["id"])
	if e != nil {
		fail(w, e)
		return
	}
	success := r.PathValue("result") == "success"
	if r.PathValue("result") != "success" && r.PathValue("result") != "failure" {
		fail(w, notFound())
		return
	}
	if success && num(node["id"]) != num(t["new_node"]) {
		fail(w, forbidden())
		return
	}
	if !success && num(node["id"]) != num(t["new_node"]) && num(node["id"]) != num(t["old_node"]) {
		fail(w, forbidden())
		return
	}
	if e = a.finishTransfer(r.Context(), s, t, success); e != nil {
		fail(w, e)
		return
	}
	if success {
		old, e := a.node(r.Context(), num(t["old_node"]))
		if e == nil {
			res, err := a.daemon(r.Context(), old, "DELETE", "/api/servers/"+str(s["uuid"]), nil)
			if err == nil {
				res.Body.Close()
			} else {
				_ = a.audit(r.Context(), 0, num(s["id"]), "server:transfer.cleanup-failed", M{"error": err.Error(), "transfer_id": t["id"]})
			}
		}
	}
	writeJSON(w, 204, nil)
}
func (a *App) finishTransfer(ctx context.Context, s, t M, success bool) error {
	tx, e := a.DB.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	// A transfer callback can be retried or race a cancellation. Serialize the
	// decision before releasing either side's allocations or moving the server.
	var completed *bool
	if e = tx.QueryRow(ctx, "SELECT successful FROM server_transfers WHERE id=$1 AND server_id=$2 FOR UPDATE", t["id"], s["id"]).Scan(&completed); e != nil {
		return e
	}
	if completed != nil {
		return &APIError{Status: 409, Code: "TransferAlreadyCompleted", Detail: "This transfer has already been completed."}
	}
	ids := []any{t["new_allocation"]}
	additional := asSlice(t["new_additional_allocations"])
	if success {
		ids = []any{t["old_allocation"]}
		additional = asSlice(t["old_additional_allocations"])
	}
	ids = append(ids, additional...)
	for _, id := range ids {
		if _, e = tx.Exec(ctx, "UPDATE allocations SET server_id=NULL WHERE id=$1 AND server_id=$2", num(id), s["id"]); e != nil {
			return e
		}
	}
	if success {
		if _, e = tx.Exec(ctx, "UPDATE servers SET node_id=$2,allocation_id=$3,updated_at=NOW() WHERE id=$1", s["id"], t["new_node"], t["new_allocation"]); e != nil {
			return e
		}
	}
	if _, e = tx.Exec(ctx, "UPDATE server_transfers SET successful=$2,updated_at=NOW() WHERE id=$1 AND successful IS NULL", t["id"], success); e != nil {
		return e
	}
	return tx.Commit(ctx)
}
