package panel

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/json"
	"golang.org/x/crypto/ssh"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func daemonTestNode(t *testing.T, s *httptest.Server) M {
	t.Helper()
	u, e := url.Parse(s.URL)
	if e != nil {
		t.Fatal(e)
	}
	port, _ := strconv.Atoi(u.Port())
	return M{"fqdn": u.Hostname(), "scheme": u.Scheme, "daemon_listen": port, "daemon_token_id": "identifier", "daemon_token": "secret"}
}
func TestLifecycleRouterRegistration(t *testing.T) {
	a := &App{}
	if a.Handler() == nil {
		t.Fatal("missing handler")
	}
}
func TestLifecycleIncludesRequireIndependentScopes(t *testing.T) {
	a := &App{}
	req := httptest.NewRequest("GET", "/api/application/servers/1?include=user,node,egg,nest,location,allocations,databases,subusers", nil)
	req = req.WithContext(context.WithValue(req.Context(), apiKeyContextKey{}, M{"type": "application", "permissions": M{"servers": 1}}))
	out := M{}
	if err := a.applicationServerIncludes(req, M{"id": 1}, out); err != nil {
		t.Fatal(err)
	}
	relations := asMap(out["relationships"])
	for _, name := range []string{"user", "node", "egg", "nest", "location", "allocations", "databases", "subusers"} {
		if asMap(relations[name])["object"] != "null" {
			t.Fatalf("relation %s escaped scope isolation: %v", name, relations)
		}
	}
}
func TestLifecycleDaemonWireProtocol(t *testing.T) {
	ctx := context.Background()
	received := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		received = true
		if r.Header.Get("Authorization") != "Bearer secret" {
			t.Errorf("wrong daemon authentication: %q", r.Header.Get("Authorization"))
		}
		if r.URL.Query().Get("file") != "a b.txt" {
			t.Errorf("encoded query lost: %s", r.URL.String())
		}
		var d M
		if e := json.NewDecoder(r.Body).Decode(&d); e != nil {
			t.Error(e)
		}
		if d["signal"] != "start" {
			t.Errorf("body=%v", d)
		}
		w.WriteHeader(202)
	}))
	defer server.Close()
	a := &App{HTTP: server.Client()}
	res, e := a.daemon(ctx, daemonTestNode(t, server), "POST", "/api/servers/test/power?file=a%20b.txt", M{"signal": "start"})
	if e != nil {
		t.Fatal(e)
	}
	defer res.Body.Close()
	if !received || res.StatusCode != 202 {
		t.Fatal("daemon request was not completed")
	}
}
func TestLifecycleDaemonRawAndFailure(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/raw" {
			b, _ := io.ReadAll(r.Body)
			if string(b) != "raw\nbytes" {
				t.Errorf("raw body changed %q", b)
			}
			w.WriteHeader(204)
			return
		}
		writeJSON(w, 409, M{"error": "Server is installing."})
	}))
	defer server.Close()
	a := &App{HTTP: server.Client()}
	node := daemonTestNode(t, server)
	res, e := a.daemon(context.Background(), node, "POST", "/raw", strings.NewReader("raw\nbytes"))
	if e != nil {
		t.Fatal(e)
	}
	res.Body.Close()
	_, e = a.daemon(context.Background(), node, "POST", "/error", nil)
	if e == nil {
		t.Fatal("non-2xx response accepted")
	}
	rr := httptest.NewRecorder()
	fail(rr, e)
	if rr.Code != 409 || !strings.Contains(rr.Body.String(), "Server is installing") {
		t.Fatalf("daemon error: %d %s", rr.Code, rr.Body.String())
	}
	if _, e = a.daemon(context.Background(), node, "GET", "//other-host/steal-token", nil); e == nil {
		t.Fatal("authority-relative daemon path accepted")
	}
}
func TestLifecycleDaemonOperationTimeoutOverride(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-time.After(80 * time.Millisecond):
			w.WriteHeader(204)
		case <-r.Context().Done():
			return
		}
	}))
	defer server.Close()
	client := server.Client()
	client.Timeout = 20 * time.Millisecond
	a := &App{HTTP: client}
	node := daemonTestNode(t, server)
	if response, err := a.daemon(context.Background(), node, "GET", "/slow", nil); err == nil {
		response.Body.Close()
		t.Fatal("normal short daemon timeout was ignored")
	}
	response, err := a.daemon(withDaemonTimeout(context.Background(), time.Second), node, "GET", "/slow", nil)
	if err != nil {
		t.Fatal("operation timeout override did not take precedence", err)
	}
	response.Body.Close()
	if client.Timeout != 20*time.Millisecond {
		t.Fatal("operation override mutated shared HTTP client")
	}
}
func TestLifecycleDeploymentConstraints(t *testing.T) {
	if !deploymentContains(nil, 7) || deploymentContains([]any{1, 2}, 7) || !deploymentContains([]any{json.Number("7")}, 7) {
		t.Fatal("location matching broken")
	}
	if !deploymentPort([]any{"2000-2010", "25565"}, 2005) || !deploymentPort([]any{25565}, 25565) || deploymentPort([]any{"2000-2010"}, 2011) {
		t.Fatal("port matching broken")
	}
	if validateServerLimits(M{"swap": -1, "io": 500}) != nil {
		t.Fatal("valid limits rejected")
	}
	for _, v := range []M{{"memory": -1}, {"swap": -2}, {"io": 9}, {"io": 1001}, {"backup_limit": -1}} {
		if validateServerLimits(v) == nil {
			t.Fatalf("invalid limits accepted: %v", v)
		}
	}
	d := flattenServerInput(M{"user": 3, "egg": 4, "docker_image": "image", "limits": M{"memory": 100}, "feature_limits": M{"backups": 5}, "allocation": M{"default": 6, "additional": []any{7}}})
	if num(d["owner_id"]) != 3 || num(d["egg_id"]) != 4 || str(d["image"]) != "image" || num(d["memory"]) != 100 || num(d["backup_limit"]) != 5 || num(d["allocation_id"]) != 6 {
		t.Fatalf("native request flattening failed %v", d)
	}
}

// Real PostgreSQL test: callbacks cross the full HTTP handler and validate tenant
// isolation. No SQLite substitute and no fake-success daemon operation.
func TestLifecyclePostgresWingsContract(t *testing.T) {
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL is required for PostgreSQL integration")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	a, e := New(ctx, Config{DatabaseURL: databaseURL, DevMode: true, EncryptionKey: "lifecycle-test-encryption", PublicURL: "http://127.0.0.1:8088"})
	if e != nil {
		t.Fatal(e)
	}
	defer a.Close()
	suffix := randomToken(6)
	user, e := a.insert(ctx, "users", M{"uuid": newUUID(), "username": "life-" + suffix, "email": "life-" + suffix + "@test.invalid", "root_admin": true})
	if e != nil {
		t.Fatal(e)
	}
	a.Config.DevUserID = num(user["id"])
	location, e := a.insert(ctx, "locations", M{"short": "life-" + suffix, "long": "Lifecycle tests"})
	if e != nil {
		t.Fatal(e)
	}
	nest, e := a.insert(ctx, "nests", M{"uuid": newUUID(), "name": "life-" + suffix, "author": "tests@local.invalid"})
	if e != nil {
		t.Fatal(e)
	}
	egg, e := a.insert(ctx, "eggs", M{"uuid": newUUID(), "nest_id": nest["id"], "name": "Lifecycle test", "author": "tests@local.invalid", "startup": "echo {{MESSAGE}}", "docker_images": M{"alpine": "alpine:3.21"}, "script_container": "alpine:3.21", "script_entry": "sh", "script_install": "#!/bin/sh\necho install", "config_startup": M{"done": "ready"}, "config_stop": "^C"})
	if e != nil {
		t.Fatal(e)
	}
	variable, e := a.insert(ctx, "egg_variables", M{"egg_id": egg["id"], "name": "Message", "env_variable": "MESSAGE", "default_value": "ready", "rules": "required|string", "user_viewable": true, "user_editable": true})
	if e != nil {
		t.Fatal(e)
	}
	_ = variable
	created := make(chan string, 1)
	revoked := make(chan M, 8)
	var rejectRevocation atomic.Bool
	daemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer secret" {
			t.Errorf("incorrect daemon auth: %q", r.Header.Get("Authorization"))
		}
		if rejectRevocation.Load() && r.URL.Path != "/api/deauthorize-user" {
			writeJSON(w, 503, M{"error": "daemon offline"})
			return
		}
		if r.Method == "POST" && r.URL.Path == "/api/servers" {
			var d M
			_ = json.NewDecoder(r.Body).Decode(&d)
			created <- str(d["uuid"])
		}
		if r.URL.Path == "/api/deauthorize-user" {
			var d M
			_ = json.NewDecoder(r.Body).Decode(&d)
			revoked <- d
			if rejectRevocation.Load() {
				writeJSON(w, 503, M{"error": "revocation unavailable"})
				return
			}
		}
		w.WriteHeader(202)
	}))
	defer daemon.Close()
	nodeData := daemonTestNode(t, daemon)
	sealed, e := a.seal("secret")
	if e != nil {
		t.Fatal(e)
	}
	nodeData["uuid"] = newUUID()
	nodeData["name"] = "life-" + suffix
	nodeData["location_id"] = location["id"]
	nodeData["daemon_token_id"] = "lifecycle"
	nodeData["daemon_token"] = sealed
	node, e := a.insert(ctx, "nodes", nodeData)
	if e != nil {
		t.Fatal(e)
	}
	otherData := M{}
	for k, v := range nodeData {
		otherData[k] = v
	}
	otherData["uuid"] = newUUID()
	otherData["name"] = "life-other-" + suffix
	otherData["daemon_token_id"] = "other"
	other, e := a.insert(ctx, "nodes", otherData)
	if e != nil {
		t.Fatal(e)
	}
	allocation, e := a.insert(ctx, "allocations", M{"node_id": node["id"], "ip": "127.0.0.1", "port": 25565})
	if e != nil {
		t.Fatal(e)
	}
	var otherOwnerID int64
	defer func() {
		c, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = a.exec(c, "DELETE FROM servers WHERE node_id=$1 OR node_id=$2", node["id"], other["id"])
		_ = a.exec(c, "DELETE FROM allocations WHERE node_id=$1 OR node_id=$2", node["id"], other["id"])
		_ = a.exec(c, "DELETE FROM nodes WHERE id=$1 OR id=$2", node["id"], other["id"])
		_ = a.exec(c, "DELETE FROM eggs WHERE id=$1", egg["id"])
		_ = a.exec(c, "DELETE FROM nests WHERE id=$1", nest["id"])
		_ = a.exec(c, "DELETE FROM locations WHERE id=$1", location["id"])
		_ = a.exec(c, "DELETE FROM users WHERE id=$1 OR id=$2", user["id"], otherOwnerID)
	}()
	s, e := a.createServer(ctx, M{"name": "Lifecycle runtime", "user": user["id"], "egg": egg["id"], "docker_image": "alpine:3.21", "startup": egg["startup"], "environment": M{"MESSAGE": "ready"}, "allocation": M{"default": allocation["id"]}, "limits": M{"memory": 128, "disk": 128, "io": 500, "cpu": 100, "swap": 0}})
	if e != nil {
		t.Fatal(e)
	}
	if <-created != str(s["uuid"]) {
		t.Fatal("Wings create UUID mismatch")
	}
	handler := a.Handler()
	secondAllocation, e := a.insert(ctx, "allocations", M{"node_id": node["id"], "ip": "127.0.0.1", "port": 25566})
	if e != nil {
		t.Fatal(e)
	}
	validCreate := M{"name": "Lifecycle validation", "user": user["id"], "egg": egg["id"], "docker_image": "alpine:3.21", "startup": "echo {{MESSAGE}}", "environment": M{"MESSAGE": "ready"}, "limits": M{"memory": 128, "swap": 0, "disk": 128, "io": 500, "cpu": 100}, "feature_limits": M{"databases": nil, "backups": nil}, "allocation": M{"default": secondAllocation["id"]}}
	validatedCreate, e := validateApplicationServerCreate(validCreate)
	if e != nil || num(asMap(validatedCreate["feature_limits"])["databases"]) != 0 || num(asMap(validatedCreate["feature_limits"])["backups"]) != 0 {
		t.Fatalf("native nullable feature limits rejected: %v %v", validatedCreate, e)
	}
	postCreate := func(input M) *httptest.ResponseRecorder {
		t.Helper()
		encoded, _ := json.Marshal(input)
		request := httptest.NewRequest("POST", "/api/application/servers", strings.NewReader(string(encoded)))
		request.RemoteAddr = "127.0.0.1:4000"
		request.Host = "127.0.0.1:8088"
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		return response
	}
	cloneCreate := func() M {
		encoded, _ := json.Marshal(validCreate)
		var clone M
		_ = json.Unmarshal(encoded, &clone)
		return clone
	}
	for _, key := range []string{"name", "user", "egg", "docker_image", "startup", "environment", "limits", "feature_limits"} {
		invalid := cloneCreate()
		delete(invalid, key)
		if response := postCreate(invalid); response.Code != 422 {
			t.Fatalf("omitted required %s should reject422, got%d %s", key, response.Code, response.Body.String())
		}
	}
	for _, key := range []string{"memory", "swap", "disk", "io", "cpu"} {
		invalid := cloneCreate()
		delete(asMap(invalid["limits"]), key)
		if response := postCreate(invalid); response.Code != 422 {
			t.Fatalf("omitted limits.%s should reject422, got%d %s", key, response.Code, response.Body.String())
		}
	}
	for _, key := range []string{"databases", "backups"} {
		invalid := cloneCreate()
		delete(asMap(invalid["feature_limits"]), key)
		if response := postCreate(invalid); response.Code != 422 {
			t.Fatalf("omitted feature_limits.%s should reject422, got%d %s", key, response.Code, response.Body.String())
		}
	}
	for _, mutation := range []func(M){func(d M) { d["startup"] = nil }, func(d M) { d["docker_image"] = "invalid!image" }, func(d M) { d["environment"] = nil }, func(d M) { asMap(d["limits"])["memory"] = "fast" }, func(d M) { asMap(d["limits"])["memory"] = -0.5 }, func(d M) { asMap(d["limits"])["threads"] = "cpu0" }, func(d M) { asMap(d["feature_limits"])["databases"] = 1.5 }, func(d M) { d["skip_scripts"] = "true" }, func(d M) { delete(asMap(d["allocation"]), "default") }, func(d M) { delete(d, "allocation"); d["deploy"] = M{"locations": []any{}, "port_range": []any{}} }} {
		invalid := cloneCreate()
		mutation(invalid)
		if response := postCreate(invalid); response.Code != 422 {
			t.Fatalf("invalid native create should reject422, got%d %s", response.Code, response.Body.String())
		}
	}
	missingRequiredEnvironment := cloneCreate()
	missingRequiredEnvironment["environment"] = M{}
	if response := postCreate(missingRequiredEnvironment); response.Code != 422 {
		t.Fatalf("omitted required egg environment incorrectly filled its default: %d %s", response.Code, response.Body.String())
	}
	validationCount, e := a.one(ctx, "SELECT COUNT(*)::bigint AS count FROM servers WHERE node_id=$1", node["id"])
	if e != nil || num(validationCount["count"]) != 1 {
		t.Fatalf("invalid requests created persistent servers: %v %v", validationCount, e)
	}
	select {
	case <-created:
		t.Fatal("invalid native request reached daemon creation")
	default:
	}
	// Exercise JSON-number decoding and automatic placement through the public API.
	body, _ := json.Marshal(M{"name": "Lifecycle deployment", "user": user["id"], "egg": egg["id"], "docker_image": "alpine:3.21", "startup": "echo {{MESSAGE}}", "limits": M{"memory": 0, "disk": 0, "io": 500, "cpu": 100, "swap": 0}, "feature_limits": M{"databases": nil, "backups": 1}, "deploy": M{"locations": []any{location["id"]}, "port_range": []any{"25566-25570"}, "dedicated_ip": false}, "environment": M{"MESSAGE": "ready"}})
	adminRequest := httptest.NewRequest("POST", "/api/application/servers", strings.NewReader(string(body)))
	adminRequest.RemoteAddr = "127.0.0.1:4000"
	adminRequest.Host = "127.0.0.1:8088"
	adminResponse := httptest.NewRecorder()
	handler.ServeHTTP(adminResponse, adminRequest)
	if adminResponse.Code != 201 {
		t.Fatalf("native JSON create failed %d %s", adminResponse.Code, adminResponse.Body.String())
	}
	<-created
	var deployed M
	_ = json.Unmarshal(adminResponse.Body.Bytes(), &deployed)
	if num(asMap(deployed["attributes"])["allocation"]) != num(secondAllocation["id"]) {
		t.Fatal("automatic deployment ignored allocation constraints")
	}
	request := func(method, path, token, body string) *httptest.ResponseRecorder {
		t.Helper()
		r := httptest.NewRequest(method, path, strings.NewReader(body))
		r.RemoteAddr = "127.0.0.1:4000"
		r.Host = "127.0.0.1:8088"
		r.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	path := "/api/remote/servers/" + str(s["uuid"])
	response := request("GET", path, "lifecycle.secret", "")
	if response.Code != 200 {
		t.Fatalf("config=%d %s", response.Code, response.Body.String())
	}
	var envelope M
	_ = json.Unmarshal(response.Body.Bytes(), &envelope)
	settings := asMap(envelope["settings"])
	if str(settings["uuid"]) != str(s["uuid"]) || str(asMap(settings["environment"])["MESSAGE"]) != "ready" || num(asMap(settings["build"])["memory_limit"]) != 128 {
		t.Fatalf("invalid Wings settings %v", settings)
	}
	if len(asMap(envelope["process_configuration"])) == 0 {
		t.Fatal("missing process config")
	}
	for _, token := range []string{"other.secret", "lifecycle.invalid"} {
		response = request("GET", path, token, "")
		if response.Code != 403 {
			t.Fatalf("cross-node or invalid auth allowed: %d %s", response.Code, response.Body.String())
		}
	}
	response = request("GET", "/api/remote/servers?per_page=1", "lifecycle.secret", "")
	if response.Code != 200 {
		t.Fatal(response.Body.String())
	}
	var page M
	_ = json.Unmarshal(response.Body.Bytes(), &page)
	if num(asMap(page["meta"])["per_page"]) != 1 || len(asSlice(page["data"])) != 1 {
		t.Fatalf("Wings pagination wrong %v", page)
	}
	response = request("POST", path+"/install", "other.secret", `{"successful":true}`)
	if response.Code != 403 {
		t.Fatal("another node installed server")
	}
	response = request("POST", path+"/install", "lifecycle.secret", `{"successful":true,"reinstall":false}`)
	if response.Code != 204 {
		t.Fatalf("install callback %d %s", response.Code, response.Body.String())
	}
	s, e = a.one(ctx, "SELECT * FROM servers WHERE id=$1", s["id"])
	if e != nil || s["status"] != nil || s["installed_at"] == nil {
		t.Fatalf("installation state not persisted: %v %v", s, e)
	}
	installedAt := s["installed_at"]
	response = request("POST", path+"/install", "lifecycle.secret", `{"successful":true,"reinstall":false}`)
	if response.Code != 204 {
		t.Fatal(response.Body.String())
	}
	afterRetry, e := a.one(ctx, "SELECT installed_at FROM servers WHERE id=$1", s["id"])
	if e != nil || str(afterRetry["installed_at"]) != str(installedAt) {
		t.Fatal("duplicate installation callback changed cycle timestamp")
	}
	concurrentCallbacks := make(chan int, 4)
	for i := 0; i < 4; i++ {
		go func() {
			concurrentCallbacks <- request("POST", path+"/install", "lifecycle.secret", `{"successful":true,"reinstall":false}`).Code
		}()
	}
	for i := 0; i < 4; i++ {
		if code := <-concurrentCallbacks; code != 204 {
			t.Fatalf("concurrent install callback status %d", code)
		}
	}
	response = request("POST", "/api/remote/sftp/auth", "lifecycle.secret", `{"type":"password","username":"anything","password":"anything"}`)
	if response.Code != 403 {
		t.Fatal("password SFTP accepted despite deferred password auth")
	}
	public, _, e := ed25519.GenerateKey(rand.Reader)
	if e != nil {
		t.Fatal(e)
	}
	sshPublic, e := ssh.NewPublicKey(public)
	if e != nil {
		t.Fatal(e)
	}
	keyText := strings.TrimSpace(string(ssh.MarshalAuthorizedKey(sshPublic)))
	_, e = a.insert(ctx, "ssh_keys", M{"user_id": user["id"], "name": "Lifecycle SFTP", "public_key": keyText, "fingerprint": ssh.FingerprintSHA256(sshPublic)})
	if e != nil {
		t.Fatal(e)
	}
	credentials, _ := json.Marshal(M{"type": "public_key", "username": str(user["username"]) + "." + str(s["uuid_short"]), "password": keyText})
	response = request("POST", "/api/remote/sftp/auth", "lifecycle.secret", string(credentials))
	if response.Code != 200 {
		t.Fatalf("public key SFTP rejected: %d %s", response.Code, response.Body.String())
	}
	var sftp M
	_ = json.Unmarshal(response.Body.Bytes(), &sftp)
	if sftp["server"] != s["uuid"] || sftp["user"] != user["uuid"] {
		t.Fatalf("SFTP identity mismatch %v", sftp)
	}
	_, e = a.update(ctx, "servers", num(s["id"]), M{"status": "suspended"})
	if e != nil {
		t.Fatal(e)
	}
	response = request("POST", "/api/remote/sftp/auth", "lifecycle.secret", string(credentials))
	if response.Code != 403 {
		t.Fatal("suspended server allowed SFTP")
	}
	_, _ = a.update(ctx, "servers", num(s["id"]), M{"status": nil})
	backup, e := a.insert(ctx, "backups", M{"uuid": newUUID(), "server_id": s["id"], "name": "Lifecycle backup", "disk": "wings", "is_locked": true})
	if e != nil {
		t.Fatal(e)
	}
	backupPath := "/api/remote/backups/" + str(backup["uuid"])
	response = request("POST", backupPath, "other.secret", `{"successful":true,"checksum_type":"sha256","checksum":"test","size":42}`)
	if response.Code != 404 {
		t.Fatal("other node modified backup")
	}
	response = request("POST", backupPath, "lifecycle.secret", `{"successful":true,"checksum_type":"sha256","checksum":"test","size":42}`)
	if response.Code != 204 {
		t.Fatalf("backup callback rejected %d %s", response.Code, response.Body.String())
	}
	backup, e = a.one(ctx, "SELECT * FROM backups WHERE id=$1", backup["id"])
	if e != nil || !boolean(backup["is_successful"]) || str(backup["checksum"]) != "sha256:test" || num(backup["bytes"]) != 42 {
		t.Fatalf("backup state wrong %v %v", backup, e)
	}
	response = request("POST", backupPath, "lifecycle.secret", `{"successful":false}`)
	if response.Code != 422 {
		t.Fatal("completed backup overwritten")
	}
	_, _ = a.update(ctx, "servers", num(s["id"]), M{"status": "restoring_backup"})
	response = request("POST", backupPath+"/restore", "lifecycle.secret", `{"successful":false}`)
	if response.Code != 204 {
		t.Fatal("failed restoration callback did not clear blocking state")
	}
	s, e = a.one(ctx, "SELECT * FROM servers WHERE id=$1", s["id"])
	if e != nil || s["status"] != nil {
		t.Fatal("restoration state not cleared")
	}
	response = request("POST", "/api/remote/activity", "other.secret", `{"data":[{"server":"`+str(s["uuid"])+`","event":"server:file.read","timestamp":"2026-01-01T00:00:00Z"}]}`)
	if response.Code != 204 {
		t.Fatal(response.Body.String())
	}
	logs, e := a.query(ctx, "SELECT id FROM activity_logs WHERE server_id=$1 AND event='server:file.read'", s["id"])
	if e != nil || len(logs) != 0 {
		t.Fatal("cross-node activity injection succeeded")
	}
	targetAllocation, e := a.insert(ctx, "allocations", M{"node_id": other["id"], "server_id": s["id"], "ip": "127.0.0.1", "port": 25567})
	if e != nil {
		t.Fatal(e)
	}
	transfer, e := a.insert(ctx, "server_transfers", M{"server_id": s["id"], "old_node": node["id"], "new_node": other["id"], "old_allocation": allocation["id"], "new_allocation": targetAllocation["id"]})
	if e != nil {
		t.Fatal(e)
	}
	if e = a.finishTransfer(ctx, s, transfer, true); e != nil {
		t.Fatal(e)
	}
	if e = a.finishTransfer(ctx, s, transfer, false); e == nil {
		t.Fatal("stale failure callback overwrote a successful transfer")
	}
	persisted, e := a.one(ctx, "SELECT s.node_id,s.allocation_id,al.server_id FROM servers s JOIN allocations al ON al.id=s.allocation_id WHERE s.id=$1", s["id"])
	if e != nil || num(persisted["node_id"]) != num(other["id"]) || num(persisted["server_id"]) != num(s["id"]) {
		t.Fatalf("stale callback freed destination allocation: %v %v", persisted, e)
	}
	newOwner, e := a.insert(ctx, "users", M{"uuid": newUUID(), "username": "life-newowner-" + suffix, "email": "life-newowner-" + suffix + "@test.invalid", "root_admin": true})
	if e != nil {
		t.Fatal(e)
	}
	otherOwnerID = num(newOwner["id"])
	_, e = a.update(ctx, "users", num(user["id"]), M{"root_admin": false})
	if e != nil {
		t.Fatal(e)
	}
	a.Config.DevUserID = otherOwnerID
	changeOwner := func(id int64) *httptest.ResponseRecorder {
		body, _ := json.Marshal(M{"user": id})
		request := httptest.NewRequest("PATCH", "/api/application/servers/"+str(s["id"])+"/details", strings.NewReader(string(body)))
		request.RemoteAddr = "127.0.0.1:4000"
		request.Host = "127.0.0.1:8088"
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		return response
	}
	rejectRevocation.Store(true)
	response = changeOwner(otherOwnerID)
	if response.Code != 200 {
		t.Fatalf("owner change failed %d %s", response.Code, response.Body.String())
	}
	select {
	case <-revoked:
		t.Fatal("ownership change synchronously contacted offline Wings")
	default:
	}
	persisted, e = a.one(ctx, "SELECT * FROM servers WHERE id=$1", s["id"])
	if e != nil || num(persisted["owner_id"]) != otherOwnerID {
		t.Fatalf("offline owner change did not persist %v %v", persisted, e)
	}
	oldOwnerRequest := httptest.NewRequest("GET", "/api/client/servers/"+str(s["uuid"]), nil)
	oldOwnerRequest.RemoteAddr = "127.0.0.1:4000"
	oldOwnerRequest.Host = "127.0.0.1:8088"
	oldOwnerRequest.Header.Set("X-Dev-User-ID", str(user["id"]))
	oldOwnerResponse := httptest.NewRecorder()
	handler.ServeHTTP(oldOwnerResponse, oldOwnerRequest)
	if oldOwnerResponse.Code != 404 {
		t.Fatalf("old owner retained panel access offline: %d %s", oldOwnerResponse.Code, oldOwnerResponse.Body.String())
	}
	job, e := a.one(ctx, "SELECT * FROM daemon_revocations WHERE server_uuid=$1 AND user_uuid=$2 AND completed_at IS NULL", s["uuid"], user["uuid"])
	if e != nil {
		t.Fatal("owner change did not durably enqueue old owner revocation", e)
	}
	drain := func(job M) {
		t.Helper()
		if e := a.exec(ctx, "UPDATE daemon_revocations SET next_attempt_at='0001-01-01T00:00:00Z' WHERE id=$1", job["id"]); e != nil {
			t.Fatal(e)
		}
		ran, err := a.processRevocation(ctx)
		if err != nil || !ran {
			t.Fatalf("revocation worker did not run: %v %v", ran, err)
		}
	}
	drain(job)
	revocation := <-revoked
	if str(revocation["user"]) != str(user["uuid"]) || len(asSlice(revocation["servers"])) != 1 || str(asSlice(revocation["servers"])[0]) != str(s["uuid"]) {
		t.Fatalf("old owner sessions not revoked: %v", revocation)
	}
	job, e = a.one(ctx, "SELECT * FROM daemon_revocations WHERE id=$1", job["id"])
	if e != nil || job["completed_at"] != nil || num(job["attempts"]) < 1 || str(job["last_error"]) == "" {
		t.Fatalf("offline revocation was lost instead of retained for retry: %v %v", job, e)
	}
	rejectRevocation.Store(false)
	drain(job)
	<-revoked
	job, e = a.one(ctx, "SELECT * FROM daemon_revocations WHERE id=$1", job["id"])
	if e != nil || job["completed_at"] == nil {
		t.Fatalf("reconnected daemon revocation did not complete: %v %v", job, e)
	}
	response = changeOwner(num(user["id"]))
	if response.Code != 200 {
		t.Fatal(response.Body.String())
	}
	job, e = a.one(ctx, "SELECT * FROM daemon_revocations WHERE server_uuid=$1 AND user_uuid=$2 AND completed_at IS NULL", s["uuid"], newOwner["uuid"])
	if e != nil {
		t.Fatal(e)
	}
	drain(job)
	revocation = <-revoked
	if str(revocation["user"]) != str(newOwner["uuid"]) {
		t.Fatal("replacement owner sessions not revoked")
	}
	rejectRevocation.Store(false)
	_, e = a.update(ctx, "servers", num(s["id"]), M{"status": "suspended"})
	if e != nil {
		t.Fatal(e)
	}
	reinstallRequest := httptest.NewRequest("POST", "/api/application/servers/"+str(s["id"])+"/reinstall", nil)
	reinstallRequest.RemoteAddr = "127.0.0.1:4000"
	reinstallRequest.Host = "127.0.0.1:8088"
	reinstallResponse := httptest.NewRecorder()
	handler.ServeHTTP(reinstallResponse, reinstallRequest)
	if reinstallResponse.Code != 204 {
		t.Fatal(reinstallResponse.Body.String())
	}
	response = request("POST", path+"/install", "other.secret", `{"successful":true,"reinstall":true}`)
	if response.Code != 204 {
		t.Fatal(response.Body.String())
	}
	response = request("POST", path+"/install", "other.secret", `{"successful":true,"reinstall":true}`)
	if response.Code != 204 {
		t.Fatal(response.Body.String())
	}
	reinstalled, e := a.one(ctx, "SELECT status,installed_at,installation_id FROM servers WHERE id=$1", s["id"])
	if e != nil || str(reinstalled["status"]) != "suspended" || str(reinstalled["installed_at"]) == str(installedAt) || !strings.HasPrefix(str(reinstalled["installation_id"]), "complete:reinstall:") {
		t.Fatalf("suspended reinstall cycle incorrect %v %v", reinstalled, e)
	}

}
