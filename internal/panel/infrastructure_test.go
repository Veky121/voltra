package panel

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"gopkg.in/yaml.v3"
)

func infraTestApp(t *testing.T) (*App, http.Handler, int64) {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL is required for PostgreSQL infrastructure integration tests")
	}
	ctx := context.Background()
	control, e := pgxpool.New(ctx, dsn)
	if e != nil {
		t.Fatal(e)
	}
	name := "infra_" + strings.ReplaceAll(newUUID(), "-", "")
	if _, e = control.Exec(ctx, "CREATE SCHEMA "+name); e != nil {
		control.Close()
		t.Fatal(e)
	}
	cfg, e := pgxpool.ParseConfig(dsn)
	if e != nil {
		t.Fatal(e)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = name
	pool, e := pgxpool.NewWithConfig(ctx, cfg)
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() {
		pool.Close()
		_, _ = control.Exec(context.Background(), "DROP SCHEMA "+name+" CASCADE")
		control.Close()
	})
	if _, e = pool.Exec(ctx, schema); e != nil {
		t.Fatal(e)
	}
	a := &App{DB: pool, Config: Config{DevMode: true, PublicURL: "http://localhost:8088", EncryptionKey: "infra-test-encryption"}, HTTP: &http.Client{Timeout: 3 * time.Second}}
	admin, e := a.insert(ctx, "users", M{"uuid": newUUID(), "username": "infra_admin", "email": "infra-admin@example.invalid", "root_admin": true})
	if e != nil {
		t.Fatal(e)
	}
	mux := http.NewServeMux()
	a.registerInfrastructure(mux)
	return a, mux, num(admin["id"])
}
func infraRequest(t *testing.T, handler http.Handler, user int64, method, url string, body any) (int, M, string) {
	t.Helper()
	var encoded string
	if body != nil {
		data, e := json.Marshal(body)
		if e != nil {
			t.Fatal(e)
		}
		encoded = string(data)
	}
	request := WithUser(httptest.NewRequest(method, url, strings.NewReader(encoded)), user)
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	result := M{}
	if strings.Contains(response.Header().Get("Content-Type"), "json") {
		if e := json.Unmarshal(response.Body.Bytes(), &result); e != nil {
			t.Fatalf("decode response %d %q: %v", response.Code, response.Body.String(), e)
		}
	}
	return response.Code, result, response.Body.String()
}
func infraExpect(t *testing.T, handler http.Handler, user int64, method, url string, body any, want int) M {
	t.Helper()
	status, result, raw := infraRequest(t, handler, user, method, url, body)
	if status != want {
		t.Fatalf("%s %s: status=%d want=%d body=%s", method, url, status, want, raw)
	}
	return result
}

func TestInfrastructurePortAndCapacityValidation(t *testing.T) {
	for _, invalid := range []any{nil, []any{}, []any{"1024"}, []any{"65536"}, []any{"2000-1000"}, []any{"2000-3000"}, []any{"2000-2001-2002"}, []any{"1.5"}} {
		if _, e := infraPorts(invalid); e == nil {
			t.Errorf("accepted invalid ports %#v", invalid)
		}
	}
	ports, e := infraPorts([]any{"2000-2002", "2001", "65535"})
	if e != nil {
		t.Fatal(e)
	}
	if fmt.Sprint(ports) != "[2000 2001 2002 65535]" {
		t.Fatalf("unexpected ports %v", ports)
	}
	ips, e := infraIPs(context.Background(), "192.0.2.99/25")
	if e != nil || len(ips) != 128 || ips[0] != "192.0.2.0" || ips[127] != "192.0.2.127" {
		t.Fatalf("CIDR expansion %v %v", ips, e)
	}
	if _, e = infraIPs(context.Background(), "192.0.2.0/24"); e == nil {
		t.Fatal("accepted overly broad CIDR")
	}
	for _, tc := range []struct {
		total, over, used, request int64
		want                       bool
	}{{100, 0, 50, 50, true}, {100, 0, 50, 51, false}, {100, 50, 100, 50, true}, {100, -1, 999999, 999999, true}, {100, 0, 0, -1, false}} {
		if got := infraCapacity(tc.total, tc.over, tc.used, tc.request); got != tc.want {
			t.Errorf("capacity %#v got %v", tc, got)
		}
	}
}

func TestInfrastructureCRUDNodeConfigurationAndAllocations(t *testing.T) {
	a, handler, user := infraTestApp(t)
	ctx := context.Background()
	var mu sync.Mutex
	updates := []M{}
	authHeaders := []string{}
	rejectUpdates := false
	wings := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/update" || r.Method != "POST" {
			http.NotFound(w, r)
			return
		}
		var update M
		if e := json.NewDecoder(r.Body).Decode(&update); e != nil {
			t.Error(e)
		}
		mu.Lock()
		updates = append(updates, update)
		authHeaders = append(authHeaders, r.Header.Get("Authorization"))
		reject := rejectUpdates
		mu.Unlock()
		if reject {
			writeJSON(w, 200, M{"applied": false})
			return
		}
		w.WriteHeader(204)
	}))
	defer wings.Close()
	host, portString, e := net.SplitHostPort(strings.TrimPrefix(wings.URL, "http://"))
	if e != nil {
		t.Fatal(e)
	}
	port, _ := strconv.Atoi(portString)
	location := asMap(infraExpect(t, handler, user, "POST", "/api/application/locations", M{"short": "local", "long": "Local test"}, 201)["attributes"])
	locationID := num(location["id"])
	infraExpect(t, handler, user, "POST", "/api/application/locations", M{"short": "local"}, 409)
	nodeInput := M{"name": "Test Node", "location_id": locationID, "fqdn": host, "scheme": "http", "memory": 1000, "memory_overallocate": 0, "disk": 2000, "disk_overallocate": 0, "daemon_listen": port, "daemon_sftp": 2022}
	node := asMap(infraExpect(t, handler, user, "POST", "/api/application/nodes", nodeInput, 201)["attributes"])
	nodeID := num(node["id"])
	nodeURL := fmt.Sprintf("/api/application/nodes/%d", nodeID)
	hostRecord := asMap(infraExpect(t, handler, user, "POST", "/api/admin/database-hosts", M{"name": "node-associated database host", "host": "127.0.0.1", "port": 3306, "username": "root", "node_id": nodeID}, 201)["attributes"])
	if _, ok := node["daemon_token"]; ok {
		t.Fatal("node leaked daemon token")
	}
	stored, e := a.one(ctx, "SELECT * FROM nodes WHERE id=$1", nodeID)
	if e != nil {
		t.Fatal(e)
	}
	if !strings.HasPrefix(str(stored["daemon_token"]), "enc:v1:") {
		t.Fatal("node token was not encrypted")
	}
	token, e := a.unseal(str(stored["daemon_token"]))
	if e != nil {
		t.Fatal(e)
	}
	if len(token) != 64 {
		t.Fatalf("token length %d", len(token))
	}
	config := infraExpect(t, handler, user, "GET", nodeURL+"/configuration", nil, 200)
	if str(config["token"]) != token || str(config["remote"]) != "http://localhost:8088" {
		t.Fatalf("bad Wings config %v", config)
	}
	a.Config.DaemonURL = "http://host.docker.internal:8088/"
	override := infraExpect(t, handler, user, "GET", nodeURL+"/configuration", nil, 200)
	if str(override["remote"]) != "http://host.docker.internal:8088" {
		t.Fatal("daemon callback did not honor DaemonURL")
	}
	status, _, raw := infraRequest(t, handler, user, "GET", nodeURL+"/configuration?format=yaml", nil)
	var yamlConfig M
	if e = yaml.Unmarshal([]byte(raw), &yamlConfig); e != nil || status != 200 || str(yamlConfig["token"]) != token || str(yamlConfig["remote"]) != "http://host.docker.internal:8088" {
		t.Fatalf("YAML config invalid status=%d err=%v", status, e)
	}
	updatedNodeInput := M{}
	for k, v := range nodeInput {
		updatedNodeInput[k] = v
	}
	updatedNodeInput["upload_size"] = 200
	infraExpect(t, handler, user, "PATCH", nodeURL, updatedNodeInput, 200)
	mu.Lock()
	if len(updates) != 1 || num(asMap(updates[0]["api"])["upload_limit"]) != 200 || authHeaders[0] != "Bearer "+token || str(updates[0]["remote"]) != "http://host.docker.internal:8088" {
		t.Fatalf("Wings update not authenticated correctly: %v %v", updates, authHeaders)
	}
	mu.Unlock()
	infraExpect(t, handler, user, "PATCH", nodeURL, M{"daemon_listen": 65536}, 422)
	infraExpect(t, handler, user, "POST", nodeURL+"/allocations", M{"ip": "127.0.0.1", "ports": []any{"25565-25567"}, "alias": "localhost"}, 204)
	list := infraExpect(t, handler, user, "GET", nodeURL+"/allocations?per_page=2", nil, 200)
	if num(asMap(asMap(list["meta"])["pagination"])["total"]) != 3 || len(asSlice(list["data"])) != 2 {
		t.Fatalf("bad allocation pagination %v", list)
	}
	allocationID := num(asMap(asMap(asSlice(list["data"])[0])["attributes"])["id"])
	infraExpect(t, handler, user, "DELETE", fmt.Sprintf("/api/admin/nodes/%d/allocations", nodeID), M{"allocations": []any{allocationID, 99999999}}, 422)
	if _, e = a.one(ctx, "SELECT id FROM allocations WHERE id=$1", allocationID); e != nil {
		t.Fatal("bulk delete partially applied")
	}
	aliasResponse := asMap(infraExpect(t, handler, user, "PATCH", fmt.Sprintf("/api/admin/nodes/%d/allocations/%d", nodeID, allocationID), M{"alias": "play.example.invalid"}, 200)["attributes"])
	if str(aliasResponse["alias"]) != "play.example.invalid" {
		t.Fatal("allocation alias missing from native response")
	}
	allocationIncludes := infraExpect(t, handler, user, "GET", nodeURL+"/allocations?include=node,server", nil, 200)
	firstAllocation := asMap(asMap(asSlice(allocationIncludes["data"])[0])["attributes"])
	if str(firstAllocation["alias"]) != "play.example.invalid" || str(asMap(asMap(firstAllocation["relationships"])["node"])["object"]) != "node" {
		t.Fatal("allocation alias or included node missing")
	}
	infraExpect(t, handler, user, "DELETE", fmt.Sprintf("/api/application/locations/%d", locationID), nil, 422)
	available := infraExpect(t, handler, user, "GET", "/api/application/nodes/deployable?memory=1000&disk=2000", nil, 200)
	if len(asSlice(available["data"])) != 1 {
		t.Fatal("viable node missing")
	}
	unavailable := infraExpect(t, handler, user, "GET", "/api/application/nodes/deployable?memory=1001&disk=2000", nil, 200)
	if len(asSlice(unavailable["data"])) != 0 {
		t.Fatal("overfull node accepted")
	}
	rotated := infraExpect(t, handler, user, "POST", fmt.Sprintf("/api/admin/nodes/%d/reset-token", nodeID), nil, 200)
	if str(rotated["token"]) == token {
		t.Fatal("node token was not rotated")
	}
	if str(rotated["remote"]) != "http://host.docker.internal:8088" {
		t.Fatal("token rotation lost reachable daemon callback")
	}
	deployment := infraExpect(t, handler, user, "POST", fmt.Sprintf("/api/admin/nodes/%d/deploy-token", nodeID), nil, 201)
	request := httptest.NewRequest("GET", nodeURL+"?include=location,allocations,servers", nil)
	request.Header.Set("Authorization", "Bearer "+str(deployment["token"]))
	request, e = a.AuthenticateAPIKey(request)
	if e != nil {
		t.Fatal(e)
	}
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	if recorder.Code != 200 {
		t.Fatalf("deployment key failed: %s", recorder.Body.String())
	}
	var scoped M
	if e = json.Unmarshal(recorder.Body.Bytes(), &scoped); e != nil {
		t.Fatal(e)
	}
	relations := asMap(asMap(scoped["attributes"])["relationships"])
	if len(relations) != 0 {
		t.Fatalf("node-scoped key leaked other resource relations: %v", relations)
	}
	request = httptest.NewRequest("GET", "/api/application/locations", nil)
	request.Header.Set("Authorization", "Bearer "+str(deployment["token"]))
	request, e = a.AuthenticateAPIKey(request)
	if e != nil {
		t.Fatal(e)
	}
	recorder = httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	if recorder.Code != 403 {
		t.Fatalf("node-only deployment key could read locations: %d", recorder.Code)
	}
	mu.Lock()
	rejectUpdates = true
	mu.Unlock()
	infraExpect(t, handler, user, "PATCH", fmt.Sprintf("/api/admin/nodes/%d", nodeID), M{"upload_size": 300}, 502)
	savedRejected, e := a.one(ctx, "SELECT upload_size FROM nodes WHERE id=$1", nodeID)
	if e != nil || num(savedRejected["upload_size"]) != 300 {
		t.Fatal("ignored daemon update did not preserve saved configuration for manual application")
	}
	infraExpect(t, handler, user, "DELETE", nodeURL, nil, 204)
	hostAfterDelete, e := a.one(ctx, "SELECT node_id FROM database_hosts WHERE id=$1", num(hostRecord["id"]))
	if e != nil || hostAfterDelete["node_id"] != nil {
		t.Fatal("node deletion did not preserve database host and clear its node association")
	}
	infraExpect(t, handler, user, "DELETE", fmt.Sprintf("/api/application/locations/%d", locationID), nil, 204)
}

func TestInfrastructureMountHostAndSettingsGuards(t *testing.T) {
	a, handler, user := infraTestApp(t)
	ctx := context.Background()
	nonAdmin, e := a.insert(ctx, "users", M{"uuid": newUUID(), "username": "ordinary", "email": "ordinary@example.invalid"})
	if e != nil {
		t.Fatal(e)
	}
	infraExpect(t, handler, num(nonAdmin["id"]), "GET", "/api/admin/settings", nil, 403)
	infraExpect(t, handler, user, "POST", "/api/admin/mounts", M{"name": "unsafe", "source": "/etc/pterodactyl", "target": "/data"}, 422)
	mount := asMap(infraExpect(t, handler, user, "POST", "/api/admin/mounts", M{"name": "shared", "source": "/srv/shared", "target": "/shared", "read_only": true}, 201)["attributes"])
	infraExpect(t, handler, user, "POST", "/api/admin/mounts", M{"name": "shared", "source": "/srv/shared-again", "target": "/shared-again"}, 409)
	infraExpect(t, handler, user, "POST", fmt.Sprintf("/api/admin/mounts/%d/nodes", num(mount["id"])), M{"nodes": []any{9999999}}, 422)
	host := asMap(infraExpect(t, handler, user, "POST", "/api/admin/database-hosts", M{"name": "local", "host": "127.0.0.1", "port": 1, "username": "panel", "password": "super-secret"}, 201)["attributes"])
	if _, ok := host["password"]; ok {
		t.Fatal("database-host password leaked")
	}
	hostID := num(host["id"])
	stored, e := a.one(ctx, "SELECT password FROM database_hosts WHERE id=$1", hostID)
	if e != nil {
		t.Fatal(e)
	}
	if !strings.HasPrefix(str(stored["password"]), "enc:v1:") {
		t.Fatal("database-host password is unencrypted")
	}
	infraExpect(t, handler, user, "PATCH", fmt.Sprintf("/api/admin/database-hosts/%d", hostID), M{"name": "renamed"}, 200)
	after, e := a.one(ctx, "SELECT password FROM database_hosts WHERE id=$1", hostID)
	if e != nil || after["password"] != stored["password"] {
		t.Fatal("host password changed when omitted")
	}
	infraExpect(t, handler, user, "POST", fmt.Sprintf("/api/admin/database-hosts/%d/test", hostID), nil, 502)
	infraExpect(t, handler, user, "PATCH", "/api/admin/settings", M{"pterodactyl:client_features:allocations:range_start": 30000, "pterodactyl:client_features:allocations:range_end": 20000}, 422)
	infraExpect(t, handler, user, "PATCH", "/api/admin/settings", M{"backups.throttles.period": 0, "backups.prune_age": 0}, 200)
	infraExpect(t, handler, user, "PATCH", "/api/admin/settings", M{"backups.default": "s3", "backups.s3": M{"bucket": "local-test", "access_key_id": "test-key", "secret_access_key": "secret-key", "session_token": "session-key", "part_size": 5 * 1024 * 1024}}, 200)
	s3Settings := asMap(asMap(infraExpect(t, handler, user, "GET", "/api/admin/settings", nil, 200)["attributes"])["backups.s3"])
	if _, ok := s3Settings["secret_access_key"]; ok {
		t.Fatal("S3 secret leaked")
	}
	if _, ok := s3Settings["session_token"]; ok {
		t.Fatal("S3 session token leaked")
	}
	if !boolean(s3Settings["secret_access_key_configured"]) || !boolean(s3Settings["session_token_configured"]) {
		t.Fatal("S3 secret flags missing")
	}
	storedS3, e := a.infraLoadSettings(ctx)
	if e != nil {
		t.Fatal(e)
	}
	sealedSecret := str(asMap(storedS3["backups.s3"])["secret_access_key"])
	plain, e := a.unseal(sealedSecret)
	if e != nil || plain != "secret-key" {
		t.Fatal("S3 secret was not encrypted correctly")
	}
	infraExpect(t, handler, user, "PATCH", "/api/admin/settings", M{"backups.s3": M{"region": "eu-central-1", "secret_access_key": ""}}, 200)
	afterS3, e := a.infraLoadSettings(ctx)
	if e != nil || str(asMap(afterS3["backups.s3"])["secret_access_key"]) != sealedSecret {
		t.Fatal("omitted or empty S3 secret changed")
	}
	sealedSession := str(asMap(afterS3["backups.s3"])["session_token"])
	infraExpect(t, handler, user, "PATCH", "/api/admin/settings", M{"backups.s3": M{"endpoint": "  https://s3.example.invalid  ", "session_token": ""}}, 200)
	afterS3, e = a.infraLoadSettings(ctx)
	if e != nil || str(asMap(afterS3["backups.s3"])["endpoint"]) != "https://s3.example.invalid" || str(asMap(afterS3["backups.s3"])["session_token"]) != sealedSession {
		t.Fatal("settings normalization or empty S3 session retention failed")
	}
	infraExpect(t, handler, user, "PATCH", "/api/admin/settings", M{"backups.s3": M{"secret_access_key": nil, "session_token": nil}}, 200)
	cleared, e := a.infraLoadSettings(ctx)
	if e != nil || str(asMap(cleared["backups.s3"])["secret_access_key"]) != "" || str(asMap(cleared["backups.s3"])["session_token"]) != "" {
		t.Fatal("explicit null did not clear S3 secrets")
	}
}

func TestInfrastructureMountAssignmentsSyncAndConstraints(t *testing.T) {
	a, handler, user := infraTestApp(t)
	ctx := context.Background()
	var mu sync.Mutex
	updatedMounts := []any{}
	syncs := 0
	wings := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		if r.URL.Path == "/api/update" {
			var config M
			if e := json.NewDecoder(r.Body).Decode(&config); e != nil {
				t.Error(e)
			}
			updatedMounts = asSlice(config["allowed_mounts"])
		} else if strings.HasSuffix(r.URL.Path, "/sync") {
			syncs++
		} else {
			http.NotFound(w, r)
			return
		}
		w.WriteHeader(204)
	}))
	defer wings.Close()
	host, portString, _ := net.SplitHostPort(strings.TrimPrefix(wings.URL, "http://"))
	port, _ := strconv.Atoi(portString)
	location := asMap(infraExpect(t, handler, user, "POST", "/api/admin/locations", M{"short": "mount-test"}, 201)["attributes"])
	node := asMap(infraExpect(t, handler, user, "POST", "/api/admin/nodes", M{"name": "Mount Node", "location_id": location["id"], "fqdn": host, "scheme": "http", "memory": 1000, "memory_overallocate": 0, "disk": 2000, "disk_overallocate": 0, "daemon_listen": port, "daemon_sftp": 2022}, 201)["attributes"])
	nest, e := a.insert(ctx, "nests", M{"uuid": newUUID(), "author": "test@example.invalid", "name": "Mount Nest"})
	if e != nil {
		t.Fatal(e)
	}
	egg, e := a.insert(ctx, "eggs", M{"uuid": newUUID(), "nest_id": nest["id"], "author": "test@example.invalid", "name": "Mount Egg"})
	if e != nil {
		t.Fatal(e)
	}
	uuid := newUUID()
	server, e := a.insert(ctx, "servers", M{"uuid": uuid, "uuid_short": uuid[:8], "identifier": uuid[:8], "name": "Mount Server", "owner_id": user, "node_id": node["id"], "nest_id": nest["id"], "egg_id": egg["id"], "image": "alpine:3.23"})
	if e != nil {
		t.Fatal(e)
	}
	mount := asMap(infraExpect(t, handler, user, "POST", "/api/admin/mounts", M{"name": "Shared files", "source": "/srv/shared", "target": "/shared"}, 201)["attributes"])
	base := fmt.Sprintf("/api/admin/mounts/%d", num(mount["id"]))
	infraExpect(t, handler, user, "POST", base+"/servers", M{"servers": []any{server["id"]}}, 422)
	infraExpect(t, handler, user, "POST", base+"/nodes", M{"nodes": []any{node["id"], 999999999}}, 422)
	count, e := a.one(ctx, "SELECT COUNT(*)::bigint AS count FROM mount_nodes WHERE mount_id=$1", mount["id"])
	if e != nil || num(count["count"]) != 0 {
		t.Fatal("invalid mount assignment partially committed")
	}
	infraExpect(t, handler, user, "POST", base+"/nodes", M{"nodes": []any{node["id"]}}, 204)
	mu.Lock()
	if len(updatedMounts) != 1 || str(updatedMounts[0]) != "/srv/shared" {
		t.Fatal("mount was not applied to daemon allowed_mounts")
	}
	mu.Unlock()
	infraExpect(t, handler, user, "POST", base+"/eggs", M{"eggs": []any{egg["id"]}}, 204)
	infraExpect(t, handler, user, "POST", base+"/servers", M{"servers": []any{server["id"]}}, 204)
	mu.Lock()
	if syncs != 1 {
		t.Fatal("mount attach did not sync server")
	}
	mu.Unlock()
	infraExpect(t, handler, user, "DELETE", base+fmt.Sprintf("/nodes/%d", num(node["id"])), nil, 422)
	infraExpect(t, handler, user, "DELETE", base, nil, 422)
	infraExpect(t, handler, user, "PATCH", base, M{"read_only": true}, 200)
	mu.Lock()
	if syncs != 2 {
		t.Fatal("mount setting update did not sync server")
	}
	mu.Unlock()
	infraExpect(t, handler, user, "DELETE", base+fmt.Sprintf("/servers/%d", num(server["id"])), nil, 204)
	infraExpect(t, handler, user, "DELETE", base+fmt.Sprintf("/nodes/%d", num(node["id"])), nil, 204)
	mu.Lock()
	if len(updatedMounts) != 0 {
		t.Fatal("mount removal did not update daemon allowed_mounts")
	}
	mu.Unlock()
	infraExpect(t, handler, user, "DELETE", base, nil, 204)
}

func TestInfrastructureTimezoneSettings(t *testing.T) {
	a, handler, userID := infraTestApp(t)
	settings := asMap(infraExpect(t, handler, userID, "GET", "/api/admin/settings", nil, 200)["attributes"])
	if str(settings["app:timezone"]) != "UTC" {
		t.Fatal("timezone did not default to UTC")
	}
	a.Config.Timezone = "Europe/Berlin"
	settings = asMap(infraExpect(t, handler, userID, "GET", "/api/admin/settings", nil, 200)["attributes"])
	if str(settings["app:timezone"]) != "Europe/Berlin" {
		t.Fatal("timezone did not use the configured default")
	}
	infraExpect(t, handler, userID, "PATCH", "/api/admin/settings", M{"app:timezone": "Mars/Olympus"}, 422)
	infraExpect(t, handler, userID, "PATCH", "/api/admin/settings", M{"app:timezone": ""}, 422)
	infraExpect(t, handler, userID, "PATCH", "/api/admin/settings", M{"app:timezone": "Asia/Tokyo"}, 422)
	settings = asMap(infraExpect(t, handler, userID, "GET", "/api/admin/settings", nil, 200)["attributes"])
	if str(settings["app:timezone"]) != "Europe/Berlin" {
		t.Fatal("read-only timezone changed")
	}
	for _, key := range []string{"app:name", "app:locale", "app:timezone"} {
		for _, value := range []any{"Changed", nil, ""} {
			infraExpect(t, handler, userID, "PATCH", "/api/admin/settings", M{key: value, "activity:hide_admin_activity": true}, 422)
		}
	}
	settings = asMap(infraExpect(t, handler, userID, "GET", "/api/admin/settings", nil, 200)["attributes"])
	if settings["app:name"] != "Voltra" || settings["app:locale"] != "en" || settings["app:timezone"] != "Europe/Berlin" || boolean(settings["activity:hide_admin_activity"]) {
		t.Fatal("rejected General settings request changed stored settings")
	}
}

func TestInfrastructureOptionalStringsClearing(t *testing.T) {
	a, handler, user := infraTestApp(t)
	ctx := context.Background()
	location := asMap(infraExpect(t, handler, user, "POST", "/api/application/locations", M{"short": "clear-test", "long": "Initial description"}, 201)["attributes"])
	location = asMap(infraExpect(t, handler, user, "PATCH", fmt.Sprintf("/api/application/locations/%d", num(location["id"])), M{"long": ""}, 200)["attributes"])
	if location["long"] != "" {
		t.Fatal("empty location description was not cleared")
	}
	mount := asMap(infraExpect(t, handler, user, "POST", "/api/admin/mounts", M{"name": "Clear description", "description": "Initial description", "source": "/srv/clear", "target": "/clear"}, 201)["attributes"])
	mount = asMap(infraExpect(t, handler, user, "PATCH", fmt.Sprintf("/api/admin/mounts/%d", num(mount["id"])), M{"description": ""}, 200)["attributes"])
	if mount["description"] != "" {
		t.Fatal("empty mount description was not cleared")
	}
	infraExpect(t, handler, user, "PATCH", "/api/admin/settings", M{"backups.s3": M{"endpoint": "http://minio.example.invalid:9000", "daemon_endpoint": "http://minio-daemon.example.invalid:9000"}}, 200)
	infraExpect(t, handler, user, "PATCH", "/api/admin/settings", M{"backups.s3": M{"endpoint": "", "daemon_endpoint": ""}}, 200)
	settings, e := a.infraLoadSettings(ctx)
	if e != nil {
		t.Fatal(e)
	}
	s3 := asMap(settings["backups.s3"])
	if s3["endpoint"] != "" || s3["daemon_endpoint"] != "" {
		t.Fatal("optional S3 endpoints were not cleared")
	}
	infraExpect(t, handler, user, "PATCH", "/api/admin/settings", M{"app:name": ""}, 422)
	infraExpect(t, handler, user, "PATCH", fmt.Sprintf("/api/admin/mounts/%d", num(mount["id"])), M{"name": ""}, 422)
}

func TestInfrastructureNativeCreationRequestRequirements(t *testing.T) {
	a, handler, user := infraTestApp(t)
	ctx := context.Background()
	location := asMap(infraExpect(t, handler, user, "POST", "/api/application/locations", M{"short": "required-native", "long": strings.Repeat("x", 191)}, 201)["attributes"])
	infraExpect(t, handler, user, "POST", "/api/application/locations", M{"short": "too-long", "long": strings.Repeat("x", 192)}, 422)
	base := M{"name": "Native requirements", "location_id": location["id"], "fqdn": "127.0.0.1", "scheme": "http", "memory": 1000, "memory_overallocate": 0, "disk": 2000, "disk_overallocate": 0, "daemon_listen": 8080, "daemon_sftp": 2022}
	for _, endpoint := range []string{"/api/application/nodes", "/api/admin/nodes"} {
		for _, key := range []string{"scheme", "memory_overallocate", "disk_overallocate", "daemon_listen", "daemon_sftp"} {
			missing := M{}
			for k, v := range base {
				missing[k] = v
			}
			delete(missing, key)
			infraExpect(t, handler, user, "POST", endpoint, missing, 422)
			missing[key] = nil
			infraExpect(t, handler, user, "POST", endpoint, missing, 422)
		}
	}
	rows, e := a.one(ctx, "SELECT COUNT(*)::bigint AS count FROM nodes")
	if e != nil || num(rows["count"]) != 0 {
		t.Fatal("invalid native node requests persisted a node")
	}
	infraExpect(t, handler, user, "POST", "/api/admin/database-hosts", M{"name": "missing port", "host": "127.0.0.1", "username": "root"}, 422)
	rows, e = a.one(ctx, "SELECT COUNT(*)::bigint AS count FROM database_hosts")
	if e != nil || num(rows["count"]) != 0 {
		t.Fatal("invalid native database-host request persisted a host")
	}
	rows, e = a.one(ctx, "SELECT COUNT(*)::bigint AS count FROM locations")
	if e != nil || num(rows["count"]) != 1 {
		t.Fatal("invalid location description persisted a location")
	}
	modelDefaults, e := a.infraValidate(ctx, "nodes", M{"name": "Internal defaults", "location_id": location["id"], "fqdn": "127.0.0.1", "memory": 1000, "disk": 2000}, nil)
	if e != nil || str(modelDefaults["scheme"]) != "http" || num(modelDefaults["daemon_listen"]) != 8080 || num(modelDefaults["daemon_sftp"]) != 2022 {
		t.Fatalf("native model defaults changed for internal callers: %v %v", modelDefaults, e)
	}
	hostDefaults, e := a.infraValidate(ctx, "database-hosts", M{"name": "Internal host defaults", "host": "127.0.0.1", "username": "root"}, nil)
	if e != nil || num(hostDefaults["port"]) != 3306 {
		t.Fatalf("database-host internal model default changed: %v %v", hostDefaults, e)
	}
	base["daemon_sftp"] = "2022"
	node := asMap(infraExpect(t, handler, user, "POST", "/api/application/nodes", base, 201)["attributes"])
	if num(node["daemon_sftp"]) != 2022 {
		t.Fatal("numeric-string node port was not persisted as integer")
	}
	for _, key := range []string{"name", "location_id", "fqdn", "scheme", "memory", "memory_overallocate", "disk", "disk_overallocate", "daemon_listen", "daemon_sftp"} {
		patch := M{}
		for k, v := range base {
			patch[k] = v
		}
		delete(patch, key)
		patch["upload_size"] = 456
		infraExpect(t, handler, user, "PATCH", fmt.Sprintf("/api/application/nodes/%d", num(node["id"])), patch, 422)
	}
	unchanged, e := a.one(ctx, "SELECT upload_size FROM nodes WHERE id=$1", node["id"])
	if e != nil || num(unchanged["upload_size"]) != 100 {
		t.Fatal("incomplete native node patch changed persisted configuration")
	}
	host := asMap(infraExpect(t, handler, user, "POST", "/api/admin/database-hosts", M{"name": "valid host", "host": "127.0.0.1", "port": "3306", "username": "root"}, 201)["attributes"])
	if num(host["port"]) != 3306 {
		t.Fatal("numeric-string database host port was not persisted as integer")
	}
	unicodeLocation := asMap(infraExpect(t, handler, user, "POST", "/api/application/locations", M{"short": strings.Repeat("界", 30), "long": strings.Repeat("界", 100)}, 201)["attributes"])
	if unicodeLocation["short"] != strings.Repeat("界", 30) || unicodeLocation["long"] != strings.Repeat("界", 100) {
		t.Fatal("Unicode location text was not preserved")
	}
	infraExpect(t, handler, user, "POST", "/api/application/locations", M{"short": strings.Repeat("界", 61)}, 422)
	infraExpect(t, handler, user, "POST", "/api/application/locations", M{"short": "too-long-unicode", "long": strings.Repeat("界", 192)}, 422)
}

func TestInfrastructureIntegerStringValidation(t *testing.T) {
	for _, text := range []string{"2022", " +2022 ", "-1", "+0", "-0", "0"} {
		data := M{"value": text}
		if e := infraInteger(data, "value", -1, 65535); e != nil {
			t.Fatalf("valid integer %q rejected: %v", text, e)
		}
	}
	for _, text := range []string{"1.5", "1.0", "1e2", "01", "-01", "+01", "", "invalid", "9223372036854775808"} {
		if e := infraInteger(M{"value": text}, "value", -1, 65535); e == nil {
			t.Fatalf("invalid integer %q accepted", text)
		}
	}
}
