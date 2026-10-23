package panel

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	cryptorand "crypto/rand"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"reflect"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/golang-jwt/jwt/v5"
	"github.com/gorilla/websocket"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestOperationsJWTWingsProtocol(t *testing.T) {
	a := &App{Config: Config{PublicURL: "http://localhost:8088"}}
	n := M{"scheme": "http", "fqdn": "127.0.0.1", "daemon_listen": int64(18084), "daemon_token": "test-wings-secret"}
	u := M{"id": int64(42), "uuid": "user-uuid"}
	s := M{"server_uuid": "server-uuid", "permissions": []string{"control.start", "websocket.connect"}}
	token, err := a.nodeJWT(n, u, s, "websocket", 10*time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := jwt.Parse(token, func(t *jwt.Token) (any, error) { return []byte("test-wings-secret"), nil }, jwt.WithValidMethods([]string{"HS256"}), jwt.WithAudience("http://127.0.0.1:18084"), jwt.WithIssuer(a.Config.PublicURL))
	if err != nil {
		t.Fatal(err)
	}
	c := parsed.Claims.(jwt.MapClaims)
	if c["scope"] != "websocket" || c["user_uuid"] != "user-uuid" || c["server_uuid"] != "server-uuid" || c["unique_id"] == "" {
		t.Fatalf("incompatible Wings claims: %#v", c)
	}
	if parsed.Header["jti"] != c["jti"] {
		t.Fatal("Wings JWT identifier header differs from claim")
	}
	second, err := a.nodeJWT(n, u, s, "websocket", 10*time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	if token == second {
		t.Fatal("one-use tokens must be unique")
	}
	if got := opNodeAddress(M{"scheme": "https", "fqdn": "::1", "daemon_listen": int64(8443)}); got != "https://[::1]:8443" {
		t.Fatal(got)
	}
}

func TestOperationsFileValidation(t *testing.T) {
	for _, tc := range []struct {
		op   string
		body M
	}{
		{"pull", M{"url": "file:///etc/passwd"}}, {"rename", M{"files": []any{M{"from": "x"}}}}, {"chmod", M{"files": []any{M{"file": "x", "mode": "999"}}}}, {"delete", M{"files": []any{7}}}, {"compress", M{"files": []any{}}},
	} {
		if opValidateFile(tc.op, tc.body) == nil {
			t.Fatalf("accepted malformed %s", tc.op)
		}
	}
	if err := opValidateFile("rename", M{"files": []any{M{"from": "old name", "to": "new name"}}}); err != nil {
		t.Fatal(err)
	}
	if err := opValidateFile("chmod", M{"files": []any{M{"file": "a", "mode": "0644"}}}); err != nil {
		t.Fatal(err)
	}
}

type operationsFixture struct {
	a                               *App
	mux                             *http.ServeMux
	owner, sub, admin, server, node M
	daemon                          *httptest.Server
	mu                              sync.Mutex
	calls                           []M
	failPath                        string
	delay                           time.Duration
}

func operationsFixtureNew(t *testing.T) *operationsFixture {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL is required for isolated PostgreSQL protocol tests")
	}
	ctx := context.Background()
	base, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	name := "operations_" + randomToken(8)
	if _, err = base.Exec(ctx, `CREATE SCHEMA "`+name+`"`); err != nil {
		base.Close()
		t.Fatal(err)
	}
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = name
	cfg.MaxConns = 4
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	f := &operationsFixture{a: &App{DB: pool, Config: Config{PublicURL: "http://localhost:8088", EncryptionKey: "operations-test-secret"}, HTTP: &http.Client{Timeout: 5 * time.Second}}}
	t.Cleanup(func() { pool.Close(); _, _ = base.Exec(ctx, `DROP SCHEMA "`+name+`" CASCADE`); base.Close() })
	if _, err = pool.Exec(ctx, schema); err != nil {
		t.Fatal(err)
	}
	f.daemon = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		var body any
		_ = json.Unmarshal(b, &body)
		f.mu.Lock()
		f.calls = append(f.calls, M{"method": r.Method, "path": r.URL.Path, "query": r.URL.Query(), "body": body, "raw": string(b), "authorization": r.Header.Get("Authorization")})
		badPath := f.failPath
		delay := f.delay
		f.mu.Unlock()
		if delay > 0 {
			timer := time.NewTimer(delay)
			defer timer.Stop()
			select {
			case <-timer.C:
			case <-r.Context().Done():
				return
			}
		}
		if badPath != "" && strings.HasSuffix(r.URL.Path, badPath) {
			writeJSON(w, 500, M{"error": "Daemon failed intentionally"})
			return
		}
		if strings.HasSuffix(r.URL.Path, "/files/list-directory") {
			writeJSON(w, 200, []M{{"name": "config.txt", "mode": "-rw-r--r--", "mode_bits": "644", "size": 4, "file": true, "mime": "text/plain", "created": "2026-01-01T00:00:00Z", "modified": "2026-01-02T00:00:00Z"}})
			return
		}
		if strings.HasSuffix(r.URL.Path, "/files/contents") {
			w.Write([]byte("hello"))
			return
		}
		if strings.HasSuffix(r.URL.Path, "/files/compress") {
			writeJSON(w, 200, M{"name": "archive.tar.gz", "file": true, "size": 128})
			return
		}
		if strings.HasSuffix(r.URL.Path, "/download/file") {
			w.Header().Set("Content-Disposition", `attachment; filename="config.txt"`)
			w.Write([]byte("downloaded"))
			return
		}
		if strings.HasSuffix(r.URL.Path, "/upload/file") {
			w.WriteHeader(204)
			return
		}
		if r.Method == "GET" {
			writeJSON(w, 200, M{"state": "running", "utilization": M{"memory_bytes": 4096, "cpu_absolute": 2.5, "network": M{"rx_bytes": 10, "tx_bytes": 20}}})
			return
		}
		w.WriteHeader(204)
	}))
	t.Cleanup(f.daemon.Close)
	put := func(table string, m M) M {
		row, e := f.a.insert(ctx, table, m)
		if e != nil {
			t.Fatalf("insert %s: %v", table, e)
		}
		return row
	}
	f.owner = put("users", M{"uuid": newUUID(), "username": "owner", "email": "owner@local.invalid"})
	f.sub = put("users", M{"uuid": newUUID(), "username": "sub", "email": "sub@local.invalid"})
	f.admin = put("users", M{"uuid": newUUID(), "username": "admin", "email": "admin@local.invalid", "root_admin": true})
	loc := put("locations", M{"short": "test"})
	u, _ := url.Parse(f.daemon.URL)
	port, _ := strconv.Atoi(u.Port())
	sealed, err := f.a.seal("operations-daemon-secret")
	if err != nil {
		t.Fatal(err)
	}
	f.node = put("nodes", M{"uuid": newUUID(), "name": "test", "location_id": loc["id"], "fqdn": u.Hostname(), "daemon_listen": port, "daemon_token_id": "operations-token", "daemon_token": sealed})
	nest := put("nests", M{"uuid": newUUID(), "name": "test", "author": "test@example.com"})
	egg := put("eggs", M{"uuid": newUUID(), "nest_id": nest["id"], "name": "test", "author": "test@example.com", "startup": "{{SERVER_IP}}:{{SERVER_PORT}} {{VISIBLE}} {{SECRET}}", "docker_images": M{"Alpine": "alpine:3.23"}})
	f.server = put("servers", M{"uuid": newUUID(), "uuid_short": randomToken(4), "identifier": randomToken(4), "name": "Operations Test", "owner_id": f.owner["id"], "node_id": f.node["id"], "nest_id": nest["id"], "egg_id": egg["id"], "image": "alpine:3.23", "installed_at": now(), "backup_limit": 2, "allocation_limit": 3, "startup": egg["startup"]})
	alloc := put("allocations", M{"node_id": f.node["id"], "server_id": f.server["id"], "ip": "127.0.0.1", "port": 25565})
	f.server, err = f.a.update(ctx, "servers", num(f.server["id"]), M{"allocation_id": alloc["id"]})
	if err != nil {
		t.Fatal(err)
	}
	put("subusers", M{"user_id": f.sub["id"], "server_id": f.server["id"], "permissions": []string{"file.read", "backup.read", "startup.read", "websocket.connect", "control.start"}})
	put("egg_variables", M{"egg_id": egg["id"], "name": "Visible", "env_variable": "VISIBLE", "default_value": "visible", "rules": "required|string|in:visible,changed", "user_editable": true, "user_viewable": true})
	put("egg_variables", M{"egg_id": egg["id"], "name": "Secret", "env_variable": "SECRET", "default_value": "very-secret", "user_editable": false, "user_viewable": false})
	f.mux = http.NewServeMux()
	f.a.registerOperations(f.mux)
	return f
}
func (f *operationsFixture) request(method, path string, body any, user M) *httptest.ResponseRecorder {
	var input io.Reader
	if s, ok := body.(string); ok {
		input = strings.NewReader(s)
	} else if body != nil {
		b, _ := json.Marshal(body)
		input = strings.NewReader(string(b))
	}
	r := httptest.NewRequest(method, path, input)
	r = WithUser(r, num(user["id"]))
	w := httptest.NewRecorder()
	f.mux.ServeHTTP(w, r)
	return w
}
func (f *operationsFixture) serverPath(suffix string) string {
	return "/api/client/servers/" + str(f.server["uuid"]) + suffix
}
func operationsExpect(t *testing.T, w *httptest.ResponseRecorder, status int) M {
	t.Helper()
	if w.Code != status {
		t.Fatalf("status %d wanted %d: %s", w.Code, status, w.Body.String())
	}
	m := M{}
	if status != 204 && w.Body.Len() > 0 {
		_ = json.Unmarshal(w.Body.Bytes(), &m)
	}
	return m
}

func TestOperationsPermissionAndDaemonProtocol(t *testing.T) {
	f := operationsFixtureNew(t)
	operationsExpect(t, f.request("GET", f.serverPath("/files/list?directory=%2Fconfig"), nil, f.sub), 200)
	f.mu.Lock()
	c := f.calls[len(f.calls)-1]
	f.mu.Unlock()
	if c["path"] != "/api/servers/"+str(f.server["uuid"])+"/files/list-directory" || c["authorization"] != "Bearer operations-daemon-secret" {
		t.Fatalf("invalid daemon request %#v", c)
	}
	for _, request := range []struct {
		method, path string
		body         any
	}{{"GET", "/files/contents?file=config.txt", nil}, {"POST", "/files/write?file=config.txt", "write"}, {"POST", "/power", M{"signal": "stop"}}, {"POST", "/power", M{"signal": "kill"}}, {"POST", "/command", M{"command": "say hello"}}, {"POST", "/backups", M{"name": "unauthorized"}}} {
		operationsExpect(t, f.request(request.method, f.serverPath(request.path), request.body, f.sub), 403)
	}
	operationsExpect(t, f.request("POST", f.serverPath("/power"), M{"signal": "start"}, f.sub), 204)
	operationsExpect(t, f.request("POST", f.serverPath("/power"), M{"signal": "shutdown"}, f.owner), 422)
	operationsExpect(t, f.request("POST", f.serverPath("/command"), M{"command": "say hello"}, f.owner), 204)
	f.mu.Lock()
	c = f.calls[len(f.calls)-1]
	f.mu.Unlock()
	commands := asSlice(asMap(c["body"])["commands"])
	if c["path"] != "/api/servers/"+str(f.server["uuid"])+"/commands" || len(commands) != 1 || commands[0] != "say hello" {
		t.Fatalf("invalid console payload: %#v", c)
	}
	r := f.request("GET", f.serverPath("/resources"), nil, f.owner)
	attrs := asMap(operationsExpect(t, r, 200)["attributes"])
	if num(asMap(attrs["resources"])["network_rx_bytes"]) != 10 {
		t.Fatal(r.Body.String())
	}
	f.mu.Lock()
	f.failPath = "/power"
	f.mu.Unlock()
	operationsExpect(t, f.request("POST", f.serverPath("/power"), M{"signal": "start"}, f.owner), 502)
}

func TestOperationsStartupSecretAndValidation(t *testing.T) {
	f := operationsFixtureNew(t)
	response := f.request("GET", f.serverPath("/startup"), nil, f.sub)
	m := operationsExpect(t, response, 200)
	if strings.Contains(response.Body.String(), "very-secret") || !strings.Contains(str(asMap(m["meta"])["startup_command"]), "[hidden]") || !strings.Contains(str(asMap(m["meta"])["startup_command"]), "127.0.0.1:25565") {
		t.Fatal(response.Body.String())
	}
	if len(asSlice(m["data"])) != 1 {
		t.Fatal("hidden variables leaked")
	}
	operationsExpect(t, f.request("PUT", f.serverPath("/startup/variable"), M{"key": "VISIBLE", "value": "changed"}, f.sub), 403)
	operationsExpect(t, f.request("PUT", f.serverPath("/startup/variable"), M{"key": "SECRET", "value": "changed"}, f.owner), 422)
	operationsExpect(t, f.request("PUT", f.serverPath("/startup/variable"), M{"key": "VISIBLE", "value": "invalid"}, f.owner), 422)
	operationsExpect(t, f.request("PUT", f.serverPath("/startup/variable"), M{"key": "VISIBLE", "value": "changed"}, f.owner), 200)
}

func TestOperationsStartupConditionalRequestContext(t *testing.T) {
	f := operationsFixtureNew(t)
	ctx := context.Background()
	variable, err := f.a.insert(ctx, "egg_variables", M{"egg_id": f.server["egg_id"], "name": "Conditional", "env_variable": "TEST", "default_value": "initial", "rules": "required_if:key,TEST", "user_editable": true, "user_viewable": true})
	if err != nil {
		t.Fatal(err)
	}
	_, err = f.a.insert(ctx, "egg_variables", M{"egg_id": f.server["egg_id"], "name": "Stored dependency", "env_variable": "OTHER", "default_value": "stored-other", "rules": "nullable|string", "user_editable": true, "user_viewable": true})
	if err != nil {
		t.Fatal(err)
	}
	operationsExpect(t, f.request("PUT", f.serverPath("/startup/variable"), M{"key": "TEST", "value": ""}, f.owner), 422)
	operationsExpect(t, f.request("PUT", f.serverPath("/startup/variable"), M{"key": "TEST", "value": "provided"}, f.owner), 200)
	_, err = f.a.update(ctx, "egg_variables", num(variable["id"]), M{"rules": "same:key"})
	if err != nil {
		t.Fatal(err)
	}
	operationsExpect(t, f.request("PUT", f.serverPath("/startup/variable"), M{"key": "TEST", "value": "TEST"}, f.owner), 200)
	operationsExpect(t, f.request("PUT", f.serverPath("/startup/variable"), M{"key": "TEST", "value": "wrong"}, f.owner), 422)
	_, err = f.a.update(ctx, "egg_variables", num(variable["id"]), M{"rules": "required_if:environment.OTHER,stored-other"})
	if err != nil {
		t.Fatal(err)
	}
	// OTHER exists in server storage, but this route only validates request data.
	operationsExpect(t, f.request("PUT", f.serverPath("/startup/variable"), M{"key": "TEST", "value": ""}, f.owner), 200)
	operationsExpect(t, f.request("PUT", f.serverPath("/startup/variable"), M{"key": "TEST", "value": "", "environment": M{"OTHER": "stored-other"}}, f.owner), 422)
	_, err = f.a.update(ctx, "egg_variables", num(variable["id"]), M{"rules": "same:environment.OTHER"})
	if err != nil {
		t.Fatal(err)
	}
	operationsExpect(t, f.request("PUT", f.serverPath("/startup/variable"), M{"key": "TEST", "value": "stored-other"}, f.owner), 422)
	operationsExpect(t, f.request("PUT", f.serverPath("/startup/variable"), M{"key": "TEST", "value": "request-other", "environment": M{"OTHER": "request-other"}}, f.owner), 200)
	operationsExpect(t, f.request("PUT", f.serverPath("/startup/variable"), M{"key": "TEST"}, f.owner), 422)
}

func TestOperationsStartupDatabasePresenceRules(t *testing.T) {
	f := operationsFixtureNew(t)
	ctx := context.Background()
	variable, err := f.a.insert(ctx, "egg_variables", M{"egg_id": f.server["egg_id"], "name": "Presence", "env_variable": "PRESENCE", "default_value": "initial", "rules": "exists:egg_variables,env_variable", "user_editable": true, "user_viewable": true})
	if err != nil {
		t.Fatal(err)
	}
	operationsExpect(t, f.request("PUT", f.serverPath("/startup/variable"), M{"key": "PRESENCE", "value": "VISIBLE"}, f.owner), 200)
	operationsExpect(t, f.request("PUT", f.serverPath("/startup/variable"), M{"key": "PRESENCE", "value": "DOES_NOT_EXIST"}, f.owner), 422)
	_, err = f.a.update(ctx, "egg_variables", num(variable["id"]), M{"rules": "unique:egg_variables,env_variable"})
	if err != nil {
		t.Fatal(err)
	}
	operationsExpect(t, f.request("PUT", f.serverPath("/startup/variable"), M{"key": "PRESENCE", "value": "VISIBLE"}, f.owner), 422)
	operationsExpect(t, f.request("PUT", f.serverPath("/startup/variable"), M{"key": "PRESENCE", "value": "NEW_UNIQUE_VALUE"}, f.owner), 200)
}

func TestOperationsSignedFilesAndWebsocketPermissions(t *testing.T) {
	f := operationsFixtureNew(t)
	ctx := context.Background()
	_ = f.a.exec(ctx, `UPDATE subusers SET permissions=$1 WHERE user_id=$2`, []string{"websocket.connect", "control.start", "*", "admin.websocket.errors"}, f.sub["id"])
	m := operationsExpect(t, f.request("GET", f.serverPath("/websocket"), nil, f.sub), 200)
	d := asMap(m["data"])
	token, err := jwt.Parse(str(d["token"]), func(*jwt.Token) (any, error) { return []byte("operations-daemon-secret"), nil }, jwt.WithValidMethods([]string{"HS256"}))
	if err != nil {
		t.Fatal(err)
	}
	c := token.Claims.(jwt.MapClaims)
	perms := asSlice(c["permissions"])
	for _, p := range perms {
		if p == "*" || strings.HasPrefix(str(p), "admin.") {
			t.Fatalf("privileged websocket permission leaked: %v", perms)
		}
	}
	if !strings.Contains(str(d["socket"]), "/api/client/servers/"+str(f.server["uuid"])+"/ws") {
		t.Fatal(d)
	}
	m = operationsExpect(t, f.request("GET", f.serverPath("/files/download?file=%2Fspace%20%25%20file.txt"), nil, f.owner), 200)
	link := str(asMap(m["attributes"])["url"])
	u, err := url.Parse(link)
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := jwt.Parse(u.Query().Get("token"), func(*jwt.Token) (any, error) { return []byte("operations-daemon-secret"), nil })
	if err != nil {
		t.Fatal(err)
	}
	if parsed.Claims.(jwt.MapClaims)["file_path"] != "/space % file.txt" {
		t.Fatal("file path was decoded twice")
	}
	w := f.request("GET", link, nil, f.owner)
	if w.Code != 200 || w.Body.String() != "downloaded" {
		t.Fatal(w.Body.String())
	}
	wrongScope, err := f.a.nodeJWT(M{"scheme": "http", "fqdn": "127.0.0.1", "daemon_listen": num(f.node["daemon_listen"]), "daemon_token": "operations-daemon-secret"}, f.owner, M{"server_uuid": f.server["uuid"]}, "websocket", time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	operationsExpect(t, f.request("GET", fmt.Sprintf("/api/wings/%d/download/file?token=%s", num(f.node["id"]), wrongScope), nil, f.owner), 403)
}

func TestOperationsBackupQuotasAndFailureRollback(t *testing.T) {
	f := operationsFixtureNew(t)
	ctx := context.Background()
	_, _ = f.a.update(ctx, "servers", num(f.server["id"]), M{"backup_limit": 1})
	m := operationsExpect(t, f.request("POST", f.serverPath("/backups"), M{"name": "first", "ignored": "*.log\ncache/", "is_locked": true}, f.owner), 200)
	b := asMap(m["attributes"])
	if b["is_locked"] != true {
		t.Fatal(m)
	}
	operationsExpect(t, f.request("POST", f.serverPath("/backups"), M{"name": "excess"}, f.owner), 422)
	operationsExpect(t, f.request("POST", f.serverPath("/backups/"+str(b["uuid"])+"/restore"), M{"truncate": true}, f.owner), 422)
	stored, err := f.a.one(ctx, `SELECT * FROM backups WHERE uuid=$1`, b["uuid"])
	if err != nil {
		t.Fatal(err)
	}
	_, _ = f.a.update(ctx, "backups", num(stored["id"]), M{"is_successful": true, "completed_at": now()})
	operationsExpect(t, f.request("DELETE", f.serverPath("/backups/"+str(b["uuid"])), nil, f.owner), 422)
	operationsExpect(t, f.request("POST", f.serverPath("/backups/"+str(b["uuid"])+"/lock"), M{}, f.owner), 200)
	f.mu.Lock()
	f.failPath = "/restore"
	f.mu.Unlock()
	operationsExpect(t, f.request("POST", f.serverPath("/backups/"+str(b["uuid"])+"/restore"), M{"truncate": true}, f.owner), 502)
	s, err := f.a.one(ctx, `SELECT status FROM servers WHERE id=$1`, f.server["id"])
	if err != nil || s["status"] != nil {
		t.Fatalf("failed restore left server busy: %#v %v", s, err)
	}
	f.mu.Lock()
	f.failPath = ""
	f.mu.Unlock()
	operationsExpect(t, f.request("DELETE", f.serverPath("/backups/"+str(b["uuid"])), nil, f.owner), 204)
	f.mu.Lock()
	f.failPath = "/backup"
	f.mu.Unlock()
	operationsExpect(t, f.request("POST", f.serverPath("/backups"), M{"name": "failure"}, f.owner), 502)
	count, err := f.a.one(ctx, `SELECT count(*) AS count FROM backups WHERE server_id=$1 AND completed_at IS NULL`, f.server["id"])
	if err != nil || num(count["count"]) != 0 {
		t.Fatalf("failed daemon backup consumed quota: %v %v", count, err)
	}
}

func TestOperationsAllocationLimitsAndPrimary(t *testing.T) {
	f := operationsFixtureNew(t)
	ctx := context.Background()
	operationsExpect(t, f.request("POST", f.serverPath("/network/allocations"), M{}, f.owner), 422)
	_ = f.a.exec(ctx, `INSERT INTO settings(key,value) VALUES('pterodactyl:client_features:allocations:enabled','true')`)
	for i := 0; i < 2; i++ {
		m := operationsExpect(t, f.request("POST", f.serverPath("/network/allocations"), M{}, f.owner), 200)
		if num(asMap(m["attributes"])["port"]) == 25565 {
			t.Fatal("primary port allocated twice")
		}
	}
	operationsExpect(t, f.request("POST", f.serverPath("/network/allocations"), M{}, f.owner), 422)
	operationsExpect(t, f.request("DELETE", f.serverPath("/network/allocations/"+str(f.server["allocation_id"])), nil, f.owner), 422)
}

func TestOperationsS3MultipartProtocol(t *testing.T) {
	f := operationsFixtureNew(t)
	ctx := context.Background()
	var mu sync.Mutex
	seen := []M{}
	s3server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		mu.Lock()
		seen = append(seen, M{"method": r.Method, "path": r.URL.Path, "query": r.URL.Query(), "body": string(b), "authorization": r.Header.Get("Authorization")})
		mu.Unlock()
		w.Header().Set("Content-Type", "application/xml")
		if r.Method == "POST" && r.URL.Query().Has("uploads") {
			fmt.Fprint(w, `<InitiateMultipartUploadResult><Bucket>backups</Bucket><Key>test</Key><UploadId>upload-test</UploadId></InitiateMultipartUploadResult>`)
			return
		}
		if r.Method == "POST" && r.URL.Query().Get("uploadId") != "" {
			fmt.Fprint(w, `<CompleteMultipartUploadResult><Location>test</Location><Bucket>backups</Bucket><Key>test</Key><ETag>etag</ETag></CompleteMultipartUploadResult>`)
			return
		}
		w.WriteHeader(204)
	}))
	defer s3server.Close()
	secret, err := f.a.seal("test-secret-key")
	if err != nil {
		t.Fatal(err)
	}
	settings := M{"bucket": "backups", "region": "us-east-1", "endpoint": s3server.URL, "access_key_id": "test-access-key", "secret_access_key": secret, "path_style": true, "part_size": 5 * 1024 * 1024}
	if err = f.a.exec(ctx, `INSERT INTO settings(key,value) VALUES('backups.s3',$1),('backups.default','"s3"')`, settings); err != nil {
		t.Fatal(err)
	}
	m := operationsExpect(t, f.request("POST", f.serverPath("/backups"), M{"name": "S3 backup"}, f.owner), 200)
	uuid := str(asMap(m["attributes"])["uuid"])
	r := httptest.NewRequest("GET", "/api/remote/backups/"+uuid+"?size=10485760", nil)
	r.Header.Set("Authorization", "Bearer operations-token.operations-daemon-secret")
	w := httptest.NewRecorder()
	f.mux.ServeHTTP(w, r)
	upload := operationsExpect(t, w, 200)
	parts := asSlice(upload["parts"])
	if len(parts) != 2 || num(upload["part_size"]) != 5*1024*1024 {
		t.Fatal(upload)
	}
	for i, v := range parts {
		u, e := url.Parse(str(v))
		if e != nil {
			t.Fatal(e)
		}
		if u.Query().Get("X-Amz-Signature") == "" || u.Query().Get("partNumber") != strconv.Itoa(i+1) || u.Query().Get("uploadId") != "upload-test" {
			t.Fatalf("invalid presigned S3 part: %s", u)
		}
	}
	b, err := f.a.one(ctx, `SELECT * FROM backups WHERE uuid=$1`, uuid)
	if err != nil {
		t.Fatal(err)
	}
	if err = f.a.completeS3Backup(ctx, b, []any{M{"etag": "\"part2\"", "part_number": 2}, M{"etag": "\"part1\"", "part_number": 1}}, true); err != nil {
		t.Fatal(err)
	}
	mu.Lock()
	last := seen[len(seen)-1]
	mu.Unlock()
	payload := str(last["body"])
	if !strings.Contains(payload, "<PartNumber>1</PartNumber>") || strings.Index(payload, "<PartNumber>1</PartNumber>") > strings.Index(payload, "<PartNumber>2</PartNumber>") {
		t.Fatalf("invalid sorted completion XML: %s", payload)
	}
	if !strings.Contains(str(last["authorization"]), "AWS4-HMAC-SHA256") {
		t.Fatal("S3 request missing AWS signature")
	}
	link, err := f.a.s3BackupURL(ctx, f.server, b)
	if err != nil {
		t.Fatal(err)
	}
	u, _ := url.Parse(link)
	if !strings.Contains(u.Path, str(f.server["uuid"])+"/"+uuid+".tar.gz") || u.Query().Get("X-Amz-Signature") == "" {
		t.Fatal("invalid S3 download URL")
	}
	if err = f.a.deleteS3Backup(ctx, f.server, b); err != nil {
		t.Fatal(err)
	}
}

func TestOperationsWebsocketRelayAndOrigin(t *testing.T) {
	f := operationsFixtureNew(t)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, e := (&websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}).Upgrade(w, r, nil)
		if e != nil {
			return
		}
		defer c.Close()
		for {
			kind, b, e := c.ReadMessage()
			if e != nil {
				return
			}
			if e = c.WriteMessage(kind, b); e != nil {
				return
			}
		}
	}))
	defer upstream.Close()
	u, _ := url.Parse(upstream.URL)
	port, _ := strconv.Atoi(u.Port())
	if _, e := f.a.update(context.Background(), "nodes", num(f.node["id"]), M{"fqdn": u.Hostname(), "daemon_listen": port}); e != nil {
		t.Fatal(e)
	}
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { f.mux.ServeHTTP(w, WithUser(r, num(f.owner["id"]))) }))
	defer proxy.Close()
	socketURL := "ws" + strings.TrimPrefix(proxy.URL, "http") + f.serverPath("/ws")
	headers := http.Header{"Origin": []string{proxy.URL}}
	c, resp, err := websocket.DefaultDialer.Dial(socketURL, headers)
	if err != nil {
		if resp != nil {
			t.Fatal(err, resp.Status)
		}
		t.Fatal(err)
	}
	defer c.Close()
	_ = c.SetReadDeadline(time.Now().Add(3 * time.Second))
	frame := `{"event":"auth","args":["signed-token"]}`
	if err = c.WriteMessage(websocket.TextMessage, []byte(frame)); err != nil {
		t.Fatal(err)
	}
	kind, data, err := c.ReadMessage()
	if err != nil || kind != websocket.TextMessage || string(data) != frame {
		t.Fatalf("websocket relay changed frame: %d %s %v", kind, data, err)
	}
	bad, resp, err := websocket.DefaultDialer.Dial(socketURL, http.Header{"Origin": []string{"https://malicious.example"}})
	if bad != nil {
		bad.Close()
	}
	if err == nil || resp == nil || resp.StatusCode != 403 {
		t.Fatalf("cross origin websocket accepted: %v %v", resp, err)
	}
}

func TestOperationsBackupThrottleAndPrune(t *testing.T) {
	f := operationsFixtureNew(t)
	ctx := context.Background()
	for i := 0; i < 2; i++ {
		m := operationsExpect(t, f.request("POST", f.serverPath("/backups"), M{"name": fmt.Sprintf("backup%d", i)}, f.owner), 200)
		uuid := str(asMap(m["attributes"])["uuid"])
		if err := f.a.exec(ctx, `UPDATE backups SET is_successful=true,completed_at=now() WHERE uuid=$1`, uuid); err != nil {
			t.Fatal(err)
		}
		operationsExpect(t, f.request("DELETE", f.serverPath("/backups/"+uuid), nil, f.owner), 204)
		operationsExpect(t, f.request("GET", f.serverPath("/backups/"+uuid), nil, f.owner), 404)
	}
	operationsExpect(t, f.request("POST", f.serverPath("/backups"), M{"name": "throttled"}, f.owner), 429)
	if err := f.a.exec(ctx, `INSERT INTO settings(key,value) VALUES('backups.throttles.period','0')`); err != nil {
		t.Fatal(err)
	}
	m := operationsExpect(t, f.request("POST", f.serverPath("/backups"), M{"name": "stale", "is_locked": true}, f.owner), 200)
	uuid := str(asMap(m["attributes"])["uuid"])
	_ = f.a.exec(ctx, `UPDATE backups SET created_at=now()-interval '7 hours' WHERE uuid=$1`, uuid)
	n, err := f.a.PruneStaleBackups(ctx)
	if err != nil || n != 1 {
		t.Fatalf("prune count %d: %v", n, err)
	}
	b, err := f.a.one(ctx, `SELECT * FROM backups WHERE uuid=$1`, uuid)
	if err != nil || b["completed_at"] == nil || boolean(b["is_successful"]) || boolean(b["is_locked"]) {
		t.Fatalf("pruned backup state %v: %v", b, err)
	}
}

func TestOperationsConcurrentBackupLimit(t *testing.T) {
	f := operationsFixtureNew(t)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if _, err := f.a.update(ctx, "servers", num(f.server["id"]), M{"backup_limit": 1}); err != nil {
		t.Fatal(err)
	}
	var wait sync.WaitGroup
	var mu sync.Mutex
	success := 0
	failed := 0
	for i := 0; i < 12; i++ {
		wait.Add(1)
		go func() {
			defer wait.Done()
			_, err := f.a.createBackup(ctx, f.server, M{"name": "concurrent"})
			mu.Lock()
			defer mu.Unlock()
			if err == nil {
				success++
			} else {
				failed++
			}
		}()
	}
	wait.Wait()
	if success != 1 || failed != 11 {
		t.Fatalf("quota race successes=%d failures=%d", success, failed)
	}
	row, err := f.a.one(ctx, `SELECT count(*) AS count FROM backups WHERE deleted_at IS NULL AND server_id=$1`, f.server["id"])
	if err != nil || num(row["count"]) != 1 {
		t.Fatalf("quota violated: %v %v", row, err)
	}
}

func TestOperationsAllFileActionSchemas(t *testing.T) {
	f := operationsFixtureNew(t)
	for _, tc := range []struct {
		method, endpoint, daemon string
		input                    any
		want                     M
		raw                      string
		status                   int
	}{
		{"POST", "/files/write?file=%2Fconfig%20file.txt", "/files/write", "exact bytes\n", nil, "exact bytes\n", 204},
		{"PUT", "/files/rename", "/files/rename", M{"root": "/data", "files": []any{M{"from": "old", "to": "new"}}}, M{"root": "/data"}, "", 204},
		{"POST", "/files/copy", "/files/copy", M{"location": "/data/a"}, M{"location": "/data/a"}, "", 204},
		{"POST", "/files/delete", "/files/delete", M{"root": "/data", "files": []any{"a", "b"}}, M{"root": "/data"}, "", 204},
		{"POST", "/files/create-folder", "/files/create-directory", M{"root": "/data", "name": "nested"}, M{"path": "/data", "name": "nested"}, "", 204},
		{"POST", "/files/chmod", "/files/chmod", M{"root": "/data", "files": []any{M{"file": "a", "mode": "0644"}}}, M{"root": "/data"}, "", 204},
		{"POST", "/files/compress", "/files/compress", M{"root": "/data", "files": []any{"a"}}, M{"root": "/data"}, "", 200},
		{"POST", "/files/decompress", "/files/decompress", M{"root": "/data", "file": "archive.tar.gz"}, M{"root": "/data", "file": "archive.tar.gz"}, "", 204},
		{"POST", "/files/pull", "/files/pull", M{"directory": "/data", "url": "https://example.com/file", "filename": "download.bin", "use_header": true, "foreground": true}, M{"root": "/data", "url": "https://example.com/file", "file_name": "download.bin", "use_header": true, "foreground": true}, "", 204},
	} {
		t.Run(tc.endpoint, func(t *testing.T) {
			operationsExpect(t, f.request(tc.method, f.serverPath(tc.endpoint), tc.input, f.owner), tc.status)
			f.mu.Lock()
			call := f.calls[len(f.calls)-1]
			f.mu.Unlock()
			if call["method"] != tc.method || !strings.HasSuffix(str(call["path"]), tc.daemon) {
				t.Fatalf("incorrect daemon method or path %#v", call)
			}
			for key, want := range tc.want {
				if asMap(call["body"])[key] != want {
					t.Fatalf("daemon field %s=%v wanted %v", key, asMap(call["body"])[key], want)
				}
			}
			if tc.raw != "" && str(call["raw"]) != tc.raw {
				t.Fatal("raw file bytes changed")
			}
			if strings.Contains(tc.endpoint, "write?") {
				if call["query"].(url.Values).Get("file") != "/config file.txt" {
					t.Fatal("file path encoding changed")
				}
			}
		})
	}
}

func TestOperationsClientReinstallCycleAndRollback(t *testing.T) {
	for _, status := range []string{"", "reinstall_failed"} {
		t.Run("status="+status, func(t *testing.T) { testOperationsClientReinstallCycleAndRollback(t, status) })
	}
}

func testOperationsClientReinstallCycleAndRollback(t *testing.T, status string) {
	f := operationsFixtureNew(t)
	ctx := context.Background()
	previousCycle := "complete:initial:" + newUUID()
	var priorStatus any
	if status != "" {
		priorStatus = status
	}
	before, err := f.a.update(ctx, "servers", num(f.server["id"]), M{"installation_id": previousCycle, "status": priorStatus})
	if err != nil {
		t.Fatal(err)
	}
	operationsExpect(t, f.request("POST", f.serverPath("/settings/reinstall"), M{}, f.owner), 202)
	after, err := f.a.one(ctx, `SELECT * FROM servers WHERE id=$1`, f.server["id"])
	if err != nil {
		t.Fatal(err)
	}
	if str(after["status"]) != "installing" || !strings.HasPrefix(str(after["installation_id"]), "pending:reinstall:") || str(after["installed_at"]) != str(before["installed_at"]) {
		t.Fatalf("invalid reinstall cycle or prior installation timestamp changed: %v", after)
	}
	operationsExpect(t, f.request("POST", f.serverPath("/settings/reinstall"), M{}, f.owner), 409)
	_, err = f.a.update(ctx, "servers", num(f.server["id"]), M{"status": priorStatus, "installation_id": previousCycle})
	if err != nil {
		t.Fatal(err)
	}
	f.mu.Lock()
	f.failPath = "/reinstall"
	f.mu.Unlock()
	operationsExpect(t, f.request("POST", f.serverPath("/settings/reinstall"), M{}, f.owner), 502)
	after, err = f.a.one(ctx, `SELECT * FROM servers WHERE id=$1`, f.server["id"])
	if err != nil {
		t.Fatal(err)
	}
	if str(after["status"]) != status || after["installation_id"] != previousCycle || str(after["installed_at"]) != str(before["installed_at"]) {
		t.Fatalf("rejected daemon reinstall did not restore prior state: %v", after)
	}
}

func TestOperationsArchiveExplicitTimeoutOverride(t *testing.T) {
	f := operationsFixtureNew(t)
	ctx := context.Background()
	if err := f.a.exec(ctx, `INSERT INTO settings(key,value) VALUES('pterodactyl:guzzle:timeout','1')`); err != nil {
		t.Fatal(err)
	}
	f.mu.Lock()
	f.delay = 1200 * time.Millisecond
	f.mu.Unlock()
	for _, tc := range []struct {
		path   string
		body   M
		status int
	}{
		{"/files/compress", M{"root": "/", "files": []any{"config.txt"}}, 200},
		{"/files/decompress", M{"root": "/", "file": "archive.tar.gz"}, 204},
	} {
		start := time.Now()
		operationsExpect(t, f.request("POST", f.serverPath(tc.path), tc.body, f.owner), tc.status)
		if time.Since(start) < time.Second {
			t.Fatal("archive response did not exercise the configured daemon timeout")
		}
	}
	operationsExpect(t, f.request("GET", f.serverPath("/resources"), nil, f.owner), 502)
	if f.a.HTTP.Timeout != 5*time.Second {
		t.Fatal("per-request archive override mutated the shared HTTP client")
	}
}

func TestOperationsNativeActivityProperties(t *testing.T) {
	f := operationsFixtureNew(t)
	ctx := context.Background()
	check := func(event string, want M) {
		t.Helper()
		row, err := f.a.one(ctx, `SELECT properties FROM activity_logs WHERE server_id=$1 AND event=$2 ORDER BY id DESC LIMIT 1`, f.server["id"], event)
		if err != nil {
			t.Fatalf("missing event %s: %v", event, err)
		}
		properties := asMap(row["properties"])
		for key, value := range want {
			actual := properties[key]
			if key == "count" {
				if num(actual) != num(value) {
					t.Fatalf("%s count=%v wanted %v", event, actual, value)
				}
				continue
			}
			gotJSON, _ := json.Marshal(actual)
			wantJSON, _ := json.Marshal(value)
			if !reflect.DeepEqual(gotJSON, wantJSON) {
				t.Fatalf("%s property %s=%s wanted %s", event, key, gotJSON, wantJSON)
			}
		}
	}
	for _, tc := range []struct {
		method, path, event string
		body, want          M
		status              int
	}{
		{"POST", "/files/create-folder", "server:file.create-directory", M{"root": "/data", "name": "created"}, M{"directory": "/data", "name": "created"}, 204},
		{"POST", "/files/copy", "server:file.copy", M{"location": "/data/original.txt"}, M{"file": "/data/original.txt"}, 204},
		{"PUT", "/files/rename", "server:file.rename", M{"root": "/data", "files": []any{M{"from": "old", "to": "new"}, M{"from": "old2", "to": "new2"}}}, M{"directory": "/data", "files": []any{M{"from": "old", "to": "new"}, M{"from": "old2", "to": "new2"}}, "count": 2}, 204},
		{"POST", "/files/compress", "server:file.compress", M{"root": "/data", "files": []any{"a", "b"}}, M{"directory": "/data", "files": []any{"a", "b"}, "count": 2}, 200},
		{"POST", "/files/decompress", "server:file.decompress", M{"root": "/data", "file": "archive.tar.gz"}, M{"directory": "/data", "files": "archive.tar.gz"}, 204},
		{"POST", "/files/delete", "server:file.delete", M{"root": "/data", "files": []any{"a", "b"}}, M{"directory": "/data", "files": []any{"a", "b"}, "count": 2}, 204},
		{"POST", "/files/pull", "server:file.pull", M{"directory": "/data", "url": "https://example.com/public.zip"}, M{"directory": "/data", "url": "https://example.com/public.zip"}, 204},
	} {
		operationsExpect(t, f.request(tc.method, f.serverPath(tc.path), tc.body, f.owner), tc.status)
		check(tc.event, tc.want)
	}
	before, _ := f.a.one(ctx, `SELECT count(*) AS count FROM activity_logs WHERE server_id=$1`, f.server["id"])
	operationsExpect(t, f.request("POST", f.serverPath("/files/chmod"), M{"root": "/data", "files": []any{M{"file": "a", "mode": "0644"}}}, f.owner), 204)
	after, _ := f.a.one(ctx, `SELECT count(*) AS count FROM activity_logs WHERE server_id=$1`, f.server["id"])
	if num(before["count"]) != num(after["count"]) {
		t.Fatal("chmod invented an audit event absent from native controller")
	}
	operationsExpect(t, f.request("POST", f.serverPath("/files/write?file=proof.txt"), "actual proof", f.owner), 204)
	check("server:file.write", M{"file": "proof.txt"})
	response := f.request("GET", f.serverPath("/files/contents?file=proof.txt"), nil, f.owner)
	if response.Code != 200 {
		t.Fatal(response.Body.String())
	}
	check("server:file.read", M{"file": "proof.txt"})
	operationsExpect(t, f.request("GET", f.serverPath("/files/download?file=proof.txt"), nil, f.owner), 200)
	check("server:file.download", M{"file": "proof.txt"})
	operationsExpect(t, f.request("POST", f.serverPath("/command"), M{"command": "say audit proof", "password": "must-not-be-recorded"}, f.owner), 204)
	check("server:console.command", M{"command": "say audit proof"})
	row, _ := f.a.one(ctx, `SELECT properties FROM activity_logs WHERE event='server:console.command' ORDER BY id DESC LIMIT 1`)
	if len(asMap(row["properties"])) != 1 {
		t.Fatal("command audit recorded unrelated submitted values")
	}
	operationsExpect(t, f.request("POST", f.serverPath("/settings/rename"), M{"name": "Renamed proof", "description": "New description"}, f.owner), 204)
	check("server:settings.rename", M{"old": "Operations Test", "new": "Renamed proof"})
	check("server:settings.description", M{"old": "", "new": "New description"})
	_, err := f.a.update(ctx, "eggs", num(f.server["egg_id"]), M{"docker_images": M{"Old": "alpine:3.23", "New": "alpine:3.22"}})
	if err != nil {
		t.Fatal(err)
	}
	operationsExpect(t, f.request("PUT", f.serverPath("/settings/docker-image"), M{"docker_image": "alpine:3.22"}, f.owner), 204)
	check("server:startup.image", M{"old": "alpine:3.23", "new": "alpine:3.22"})
	operationsExpect(t, f.request("PUT", f.serverPath("/startup/variable"), M{"key": "VISIBLE", "value": "changed"}, f.owner), 200)
	check("server:startup.edit", M{"variable": "VISIBLE", "old": "visible", "new": "changed"})
	allocation := str(f.server["allocation_id"])
	operationsExpect(t, f.request("POST", f.serverPath("/network/allocations/"+allocation), M{"notes": "Primary proof"}, f.owner), 200)
	check("server:allocation.notes", M{"allocation": "127.0.0.1:25565", "old": nil, "new": "Primary proof"})
	operationsExpect(t, f.request("POST", f.serverPath("/network/allocations/"+allocation+"/primary"), M{}, f.owner), 200)
	check("server:allocation.primary", M{"allocation": "127.0.0.1:25565"})
	if err = f.a.exec(ctx, `INSERT INTO settings(key,value) VALUES('pterodactyl:client_features:allocations:enabled','true')`); err != nil {
		t.Fatal(err)
	}
	assigned := operationsExpect(t, f.request("POST", f.serverPath("/network/allocations"), M{}, f.owner), 200)
	assignedAttributes := asMap(assigned["attributes"])
	address := str(assignedAttributes["ip"]) + ":" + str(assignedAttributes["port"])
	check("server:allocation.create", M{"allocation": address})
	operationsExpect(t, f.request("DELETE", f.serverPath("/network/allocations/"+str(assignedAttributes["id"])), nil, f.owner), 204)
	check("server:allocation.delete", M{"allocation": address})
	m := operationsExpect(t, f.request("POST", f.serverPath("/backups"), M{"name": "Named proof backup"}, f.owner), 200)
	uuid := str(asMap(m["attributes"])["uuid"])
	check("server:backup.start", M{"name": "Named proof backup", "locked": false})
	_ = f.a.exec(ctx, `UPDATE backups SET is_successful=true,completed_at=now(),bytes=123 WHERE uuid=$1`, uuid)
	for _, event := range []string{"lock", "unlock"} {
		operationsExpect(t, f.request("POST", f.serverPath("/backups/"+uuid+"/lock"), M{}, f.owner), 200)
		check("server:backup."+event, M{"name": "Named proof backup"})
	}
	operationsExpect(t, f.request("GET", f.serverPath("/backups/"+uuid+"/download"), nil, f.owner), 200)
	check("server:backup.download", M{"name": "Named proof backup"})
	operationsExpect(t, f.request("POST", f.serverPath("/backups/"+uuid+"/restore"), M{"truncate": true}, f.owner), 204)
	check("server:backup.restore", M{"name": "Named proof backup", "truncate": true})
	_, _ = f.a.update(ctx, "servers", num(f.server["id"]), M{"status": nil})
	operationsExpect(t, f.request("DELETE", f.serverPath("/backups/"+uuid), nil, f.owner), 204)
	check("server:backup.delete", M{"name": "Named proof backup", "failed": false})
	m = operationsExpect(t, f.request("POST", f.serverPath("/backups"), M{"name": "Stale named proof"}, f.owner), 200)
	_ = f.a.exec(ctx, `UPDATE backups SET created_at=now()-interval '7 hours' WHERE uuid=$1`, str(asMap(m["attributes"])["uuid"]))
	if _, err = f.a.PruneStaleBackups(ctx); err != nil {
		t.Fatal(err)
	}
	check("server:backup.fail", M{"name": "Stale named proof"})
}

// This opt-in test uses the running panel, unmodified Wings and real S3-compatible
// object storage. It creates its own server/bucket and restores global settings.
func TestOperationsRealS3Wings(t *testing.T) {
	base := os.Getenv("TEST_REAL_PANEL_URL")
	if base == "" || os.Getenv("TEST_S3_ENDPOINT") == "" {
		t.Skip("TEST_REAL_PANEL_URL and TEST_S3_* opt in to the real daemon integration")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	pool, err := pgxpool.New(ctx, os.Getenv("TEST_DATABASE_URL"))
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	a := &App{DB: pool, Config: Config{EncryptionKey: os.Getenv("ENCRYPTION_KEY")}, HTTP: &http.Client{Timeout: 15 * time.Second}}
	backupKeys := []string{"backups.default", "backups.s3", "backups.throttles.period"}
	previous := M{}
	for _, key := range backupKeys {
		row, e := a.one(ctx, `SELECT value FROM settings WHERE key=$1`, key)
		if e == nil {
			previous[key] = row["value"]
		}
	}
	defer func() {
		restoreCtx, c := context.WithTimeout(context.Background(), 10*time.Second)
		defer c()
		for _, key := range backupKeys {
			if value, ok := previous[key]; ok {
				encoded, _ := json.Marshal(value)
				if e := a.exec(restoreCtx, `INSERT INTO settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`, key, encoded); e != nil {
					t.Errorf("restoring %s failed", key)
				}
			} else {
				if e := a.exec(restoreCtx, `DELETE FROM settings WHERE key=$1`, key); e != nil {
					t.Errorf("removing temporary %s failed", key)
				}
			}
		}
	}()
	endpoint := os.Getenv("TEST_S3_ENDPOINT")
	bucket := opDefault(os.Getenv("TEST_S3_BUCKET"), "pteroclone-test") + "-" + randomToken(4)
	region := opDefault(os.Getenv("TEST_S3_REGION"), "us-east-1")
	client := s3.New(s3.Options{Region: region, BaseEndpoint: aws.String(endpoint), UsePathStyle: true, Credentials: credentials.NewStaticCredentialsProvider(os.Getenv("TEST_S3_ACCESS_KEY"), os.Getenv("TEST_S3_SECRET_KEY"), "")})
	if _, err = client.CreateBucket(ctx, &s3.CreateBucketInput{Bucket: aws.String(bucket)}); err != nil {
		t.Fatal("real S3 bucket creation failed:", err)
	}
	defer func() {
		cleanup, c := context.WithTimeout(context.Background(), 15*time.Second)
		defer c()
		objects, e := client.ListObjectsV2(cleanup, &s3.ListObjectsV2Input{Bucket: aws.String(bucket)})
		if e == nil {
			for _, object := range objects.Contents {
				_, _ = client.DeleteObject(cleanup, &s3.DeleteObjectInput{Bucket: aws.String(bucket), Key: object.Key})
			}
		}
		_, _ = client.DeleteBucket(cleanup, &s3.DeleteBucketInput{Bucket: aws.String(bucket)})
	}()
	secret, err := a.seal(os.Getenv("TEST_S3_SECRET_KEY"))
	if err != nil {
		t.Fatal(err)
	}
	daemonEndpoint := os.Getenv("TEST_S3_DAEMON_ENDPOINT")
	if daemonEndpoint == "" {
		u, _ := url.Parse(endpoint)
		daemonEndpoint = u.Scheme + "://host.docker.internal:" + u.Port()
	}
	s3settings := M{"bucket": bucket, "region": region, "endpoint": endpoint, "daemon_endpoint": daemonEndpoint, "access_key_id": os.Getenv("TEST_S3_ACCESS_KEY"), "secret_access_key": secret, "path_style": true, "part_size": 5 * 1024 * 1024}
	for key, value := range (M{"backups.default": "s3", "backups.s3": s3settings, "backups.throttles.period": 0}) {
		encoded, _ := json.Marshal(value)
		if err = a.exec(ctx, `INSERT INTO settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`, key, encoded); err != nil {
			t.Fatal(err)
		}
	}
	api := func(method, path string, body any) (M, error) {
		var reader io.Reader
		if body != nil {
			if raw, ok := body.(string); ok {
				reader = strings.NewReader(raw)
			} else {
				b, _ := json.Marshal(body)
				reader = bytes.NewReader(b)
			}
		}
		r, e := http.NewRequestWithContext(ctx, method, base+path, reader)
		if e != nil {
			return nil, e
		}
		r.Header.Set("Content-Type", "application/json")
		res, e := a.HTTP.Do(r)
		if e != nil {
			return nil, e
		}
		defer res.Body.Close()
		if res.StatusCode < 200 || res.StatusCode >= 300 {
			b, _ := io.ReadAll(io.LimitReader(res.Body, 2048))
			return nil, fmt.Errorf("%s %s status%d %s", method, path, res.StatusCode, b)
		}
		if res.StatusCode == 204 {
			return M{}, nil
		}
		var m M
		if e = json.NewDecoder(res.Body).Decode(&m); e != nil {
			return nil, e
		}
		return m, nil
	}
	fixtureBytes, err := os.ReadFile(opDefault(os.Getenv("TEST_REAL_FIXTURES"), "../../.local/runtime-fixtures.json"))
	if err != nil {
		t.Fatal(err)
	}
	var f M
	if err = json.Unmarshal(fixtureBytes, &f); err != nil {
		t.Fatal(err)
	}
	port := int64(27000 + time.Now().UnixNano()%1000)
	if _, err = api("POST", fmt.Sprintf("/api/application/nodes/%d/allocations", num(f["node"])), M{"ip": "0.0.0.0", "ports": []string{strconv.FormatInt(port, 10)}}); err != nil {
		t.Fatal(err)
	}
	allocations, err := api("GET", fmt.Sprintf("/api/application/nodes/%d/allocations?per_page=100", num(f["node"])), nil)
	if err != nil {
		t.Fatal(err)
	}
	allocationID := int64(0)
	for _, row := range asSlice(allocations["data"]) {
		m := asMap(asMap(row)["attributes"])
		if num(m["port"]) == port {
			allocationID = num(m["id"])
		}
	}
	if allocationID == 0 {
		t.Fatal("dedicated allocation missing")
	}
	defer func() {
		cleanup, c := context.WithTimeout(context.Background(), 5*time.Second)
		defer c()
		_ = a.exec(cleanup, `DELETE FROM allocations WHERE id=$1 AND server_id IS NULL`, allocationID)
	}()
	m, err := api("POST", "/api/application/servers", M{"name": "Real S3 acceptance " + randomToken(3), "user": 1, "node_id": f["node"], "egg": f["egg"], "allocation": M{"default": allocationID}, "docker_image": "pteroclone-smoke:local", "startup": f["startup"], "environment": M{}, "limits": M{"memory": 128, "swap": 0, "disk": 512, "io": 500, "cpu": 100}, "feature_limits": M{"backups": 2, "allocations": 1, "databases": 0}, "start_on_completion": false})
	if err != nil {
		t.Fatal(err)
	}
	server := asMap(m["attributes"])
	uuid := str(server["uuid"])
	serverID := num(server["id"])
	defer func() {
		cleanup, c := context.WithTimeout(context.Background(), 15*time.Second)
		defer c()
		req, _ := http.NewRequestWithContext(cleanup, "DELETE", fmt.Sprintf("%s/api/application/servers/%d?force=true", base, serverID), nil)
		if res, e := a.HTTP.Do(req); e == nil {
			res.Body.Close()
		}
	}()
	prefix := "/api/client/servers/" + uuid
	waitFor := func(label string, predicate func() bool) {
		t.Helper()
		deadline := time.Now().Add(45 * time.Second)
		for time.Now().Before(deadline) && ctx.Err() == nil {
			if predicate() {
				return
			}
			time.Sleep(250 * time.Millisecond)
		}
		t.Fatal("timed out waiting for " + label)
	}
	waitFor("real Wings installation", func() bool {
		m, e := api("GET", prefix, nil)
		return e == nil && !boolean(asMap(m["attributes"])["is_installing"]) && str(asMap(m["attributes"])["status"]) == ""
	})
	original := "real Wings S3 proof " + randomToken(12)
	if _, err = api("POST", prefix+"/files/write?file=s3-proof.txt", original); err != nil {
		t.Fatal(err)
	}
	large := make([]byte, 6<<20)
	if _, err = io.ReadFull(cryptorand.Reader, large); err != nil {
		t.Fatal(err)
	}
	if _, err = api("POST", prefix+"/files/write?file=s3-large.bin", string(large)); err != nil {
		t.Fatal(err)
	}
	m, err = api("POST", prefix+"/backups", M{"name": "Real S3 lifecycle backup"})
	if err != nil {
		t.Fatal(err)
	}
	backupUUID := str(asMap(m["attributes"])["uuid"])
	waitFor("Wings multipart upload and callback", func() bool {
		m, e := api("GET", prefix+"/backups/"+backupUUID, nil)
		if e != nil {
			return false
		}
		b := asMap(m["attributes"])
		if b["completed_at"] != nil && !boolean(b["is_successful"]) {
			t.Fatal("real Wings reported S3 backup failure")
		}
		return boolean(b["is_successful"]) && num(b["bytes"]) > 0
	})
	head, err := client.HeadObject(ctx, &s3.HeadObjectInput{Bucket: aws.String(bucket), Key: aws.String(uuid + "/" + backupUUID + ".tar.gz")})
	if err != nil {
		t.Fatal("real S3 object missing after callback")
	}
	if aws.ToInt64(head.ContentLength) < 5<<20 || !strings.HasSuffix(strings.Trim(aws.ToString(head.ETag), "\""), "-2") {
		t.Fatal("real S3 upload did not produce the expected two-part multipart object")
	}
	m, err = api("GET", prefix+"/backups/"+backupUUID+"/download", nil)
	if err != nil {
		t.Fatal(err)
	}
	downloadURL := str(asMap(m["attributes"])["url"])
	response, err := http.Get(downloadURL)
	if err != nil {
		t.Fatal("real S3 signed download failed")
	}
	archive, err := io.ReadAll(response.Body)
	response.Body.Close()
	if err != nil || response.StatusCode != 200 {
		t.Fatalf("S3 download status%d", response.StatusCode)
	}
	gz, err := gzip.NewReader(bytes.NewReader(archive))
	if err != nil {
		t.Fatal("download is not a gzip archive")
	}
	tarReader := tar.NewReader(gz)
	found := false
	for {
		header, e := tarReader.Next()
		if e == io.EOF {
			break
		}
		if e != nil {
			t.Fatal(e)
		}
		if strings.TrimPrefix(header.Name, "./") == "s3-proof.txt" {
			b, e := io.ReadAll(tarReader)
			if e != nil || string(b) != original {
				t.Fatal("S3 archive proof bytes differ")
			}
			found = true
		}
	}
	gz.Close()
	if !found {
		t.Fatal("proof file absent from real S3 archive")
	}
	if _, err = api("POST", prefix+"/files/write?file=s3-proof.txt", "mutated after backup"); err != nil {
		t.Fatal(err)
	}
	if _, err = api("POST", prefix+"/backups/"+backupUUID+"/restore", M{"truncate": true}); err != nil {
		t.Fatal(err)
	}
	waitFor("S3 restore callback", func() bool {
		m, e := api("GET", prefix, nil)
		return e == nil && str(asMap(m["attributes"])["status"]) == ""
	})
	res, err := http.Get(base + prefix + "/files/contents?file=s3-proof.txt")
	if err != nil {
		t.Fatal(err)
	}
	content, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if res.StatusCode != 200 || string(content) != original {
		t.Fatalf("real S3 restore did not recover original bytes status%d", res.StatusCode)
	}
	if _, err = api("DELETE", prefix+"/backups/"+backupUUID, nil); err != nil {
		t.Fatal(err)
	}
	if _, err = client.HeadObject(ctx, &s3.HeadObjectInput{Bucket: aws.String(bucket), Key: aws.String(uuid + "/" + backupUUID + ".tar.gz")}); err == nil {
		t.Fatal("deleted backup still exists in S3")
	}
	result := M{"tested_at": now(), "storage": "RustFS S3-compatible real server", "daemon": "unmodified Wings", "server_uuid": uuid, "multipart_upload_callback": true, "signed_gzip_download_bytes": len(archive), "restored_original_bytes": true, "s3_object_deleted": true}
	b, _ := json.MarshalIndent(result, "", "  ")
	_ = os.WriteFile("../../.local/s3-real-result.json", b, 0600)
	t.Log("Real Wings S3 upload, callback, signed gzip archive download, restore, object deletion passed")
}
