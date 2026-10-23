package panel

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/ssh"
)

func TestAPIKeyIPAllowlist(t *testing.T) {
	for _, tt := range []struct {
		name, remote string
		ips          []any
		want         bool
	}{
		{"unrestricted", "broken", nil, true}, {"IPv4 exact", "127.0.0.1:5000", []any{"127.0.0.1"}, true},
		{"IPv4 CIDR", "10.7.4.2:443", []any{"10.7.0.0/16"}, true}, {"different network", "10.8.4.2:443", []any{"10.7.0.0/16"}, false},
		{"IPv6", "[2001:db8::7]:443", []any{"2001:db8::/32"}, true}, {"mapped address", "[::ffff:127.0.0.1]:443", []any{"127.0.0.1"}, true},
		{"invalid configured address", "127.0.0.1:443", []any{"*"}, false}, {"invalid peer", "unknown", []any{"127.0.0.1"}, false},
	} {
		t.Run(tt.name, func(t *testing.T) {
			if got := keyIPAllowed(tt.remote, tt.ips); got != tt.want {
				t.Fatalf("got %v want %v", got, tt.want)
			}
		})
	}
}

func TestExactServerPermissions(t *testing.T) {
	if !hasServerPermission([]any{"file.read"}, "file.read") {
		t.Fatal("exact grant denied")
	}
	for _, permission := range []string{"file.read-content", "file.delete", "control.start", "unknown.read", "file.*", "*"} {
		if hasServerPermission([]any{"file.read", "file.*", "*"}, permission) {
			t.Fatalf("permission escalation to %s", permission)
		}
	}
	count := 0
	for group, keys := range permissionGroups {
		for _, key := range keys {
			count++
			if !validServerPermission(group + "." + key) {
				t.Fatalf("missing catalog permission %s.%s", group, key)
			}
		}
	}
	if count != 40 {
		t.Fatalf("catalog has %d permissions; expected upstream 40", count)
	}
}

func TestApplicationScopes(t *testing.T) {
	scopes := M{"nodes": int64(1), "servers": int64(3), "allocations": int64(2), "eggs": int64(1), "server_databases": int64(1)}
	cases := []struct {
		method, path string
		want         bool
	}{{"GET", "/api/application/nodes", true}, {"POST", "/api/application/nodes", false}, {"DELETE", "/api/application/servers/1", true}, {"GET", "/api/application/nodes/1/allocations", false}, {"POST", "/api/application/nodes/1/allocations", true}, {"GET", "/api/application/nests/1/eggs", true}, {"GET", "/api/application/servers/1/databases", true}, {"DELETE", "/api/application/servers/1/databases/2", false}, {"GET", "/api/admin/users", false}}
	for _, tt := range cases {
		if got := applicationScopeAllowed(scopes, tt.method, tt.path); got != tt.want {
			t.Errorf("%s %s got %v want %v", tt.method, tt.path, got, tt.want)
		}
	}
	for _, path := range []string{"/api/application/users/external/eggs", "/api/application/users/external/allocations", "/api/application/servers/external/allocations", "/api/application/servers/external/databases"} {
		if applicationScopeAllowed(M{"eggs": int64(1), "allocations": int64(1), "server_databases": int64(1)}, http.MethodGet, path) {
			t.Fatalf("external ID reinterpreted as API scope: %s", path)
		}
	}
	if _, err := validateApplicationScopes(M{"users": 4}); err == nil {
		t.Fatal("out of range grant accepted")
	}
	if _, err := validateApplicationScopes(M{"users": 1.5}); err == nil {
		t.Fatal("fractional grant accepted")
	}
	if _, err := validateApplicationScopes(M{"users": "3"}); err == nil {
		t.Fatal("string grant accepted")
	}
}

func TestSSHKeyValidation(t *testing.T) {
	public, _, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	key, err := ssh.NewPublicKey(public)
	if err != nil {
		t.Fatal(err)
	}
	raw := strings.TrimSpace(string(ssh.MarshalAuthorizedKey(key)))
	parsed, fingerprint, err := parseUserSSHKey(raw + " test@example.test")
	if err != nil {
		t.Fatal(err)
	}
	if parsed != raw || fingerprint != ssh.FingerprintSHA256(key) {
		t.Fatal("key canonicalization or fingerprint mismatch")
	}
	for _, invalid := range []string{"", "not a key", "-----BEGIN PRIVATE KEY-----", raw + "\n" + raw, "command=\"echo unsafe\" " + raw} {
		if _, _, e := parseUserSSHKey(invalid); e == nil {
			t.Fatalf("accepted invalid SSH key %q", invalid)
		}
	}
	der, err := x509.MarshalPKIXPublicKey(public)
	if err != nil {
		t.Fatal(err)
	}
	pemPublic := string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: der}))
	if normalized, fp, e := parseUserSSHKey(pemPublic); e != nil || normalized != raw || fp != fingerprint {
		t.Fatalf("PEM public key failed: %v", e)
	}
	weak, err := rsa.GenerateKey(rand.Reader, 1024)
	if err != nil {
		t.Fatal(err)
	}
	weakKey, err := ssh.NewPublicKey(&weak.PublicKey)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, e := parseUserSSHKey(string(ssh.MarshalAuthorizedKey(weakKey))); e == nil {
		t.Fatal("weak RSA key accepted")
	}
}

func TestUserDataValidation(t *testing.T) {
	good := M{"username": "tester", "email": "Test@Example.test", "first_name": "Test", "last_name": "User", "root_admin": false}
	data, err := accountUserData(good, true)
	if err != nil {
		t.Fatal(err)
	}
	if str(data["email"]) != "test@example.test" || str(data["uuid"]) == "" {
		t.Fatal("identity normalization failed")
	}
	for _, invalid := range []M{{"username": "../../admin"}, {"email": "Admin <a@example.test>"}, {"root_admin": "true"}, {"disabled": 1}, {"username": ""}, {"email": "broken"}} {
		if _, e := accountUserData(invalid, false); e == nil {
			t.Fatalf("accepted invalid user input %v", invalid)
		}
	}
	if _, e := validateAllowedIPs([]any{"not-an-IP"}); e == nil {
		t.Fatal("invalid IP accepted")
	}
	if _, e := validateAllowedIPs([]any{1}); e == nil {
		t.Fatal("non-string IP accepted")
	}
}

func TestNativeUsernameAndAvailableLanguages(t *testing.T) {
	for _, username := range []string{"a", "ab", "abc_", "abc-", "abc.", "_abc", strings.Repeat("a", 192)} {
		if _, err := accountUserData(M{"username": username}, false); err == nil {
			t.Errorf("native Username rule accepted %q", username)
		}
	}
	for _, username := range []string{"abc", "A_b.C-9", strings.Repeat("a", 191)} {
		data, err := accountUserData(M{"username": username}, false)
		if err != nil || data["username"] != strings.ToLower(username) {
			t.Errorf("valid native username %q was not lowercased: %v", username, err)
		}
	}
	for _, language := range []any{"", "zz", "EN", "english", "../en", 7, nil} {
		if _, err := accountUserData(M{"language": language}, false); err == nil {
			t.Errorf("unavailable or invalid locale accepted: %v", language)
		}
	}
	if _, err := accountUserData(M{"language": "en"}, false); err != nil {
		t.Fatal("bundled English language rejected", err)
	}
	directory := t.TempDir()
	if err := os.Mkdir(filepath.Join(directory, "de"), 0700); err != nil {
		t.Fatal(err)
	}
	if _, err := accountUserDataWithLocales(M{"language": "de"}, false, directory); err != nil {
		t.Fatal("installed custom locale rejected", err)
	}
}

func TestAccountValidationPostgresHTTPNoPartialMutation(t *testing.T) {
	a := cliTestApp(t) // Own PostgreSQL schema with the complete current schema.
	a.Config.PublicURL = "http://127.0.0.1:8088"
	ctx := context.Background()
	if err := a.SeedDevelopment(ctx); err != nil {
		t.Fatal(err)
	}
	request := func(method, path string, body M) *httptest.ResponseRecorder {
		encoded, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		r := httptest.NewRequest(method, path, strings.NewReader(string(encoded)))
		r.Host, r.RemoteAddr = "127.0.0.1:8088", "127.0.0.1:55555"
		w := httptest.NewRecorder()
		a.Handler().ServeHTTP(w, r)
		return w
	}
	created := request("POST", "/api/application/users", M{"username": "Native.User9", "email": "validation@example.test", "first_name": "Initial", "last_name": "User", "language": "en"})
	if created.Code != 201 {
		t.Fatalf("valid creation status %d", created.Code)
	}
	var response M
	if err := json.Unmarshal(created.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	attributes := asMap(response["attributes"])
	id := num(attributes["id"])
	if attributes["username"] != "native.user9" {
		t.Fatal("HTTP creation did not normalize native lowercase username")
	}
	for i, fields := range []M{{"username": "a"}, {"username": "ab"}, {"username": "abc_"}, {"language": "zz"}, {"language": 17}, {"language": nil}} {
		body := M{"username": "invaliduser" + str(i), "email": "invalid" + str(i) + "@example.test", "first_name": "Invalid", "last_name": "User", "language": "en"}
		for key, value := range fields {
			body[key] = value
		}
		if result := request("POST", "/api/application/users", body); result.Code != 422 {
			t.Errorf("invalid create case %d status %d", i, result.Code)
		}
		var count int64
		if err := a.DB.QueryRow(ctx, "SELECT count(*) FROM users").Scan(&count); err != nil {
			t.Fatal(err)
		}
		if count != 2 {
			t.Errorf("invalid creation persisted case %d, users=%d", i, count)
		}
	}
	for i, fields := range []M{{"username": "a"}, {"username": "abc_"}, {"language": "zz"}, {"language": nil}} {
		body := M{"username": "native.user9", "email": "validation@example.test", "first_name": "must not persist", "last_name": "User"}
		for key, value := range fields {
			body[key] = value
		}
		if result := request("PATCH", "/api/application/users/"+str(id), body); result.Code != 422 {
			t.Errorf("invalid user update case %d status %d", i, result.Code)
		}
		var username, language, first string
		if err := a.DB.QueryRow(ctx, "SELECT username,language,name_first FROM users WHERE id=$1", id).Scan(&username, &language, &first); err != nil {
			t.Fatal(err)
		}
		if username != "native.user9" || language != "en" || first != "Initial" {
			t.Errorf("invalid user update partially persisted case %d", i)
		}
	}
	for i, language := range []any{"zz", "english", nil, 7} {
		if result := request("PATCH", "/api/client/account", M{"language": language, "first_name": "must not persist"}); result.Code != 422 {
			t.Errorf("invalid profile locale case %d status %d", i, result.Code)
		}
		var language, first string
		if err := a.DB.QueryRow(ctx, "SELECT language,name_first FROM users WHERE id=1").Scan(&language, &first); err != nil {
			t.Fatal(err)
		}
		if language != "en" || first != "Local" {
			t.Errorf("invalid profile update partially persisted case %d", i)
		}
	}
	directory := t.TempDir()
	if err := os.Mkdir(filepath.Join(directory, "de"), 0700); err != nil {
		t.Fatal(err)
	}
	a.Config.LocalesDir = directory
	if result := request("PATCH", "/api/application/users/"+str(id), M{"username": "native.user9", "email": "validation@example.test", "first_name": "Initial", "last_name": "User", "language": "de"}); result.Code != 200 {
		t.Errorf("installed locale user update status %d", result.Code)
	}
	if result := request("PATCH", "/api/client/account", M{"language": "de"}); result.Code != 200 {
		t.Errorf("installed locale profile update status %d", result.Code)
	}
}

func TestAccountUnicodeExternalIDAndNativePatchPostgres(t *testing.T) {
	a := cliTestApp(t)
	a.Config.PublicURL = "http://127.0.0.1:8088"
	ctx := context.Background()
	if err := a.SeedDevelopment(ctx); err != nil {
		t.Fatal(err)
	}
	request := func(method, path string, body M) *httptest.ResponseRecorder {
		encoded, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		r := httptest.NewRequest(method, path, strings.NewReader(string(encoded)))
		r.Host, r.RemoteAddr = "127.0.0.1:8088", "127.0.0.1:55555"
		w := httptest.NewRecorder()
		a.Handler().ServeHTTP(w, r)
		return w
	}
	identity := func() M {
		return M{"username": "unicodeuser", "email": "unicode@example.test", "first_name": strings.Repeat("名", 100), "last_name": strings.Repeat("姓", 191)}
	}
	valid := identity()
	valid["external_id"] = strings.Repeat("界", 191)
	created := request("POST", "/api/application/users", valid)
	if created.Code != 201 {
		t.Fatalf("native-valid Unicode names and external ID status %d", created.Code)
	}
	var value M
	if err := json.Unmarshal(created.Body.Bytes(), &value); err != nil {
		t.Fatal(err)
	}
	id := num(asMap(value["attributes"])["id"])
	path := "/api/application/users/" + str(id)
	assertOriginal := func() {
		var first, last, external string
		if err := a.DB.QueryRow(ctx, "SELECT name_first,name_last,external_id FROM users WHERE id=$1", id).Scan(&first, &last, &external); err != nil {
			t.Fatal(err)
		}
		if first != strings.Repeat("名", 100) || last != strings.Repeat("姓", 191) || external != strings.Repeat("界", 191) {
			t.Error("rejected request changed persisted account fields")
		}
	}
	for _, missing := range []string{"username", "email", "first_name", "last_name"} {
		body := identity()
		body["external_id"] = "must not persist"
		delete(body, missing)
		if result := request("PATCH", path, body); result.Code != 422 {
			t.Errorf("native PATCH missing %s status %d", missing, result.Code)
		}
		assertOriginal()
	}
	for i, invalid := range []M{{"external_id": M{"fixture": "object"}}, {"external_id": 17}, {"external_id": []any{"array"}}, {"external_id": strings.Repeat("界", 192)}, {"first_name": strings.Repeat("名", 192)}, {"last_name": strings.Repeat("姓", 192)}} {
		body := identity()
		for key, v := range invalid {
			body[key] = v
		}
		if result := request("PATCH", path, body); result.Code != 422 {
			t.Errorf("invalid native update case %d status %d", i, result.Code)
		}
		assertOriginal()
		body["username"] = "invalidunicode" + str(i)
		body["email"] = "invalidunicode" + str(i) + "@example.test"
		if result := request("POST", "/api/application/users", body); result.Code != 422 {
			t.Errorf("invalid create case %d status %d", i, result.Code)
		}
		var count int
		if err := a.DB.QueryRow(ctx, "SELECT count(*) FROM users").Scan(&count); err != nil {
			t.Fatal(err)
		}
		if count != 2 {
			t.Errorf("invalid create case %d persisted an account", i)
		}
	}
	updated := identity()
	updated["external_id"] = nil
	if result := request("PATCH", path, updated); result.Code != 200 {
		t.Errorf("full native update and nullable external ID status %d", result.Code)
	}
	var external *string
	if err := a.DB.QueryRow(ctx, "SELECT external_id FROM users WHERE id=$1", id).Scan(&external); err != nil {
		t.Fatal(err)
	}
	if external != nil {
		t.Error("nullable external ID did not persist null")
	}
	if result := request("PATCH", "/api/admin/users/"+str(id), M{"first_name": "Partial admin"}); result.Code != 200 {
		t.Errorf("admin partial update status %d", result.Code)
	}
	if result := request("PATCH", "/api/client/account", M{"first_name": strings.Repeat("名", 191), "last_name": strings.Repeat("姓", 100)}); result.Code != 200 {
		t.Errorf("Unicode profile partial update status %d", result.Code)
	}
	if result := request("PATCH", "/api/client/account", M{"first_name": strings.Repeat("名", 192), "last_name": "must not persist"}); result.Code != 422 {
		t.Errorf("overlong Unicode profile update status %d", result.Code)
	}
	var first, last string
	if err := a.DB.QueryRow(ctx, "SELECT name_first,name_last FROM users WHERE id=1").Scan(&first, &last); err != nil {
		t.Fatal(err)
	}
	if first != strings.Repeat("名", 191) || last != strings.Repeat("姓", 100) {
		t.Error("invalid Unicode profile update changed account")
	}
}

// This test uses the real PostgreSQL schema and exercises credentials through the
// same HTTP handlers used by the application. It never touches the PHP database.
func TestAccountsPostgresIsolation(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL is required for PostgreSQL integration")
	}
	ctx := context.Background()
	admin, e := pgxpool.New(ctx, url)
	if e != nil {
		t.Fatal(e)
	}
	defer admin.Close()
	dbSchema := "accounts_test_" + randomToken(6)
	quotedSchema, e := quoted(dbSchema)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = admin.Exec(ctx, "CREATE SCHEMA "+quotedSchema); e != nil {
		t.Fatal(e)
	}
	defer admin.Exec(ctx, "DROP SCHEMA "+quotedSchema+" CASCADE")
	config, e := pgxpool.ParseConfig(url)
	if e != nil {
		t.Fatal(e)
	}
	config.ConnConfig.RuntimeParams["search_path"] = dbSchema
	pool, e := pgxpool.NewWithConfig(ctx, config)
	if e != nil {
		t.Fatal(e)
	}
	defer pool.Close()
	if _, e = pool.Exec(ctx, schema); e != nil {
		t.Fatal(e)
	}
	a := &App{DB: pool}
	suffix := randomToken(8)
	var ownerID, otherID, outsiderID int64
	for i, name := range []string{"owner", "other", "outsider"} {
		var id int64
		e = pool.QueryRow(ctx, "INSERT INTO users(uuid,username,email,name_first,name_last,root_admin) VALUES($1,$2,$3,'Test','User',$4) RETURNING id", newUUID(), name+suffix, name+suffix+"@example.test", i == 0).Scan(&id)
		if e != nil {
			t.Fatal(e)
		}
		if i == 0 {
			ownerID = id
		} else if i == 1 {
			otherID = id
		} else {
			outsiderID = id
		}
		defer pool.Exec(ctx, "DELETE FROM users WHERE id=$1", id)
	}
	mux := http.NewServeMux()
	a.registerAccounts(mux)
	mux.HandleFunc("GET /api/client/servers/{server}/files/list", func(w http.ResponseWriter, r *http.Request) {
		if _, e := a.server(r, "file.read"); e != nil {
			fail(w, e)
			return
		}
		w.WriteHeader(204)
	})
	mux.HandleFunc("GET /api/client/servers/{server}/files/content", func(w http.ResponseWriter, r *http.Request) {
		if _, e := a.server(r, "file.read-content"); e != nil {
			fail(w, e)
			return
		}
		w.WriteHeader(204)
	})
	mux.HandleFunc("GET /api/client/servers/{server}", func(w http.ResponseWriter, r *http.Request) {
		if _, e := a.server(r, ""); e != nil {
			fail(w, e)
			return
		}
		w.WriteHeader(204)
	})
	mux.HandleFunc("GET /api/client/servers/{server}/ws", func(w http.ResponseWriter, r *http.Request) {
		if _, e := a.server(r, "websocket.connect"); e != nil {
			fail(w, e)
			return
		}
		w.WriteHeader(204)
	})
	request := func(method, path, body string, userID int64, token string) *httptest.ResponseRecorder {
		t.Helper()
		r := httptest.NewRequest(method, path, strings.NewReader(body))
		r.RemoteAddr = "127.0.0.1:5000"
		r = WithUser(r, userID)
		if token != "" {
			r.Header.Set("Authorization", "Bearer "+token)
			var err error
			r, err = a.AuthenticateAPIKey(r)
			if err != nil {
				w := httptest.NewRecorder()
				fail(w, err)
				return w
			}
		}
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, r)
		return w
	}
	created := request("POST", "/api/client/account/api-keys", `{"description":"isolation","allowed_ips":["127.0.0.1"]}`, ownerID, "")
	if created.Code != 201 {
		t.Fatalf("create key: %d %s", created.Code, created.Body.String())
	}
	var response M
	if e = json.Unmarshal(created.Body.Bytes(), &response); e != nil {
		t.Fatal(e)
	}
	token := str(asMap(response["meta"])["secret_token"])
	identifier := str(asMap(response["attributes"])["identifier"])
	if token == "" {
		t.Fatal("missing one-time API token")
	}
	defer pool.Exec(ctx, "DELETE FROM api_keys WHERE user_id IN ($1,$2)", ownerID, otherID)
	sum := sha256.Sum256([]byte(token))
	var stored string
	if e = pool.QueryRow(ctx, "SELECT token_hash FROM api_keys WHERE identifier=$1", identifier).Scan(&stored); e != nil {
		t.Fatal(e)
	}
	if stored != hex.EncodeToString(sum[:]) || stored == token {
		t.Fatal("API credential is not hashed")
	}
	if got := request("GET", "/api/client/account", "", otherID, token); got.Code != 200 || !strings.Contains(got.Body.String(), "owner"+suffix) {
		t.Fatalf("token must replace dev identity: %d %s", got.Code, got.Body.String())
	}
	if _, e = pool.Exec(ctx, "UPDATE api_keys SET expires_at=now()-interval '1 minute' WHERE identifier=$1", identifier); e != nil {
		t.Fatal(e)
	}
	if got := request("GET", "/api/client/account", "", ownerID, token); got.Code != 401 {
		t.Fatalf("expired API key accepted: %d", got.Code)
	}
	if _, e = pool.Exec(ctx, "UPDATE api_keys SET expires_at=now()+interval '1 hour' WHERE identifier=$1", identifier); e != nil {
		t.Fatal(e)
	}
	if got := request("POST", "/api/client/account/api-keys", `{"description":"expired","expires_at":"2000-01-01T00:00:00Z"}`, ownerID, ""); got.Code != 422 {
		t.Fatalf("expired key creation accepted: %d", got.Code)
	}
	if got := request("GET", "/api/application/users", "", ownerID, token); got.Code != 403 {
		t.Fatalf("client key elevated to application access: %d", got.Code)
	}
	if got := request("DELETE", "/api/client/account/api-keys/"+identifier, "", otherID, ""); got.Code != 404 {
		t.Fatalf("cross-account deletion: %d %s", got.Code, got.Body.String())
	}
	listed := request("GET", "/api/client/account/api-keys", "", ownerID, "")
	if strings.Contains(listed.Body.String(), token) || strings.Contains(listed.Body.String(), stored) {
		t.Fatal("list leaks token material")
	}
	if got := request("GET", "/api/client/account", "", ownerID, token+"x"); got.Code != 401 {
		t.Fatalf("invalid bearer fell back to admin: %d", got.Code)
	}
	r := httptest.NewRequest("GET", "/api/client/account", nil)
	r.RemoteAddr = "10.1.2.3:4000"
	r.Header.Set("Authorization", "Bearer "+token)
	r.Header.Set("X-Forwarded-For", "127.0.0.1")
	if _, e = a.AuthenticateAPIKey(r); e == nil {
		t.Fatal("spoofed forwarded peer bypassed IP allowlist")
	}
	if _, e = pool.Exec(ctx, "UPDATE users SET disabled=true WHERE id=$1", ownerID); e != nil {
		t.Fatal(e)
	}
	if got := request("GET", "/api/client/account", "", otherID, token); got.Code != 403 {
		t.Fatalf("disabled owner key accepted: %d", got.Code)
	}
	if _, e = pool.Exec(ctx, "UPDATE users SET disabled=false WHERE id=$1", ownerID); e != nil {
		t.Fatal(e)
	}
	application := request("POST", "/api/admin/api-keys", `{"description":"read users only","permissions":{"users":1}}`, ownerID, "")
	if application.Code != 201 {
		t.Fatalf("application key create: %d %s", application.Code, application.Body.String())
	}
	var appResponse M
	if e = json.Unmarshal(application.Body.Bytes(), &appResponse); e != nil {
		t.Fatal(e)
	}
	appToken := str(asMap(appResponse["meta"])["secret_token"])
	if got := request("GET", "/api/application/users", "", otherID, appToken); got.Code != 200 {
		t.Fatalf("read-scope key cannot read users: %d %s", got.Code, got.Body.String())
	}
	if got := request("PATCH", "/api/application/users/"+str(ownerID), `{"disabled":true}`, ownerID, appToken); got.Code != 403 {
		t.Fatalf("read-scope key mutated user: %d", got.Code)
	}
	if got := request("GET", "/api/client/account", "", ownerID, appToken); got.Code != 403 {
		t.Fatalf("application key crossed into client API: %d", got.Code)
	}
	if _, e = pool.Exec(ctx, "UPDATE users SET external_id='eggs' WHERE id=$1", otherID); e != nil {
		t.Fatal(e)
	}
	limited := request("POST", "/api/admin/api-keys", `{"description":"external ID regression","permissions":{"eggs":1,"allocations":1,"server_databases":1}}`, ownerID, "")
	if limited.Code != 201 {
		t.Fatalf("limited key create: %d %s", limited.Code, limited.Body.String())
	}
	var limitedResponse M
	if e = json.Unmarshal(limited.Body.Bytes(), &limitedResponse); e != nil {
		t.Fatal(e)
	}
	limitedToken := str(asMap(limitedResponse["meta"])["secret_token"])
	fullHandler := a.Handler()
	for _, path := range []string{"/api/application/users/external/eggs", "/api/application/servers/external/allocations", "/api/application/servers/external/databases"} {
		r := httptest.NewRequest("GET", path, nil)
		r.RemoteAddr = "127.0.0.1:5000"
		r.Header.Set("Authorization", "Bearer "+limitedToken)
		w := httptest.NewRecorder()
		fullHandler.ServeHTTP(w, r)
		if w.Code != 403 {
			t.Fatalf("real API key bypassed parent scope for %s: %d %s", path, w.Code, w.Body.String())
		}
	}
	if got := request("DELETE", "/api/application/users/"+str(ownerID), "", ownerID, ""); got.Code != 422 {
		t.Fatalf("self-deletion accepted: %d", got.Code)
	}
	public, _, e := ed25519.GenerateKey(rand.Reader)
	if e != nil {
		t.Fatal(e)
	}
	sshPublic, e := ssh.NewPublicKey(public)
	if e != nil {
		t.Fatal(e)
	}
	sshBody, _ := json.Marshal(M{"name": "isolation", "public_key": strings.TrimSpace(string(ssh.MarshalAuthorizedKey(sshPublic)))})
	sshCreated := request("POST", "/api/client/account/ssh-keys", string(sshBody), ownerID, "")
	if sshCreated.Code != 201 {
		t.Fatalf("SSH create: %d %s", sshCreated.Code, sshCreated.Body.String())
	}
	defer pool.Exec(ctx, "DELETE FROM ssh_keys WHERE user_id=$1", ownerID)
	fp := ssh.FingerprintSHA256(sshPublic)
	removeBody, _ := json.Marshal(M{"fingerprint": fp})
	if got := request("POST", "/api/client/account/ssh-keys/remove", string(removeBody), otherID, ""); got.Code != 204 {
		t.Fatalf("SSH foreign delete response: %d", got.Code)
	}
	if got := request("GET", "/api/client/account/ssh-keys", "", ownerID, ""); !strings.Contains(got.Body.String(), fp) {
		t.Fatal("another account deleted SSH key")
	}
	if got := request("POST", "/api/client/account/ssh-keys/remove", string(removeBody), ownerID, ""); got.Code != 204 {
		t.Fatalf("SSH own delete: %d", got.Code)
	}
	if got := request("DELETE", "/api/client/account/api-keys/"+identifier, "", ownerID, ""); got.Code != 204 {
		t.Fatalf("delete: %d %s", got.Code, got.Body.String())
	}
	if got := request("GET", "/api/client/account", "", ownerID, token); got.Code != 401 {
		t.Fatalf("revoked key accepted: %d", got.Code)
	}
	insert := func(table string, data M) M {
		t.Helper()
		row, e := a.insert(ctx, table, data)
		if e != nil {
			t.Fatalf("fixture %s: %v", table, e)
		}
		return row
	}
	location := insert("locations", M{"short": "accounts_" + suffix})
	defer pool.Exec(ctx, "DELETE FROM locations WHERE id=$1", location["id"])
	node := insert("nodes", M{"uuid": newUUID(), "name": "accounts", "location_id": location["id"], "fqdn": "localhost", "daemon_token_id": randomToken(8), "daemon_token": randomToken(24)})
	defer pool.Exec(ctx, "DELETE FROM nodes WHERE id=$1", node["id"])
	nest := insert("nests", M{"uuid": newUUID(), "name": "accounts", "author": "test@example.test"})
	defer pool.Exec(ctx, "DELETE FROM nests WHERE id=$1", nest["id"])
	egg := insert("eggs", M{"uuid": newUUID(), "name": "accounts", "author": "test@example.test", "nest_id": nest["id"]})
	defer pool.Exec(ctx, "DELETE FROM eggs WHERE id=$1", egg["id"])
	short := randomToken(4)
	server := insert("servers", M{"uuid": newUUID(), "uuid_short": short, "identifier": short, "name": "accounts", "owner_id": ownerID, "node_id": node["id"], "nest_id": nest["id"], "egg_id": egg["id"], "image": "alpine:3", "installed_at": time.Now().UTC()})
	defer pool.Exec(ctx, "DELETE FROM servers WHERE id=$1", server["id"])
	insert("subusers", M{"user_id": otherID, "server_id": server["id"], "permissions": []string{"file.read"}})
	serverPath := "/api/client/servers/" + short
	if got := request("GET", serverPath+"/files/list", "", outsiderID, ""); got.Code != 404 {
		t.Fatalf("server existence leaked to outsider: %d %s", got.Code, got.Body.String())
	}
	if got := request("GET", serverPath+"/files/list", "", otherID, ""); got.Code != 204 {
		t.Fatalf("subuser exact permission denied: %d %s", got.Code, got.Body.String())
	}
	if got := request("GET", serverPath+"/files/content", "", otherID, ""); got.Code != 403 {
		t.Fatalf("file.read escalated to contents: %d", got.Code)
	}
	if _, e = pool.Exec(ctx, "UPDATE servers SET status='suspended' WHERE id=$1", server["id"]); e != nil {
		t.Fatal(e)
	}
	if got := request("GET", serverPath+"/files/list", "", otherID, ""); got.Code != 409 {
		t.Fatalf("suspended server accepted file operations: %d", got.Code)
	}
	if got := request("GET", serverPath, "", otherID, ""); got.Code != 204 {
		t.Fatalf("suspended server detail unavailable: %d", got.Code)
	}
	if got := request("GET", serverPath+"/ws", "", ownerID, ""); got.Code != 204 {
		t.Fatalf("administrator unavailable-state socket denied: %d", got.Code)
	}
	if _, e = pool.Exec(ctx, "UPDATE servers SET status='reinstall_failed',installed_at=NULL WHERE id=$1", server["id"]); e != nil {
		t.Fatal(e)
	}
	if got := request("GET", serverPath+"/files/list", "", otherID, ""); got.Code != 204 {
		t.Fatalf("native reinstall_failed status incorrectly blocked: %d", got.Code)
	}
	if _, e = pool.Exec(ctx, "UPDATE servers SET status=NULL WHERE id=$1", server["id"]); e != nil {
		t.Fatal(e)
	}
	if _, e = pool.Exec(ctx, "DELETE FROM subusers WHERE user_id=$1 AND server_id=$2", otherID, server["id"]); e != nil {
		t.Fatal(e)
	}
	if got := request("GET", serverPath+"/files/list", "", otherID, ""); got.Code != 404 {
		t.Fatalf("revoked subuser retained access: %d", got.Code)
	}
}
