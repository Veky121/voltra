package panel

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// queryLog records the SQL a test app sends to PostgreSQL.
type queryLog struct {
	mu  sync.Mutex
	sql []string
}

func (q *queryLog) TraceQueryStart(ctx context.Context, _ *pgx.Conn, data pgx.TraceQueryStartData) context.Context {
	q.mu.Lock()
	q.sql = append(q.sql, data.SQL)
	q.mu.Unlock()
	return ctx
}
func (q *queryLog) TraceQueryEnd(context.Context, *pgx.Conn, pgx.TraceQueryEndData) {}
func (q *queryLog) reset()                                                          { q.mu.Lock(); q.sql = nil; q.mu.Unlock() }
func (q *queryLog) taken() []string {
	q.mu.Lock()
	defer q.mu.Unlock()
	return append([]string{}, q.sql...)
}

func tracedTestApp(t *testing.T) (*App, *queryLog, context.Context) {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL is required for isolated PostgreSQL integration")
	}
	ctx := context.Background()
	base, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	name := "lists_" + randomToken(6)
	if _, err = base.Exec(ctx, "CREATE SCHEMA "+name); err != nil {
		base.Close()
		t.Fatal(err)
	}
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		t.Fatal(err)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = name
	log := &queryLog{}
	cfg.ConnConfig.Tracer = log
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { pool.Close(); base.Exec(ctx, "DROP SCHEMA "+name+" CASCADE"); base.Close() })
	if _, err = pool.Exec(ctx, schema); err != nil {
		t.Fatal(err)
	}
	return &App{DB: pool, HTTP: &http.Client{Timeout: 5 * time.Second}, Config: Config{EncryptionKey: "admin-lists-tests-only-key", PublicURL: "http://127.0.0.1:8088"}}, log, ctx
}

type adminListFixture struct {
	admin, other    M
	nodes           []M
	servers         []M
	eggs, locations []M
}

func seedAdminLists(t *testing.T, a *App, ctx context.Context) adminListFixture {
	t.Helper()
	must := func(m M, err error) M {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
		return m
	}
	f := adminListFixture{}
	f.admin = must(a.insert(ctx, "users", M{"uuid": newUUID(), "username": "admin", "nickname": "Root Admin", "email": "admin@example.test", "root_admin": true}))
	f.other = must(a.insert(ctx, "users", M{"uuid": newUUID(), "username": "player", "email": "player@example.test"}))
	sealed, err := a.seal("token")
	if err != nil {
		t.Fatal(err)
	}
	for i, short := range []string{"eu", "us"} {
		f.locations = append(f.locations, must(a.insert(ctx, "locations", M{"short": short, "long": fmt.Sprint("Location ", i)})))
	}
	for i, name := range []string{"Alpha Node", "Beta Node", "Gamma"} {
		f.nodes = append(f.nodes, must(a.insert(ctx, "nodes", M{"uuid": newUUID(), "name": name, "location_id": f.locations[i%2]["id"], "fqdn": fmt.Sprintf("node%d.example.test", i), "daemon_token_id": fmt.Sprint("token", i), "daemon_token": sealed})))
	}
	nest := must(a.insert(ctx, "nests", M{"uuid": newUUID(), "author": "test@example.test", "name": "Games"}))
	for i := 0; i < 2; i++ {
		egg := must(a.insert(ctx, "eggs", M{"uuid": newUUID(), "nest_id": nest["id"], "author": "test@example.test", "name": fmt.Sprint("Egg ", i)}))
		f.eggs = append(f.eggs, egg)
		for j, env := range []string{"MAX_PLAYERS", "TIMED_URL"} {
			must(a.insert(ctx, "egg_variables", M{"egg_id": egg["id"], "name": env, "env_variable": env, "default_value": fmt.Sprint("default-", j)}))
		}
	}
	variables, err := a.query(ctx, "SELECT * FROM egg_variables ORDER BY id")
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 25; i++ {
		uuid := newUUID()
		owner := f.admin
		if i%3 == 0 {
			owner = f.other
		}
		egg := f.eggs[i%2]
		server := must(a.insert(ctx, "servers", M{"uuid": uuid, "uuid_short": uuid[:8], "identifier": uuid[:8], "name": fmt.Sprintf("Server %02d", i), "owner_id": owner["id"], "node_id": f.nodes[i%3]["id"], "nest_id": nest["id"], "egg_id": egg["id"], "image": "alpine:latest", "memory": 1024 * (i + 1), "disk": 2048, "installed_at": time.Now()}))
		f.servers = append(f.servers, server)
		for _, variable := range variables {
			if num(variable["egg_id"]) == num(egg["id"]) && str(variable["env_variable"]) == "MAX_PLAYERS" && i%2 == 0 {
				must(a.insert(ctx, "server_variables", M{"server_id": server["id"], "variable_id": variable["id"], "variable_value": fmt.Sprint(i)}))
			}
			if num(variable["egg_id"]) == num(egg["id"]) && str(variable["env_variable"]) == "TIMED_URL" && i == 4 {
				must(a.insert(ctx, "server_variables", M{"server_id": server["id"], "variable_id": variable["id"], "variable_value": "https://secret.example.test/download"}))
			}
		}
		must(a.insert(ctx, "allocations", M{"node_id": f.nodes[i%3]["id"], "server_id": server["id"], "ip": "127.0.0.1", "port": 25000 + i}))
	}
	must(a.insert(ctx, "allocations", M{"node_id": f.nodes[0]["id"], "ip": "127.0.0.1", "port": 26000}))
	return f
}

func adminListRequest(t *testing.T, a *App, userID int64, path string) M {
	t.Helper()
	mux := http.NewServeMux()
	a.registerLifecycle(mux)
	a.registerInfrastructure(mux)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, WithUser(httptest.NewRequest("GET", path, nil), userID))
	if w.Code != 200 {
		t.Fatalf("%s: %d %s", path, w.Code, w.Body.String())
	}
	var out M
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	return out
}

func listPagination(out M) M { return asMap(asMap(out["meta"])["pagination"]) }
func listAttributes(out M) []M {
	result := []M{}
	for _, row := range asSlice(out["data"]) {
		result = append(result, asMap(asMap(row)["attributes"]))
	}
	return result
}

func TestApplicationServerListPagesAndFiltersInSQLPostgres(t *testing.T) {
	a, log, ctx := tracedTestApp(t)
	f := seedAdminLists(t, a, ctx)
	admin := num(f.admin["id"])

	page := adminListRequest(t, a, admin, "/api/application/servers?per_page=10&page=2")
	if p := listPagination(page); num(p["total"]) != 25 || num(p["count"]) != 10 || num(p["per_page"]) != 10 || num(p["current_page"]) != 2 || num(p["total_pages"]) != 3 {
		t.Fatalf("pagination %v", p)
	}
	rows := listAttributes(page)
	for i, row := range rows {
		want := f.servers[10+i]
		if num(row["id"]) != num(want["id"]) {
			t.Fatalf("row %d is server %v, want %v", i, row["id"], want["id"])
		}
		// The batched presentation matches the single-server one.
		single, err := a.applicationServer(ctx, want)
		if err != nil {
			t.Fatal(err)
		}
		encodedSingle, _ := json.Marshal(single)
		var expected M
		_ = json.Unmarshal(encodedSingle, &expected)
		if !reflect.DeepEqual(row, expected) {
			t.Fatalf("server %v differs:\n list %v\n single %v", want["id"], row, expected)
		}
	}
	// Overview and desktop callers read everything with per_page=100.
	all := adminListRequest(t, a, admin, "/api/application/servers?per_page=100")
	if p := listPagination(all); num(p["total"]) != 25 || num(p["count"]) != 25 || num(p["per_page"]) != 100 || num(p["total_pages"]) != 1 {
		t.Fatalf("per_page=100 %v", p)
	}
	if p := listPagination(adminListRequest(t, a, admin, "/api/application/servers?per_page=500")); num(p["per_page"]) != 100 {
		t.Fatal("per_page above the limit must clamp")
	}
	if p := listPagination(adminListRequest(t, a, admin, "/api/application/servers?page=9")); num(p["count"]) != 0 || num(p["total"]) != 25 {
		t.Fatal("a page past the end must be empty but keep the total")
	}
	// The secret acquisition URL never leaves the panel.
	for _, row := range listAttributes(all) {
		if env := asMap(asMap(row["container"])["environment"]); str(env["TIMED_URL"]) == "https://secret.example.test/download" {
			t.Fatal("TIMED_URL disclosed")
		}
	}

	for query, want := range map[string]int{
		"filter[name]=server%200":                                        10,
		"filter[name]=SERVER%2012":                                       1,
		"filter[node_id]=" + str(f.nodes[1]["id"]):                       8,
		"filter[owner_id]=" + str(f.other["id"]):                         9,
		"filter[uuid]=" + str(f.servers[3]["uuid"]):                      1,
		"filter[id]=" + str(f.servers[7]["id"]):                          1,
		"filter[external_id]=":                                           25,
		"filter[external_id]=missing":                                    0,
		"filter[name]=server&filter[node_id]=" + str(f.nodes[0]["id"]):   9,
		"filter[unknown]=x":                                              25,
		"filter[search]=SERVER%2012":                                     1,
		"filter[search]=" + str(f.servers[4]["identifier"]):              1,
		"filter[search]=" + str(f.servers[5]["uuid"])[:8]:                1,
		"filter[search]=nothing-like-this":                               0,
		"filter[search]=server&filter[node_id]=" + str(f.nodes[0]["id"]): 9,
	} {
		if got := num(listPagination(adminListRequest(t, a, admin, "/api/application/servers?"+query))["total"]); got != int64(want) {
			t.Errorf("%s: %d servers, want %d", query, got, want)
		}
	}

	include := "&include=user,node,location,allocations,variables,egg,nest,subusers,databases,transfer"
	withIncludes := adminListRequest(t, a, admin, "/api/application/servers?per_page=6"+include)
	for i, row := range listAttributes(withIncludes) {
		server := f.servers[i]
		relationships := asMap(row["relationships"])
		user := asMap(asMap(relationships["user"])["attributes"])
		if num(user["id"]) != num(server["owner_id"]) || user["email"] != nil {
			t.Fatalf("user %v", user)
		}
		if i%3 != 0 && user["nickname"] != "Root Admin" {
			t.Fatalf("owner nickname %v", user["nickname"])
		}
		node := asMap(asMap(relationships["node"])["attributes"])
		if node["name"] != f.nodes[i%3]["name"] || node["daemon_token"] != nil {
			t.Fatalf("node %v", node)
		}
		if location := asMap(asMap(relationships["location"])["attributes"]); location["short"] != f.locations[i%3%2]["short"] {
			t.Fatalf("location %v", location)
		}
		if allocations := asSlice(asMap(relationships["allocations"])["data"]); len(allocations) != 1 {
			t.Fatalf("allocations %v", allocations)
		}
		if variables := asSlice(asMap(relationships["variables"])["data"]); len(variables) != map[bool]int{true: 1, false: 0}[i%2 == 0]+map[bool]int{true: 1, false: 0}[i == 4] {
			t.Fatalf("server %d variables %v", i, variables)
		}
		if egg := asMap(asMap(relationships["egg"])["attributes"]); num(egg["id"]) != num(server["egg_id"]) {
			t.Fatalf("egg %v", egg)
		}
		if transfer := asMap(relationships["transfer"]); transfer["object"] != "null" {
			t.Fatalf("transfer %v", transfer)
		}
		if subusers := asMap(relationships["subusers"]); subusers["object"] != "list" {
			t.Fatalf("subusers %v", subusers)
		}
	}
	// The single read uses the same relationships.
	single := adminListRequest(t, a, admin, "/api/application/servers/"+str(f.servers[0]["id"])+"?include=user,node")
	if name := asMap(asMap(asMap(asMap(single["attributes"])["relationships"])["node"])["attributes"])["name"]; name != f.nodes[0]["name"] {
		t.Fatalf("single include %v", single)
	}

	// The number of queries does not grow with the page size.
	count := func(path string) int {
		log.reset()
		adminListRequest(t, a, admin, path)
		return len(log.taken())
	}
	small, large := count("/api/application/servers?per_page=3"+include), count("/api/application/servers?per_page=24"+include)
	if small != large {
		t.Fatalf("queries grow with the page: %d for 3 servers, %d for 24", small, large)
	}
	if plain := count("/api/application/servers?per_page=100"); plain > 6 {
		t.Fatalf("%d queries for the fleet summary list", plain)
	}

	// Regular users cannot list servers.
	mux := http.NewServeMux()
	a.registerLifecycle(mux)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, WithUser(httptest.NewRequest("GET", "/api/application/servers", nil), num(f.other["id"])))
	if w.Code != 403 {
		t.Fatalf("non-admin list %d", w.Code)
	}
}

func TestAdminNodeListPagesAndFiltersInSQLPostgres(t *testing.T) {
	a, log, ctx := tracedTestApp(t)
	f := seedAdminLists(t, a, ctx)
	admin := num(f.admin["id"])
	for _, base := range []string{"/api/application/nodes", "/api/admin/nodes"} {
		out := adminListRequest(t, a, admin, base+"?per_page=100")
		if p := listPagination(out); num(p["total"]) != 3 || num(p["count"]) != 3 || num(p["per_page"]) != 100 {
			t.Fatalf("%s pagination %v", base, p)
		}
		for i, node := range listAttributes(out) {
			if node["daemon_token"] != nil || node["daemon_token_id"] != nil {
				t.Fatal("node credentials listed")
			}
			// Each node runs servers i, i+3, ...; memory is 1024*(n+1).
			servers, memory := int64(0), int64(0)
			for n := i; n < 25; n += 3 {
				servers++
				memory += int64(1024 * (n + 1))
			}
			if num(node["servers_count"]) != servers || num(asMap(node["allocated_resources"])["memory"]) != memory || num(asMap(node["allocated_resources"])["disk"]) != servers*2048 {
				t.Fatalf("node %d sums %v %v", i, node["servers_count"], node["allocated_resources"])
			}
			// Same values as the single-node presentation.
			single, err := a.infraPresent(httptest.NewRequest("GET", "/", nil), "nodes", f.nodes[i])
			if err != nil {
				t.Fatal(err)
			}
			if num(single["servers_count"]) != num(node["servers_count"]) {
				t.Fatal("single and list node counts differ")
			}
		}
	}
	empty, err := a.insert(ctx, "nodes", M{"uuid": newUUID(), "name": "Empty", "location_id": f.locations[0]["id"], "fqdn": "empty.example.test", "daemon_token_id": "token-empty", "daemon_token": "x"})
	if err != nil {
		t.Fatal(err)
	}
	for query, want := range map[string]int{
		"filter[name]=node":                  2,
		"filter[name]=":                      4,
		"filter[fqdn]=NODE1":                 1,
		"filter[id]=" + str(empty["id"]):     1,
		"filter[uuid]=" + str(empty["uuid"]): 1,
		"filter[short]=eu":                   0,
		"filter[short]=":                     4,
		"filter[server_id]=0":                4,
		"filter[server_id]=5":                0,
		"filter[port]=":                      0,
		"per_page=2&page=2":                  4,
	} {
		out := adminListRequest(t, a, admin, "/api/application/nodes?"+query)
		if got := num(listPagination(out)["total"]); got != int64(want) {
			t.Errorf("%s: %d nodes, want %d", query, got, want)
		}
	}
	paged := adminListRequest(t, a, admin, "/api/application/nodes?per_page=2&page=2")
	if rows := listAttributes(paged); len(rows) != 2 || num(rows[0]["id"]) != num(f.nodes[2]["id"]) || num(rows[1]["servers_count"]) != 0 {
		t.Fatalf("second page %v", rows)
	}
	withIncludes := adminListRequest(t, a, admin, "/api/application/nodes?include=location,allocations,servers")
	first := asMap(listAttributes(withIncludes)[0]["relationships"])
	if asMap(asMap(first["location"])["attributes"])["short"] != "eu" || len(asSlice(asMap(first["allocations"])["data"])) != 10 || len(asSlice(asMap(first["servers"])["data"])) != 9 {
		t.Fatalf("node includes %v", first)
	}
	count := func(path string) int {
		log.reset()
		adminListRequest(t, a, admin, path)
		return len(log.taken())
	}
	if small, large := count("/api/application/nodes?per_page=1&include=location,allocations,servers"), count("/api/application/nodes?per_page=4&include=location,allocations,servers"); small != large {
		t.Fatalf("node queries grow with the page: %d and %d", small, large)
	}
	locations := adminListRequest(t, a, admin, "/api/application/locations?filter[short]=S")
	if rows := listAttributes(locations); len(rows) != 1 || rows[0]["short"] != "us" || num(rows[0]["nodes_count"]) != 1 {
		t.Fatalf("locations %v", rows)
	}
}

func TestHandlerCompressesAdminListsPostgres(t *testing.T) {
	a, _, ctx := tracedTestApp(t)
	f := seedAdminLists(t, a, ctx)
	session := randomToken(32)
	if err := a.exec(ctx, "INSERT INTO browser_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')", pairingHash(session), f.admin["id"]); err != nil {
		t.Fatal(err)
	}
	if err := a.exec(ctx, `INSERT INTO settings(key,value) VALUES('panel:setup','{"completed":true,"public_url":"http://127.0.0.1:8088","access_mode":"local","tls_mode":"proxy"}')`); err != nil {
		t.Fatal(err)
	}
	handler := a.Handler()
	r := httptest.NewRequest("GET", "http://127.0.0.1:8088/api/application/servers?per_page=100", nil)
	r.RemoteAddr = "127.0.0.1:5000"
	r.AddCookie(&http.Cookie{Name: sessionCookie, Value: session})
	r.Header.Set("Accept-Encoding", "gzip, br")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	if w.Code != 200 || w.Header().Get("Content-Encoding") != "gzip" || w.Header().Get("Vary") != "Accept-Encoding" {
		t.Fatalf("%d %v", w.Code, w.Header())
	}
	zr, err := gzip.NewReader(bytes.NewReader(w.Body.Bytes()))
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(zr)
	var out M
	if err = json.Unmarshal(body, &out); err != nil || len(asSlice(out["data"])) != 25 {
		t.Fatalf("decoded list: %v", err)
	}
}

func TestHandlerSkipsAuthenticationOutsideAPIPostgres(t *testing.T) {
	a, log, ctx := tracedTestApp(t)
	f := seedAdminLists(t, a, ctx)
	a.Config.DevMode = true
	a.Config.WebDir = t.TempDir()
	if err := os.MkdirAll(filepath.Join(a.Config.WebDir, "assets"), 0755); err != nil {
		t.Fatal(err)
	}
	_ = os.WriteFile(filepath.Join(a.Config.WebDir, "index.html"), []byte("<!doctype html>"), 0644)
	_ = os.WriteFile(filepath.Join(a.Config.WebDir, "assets", "Client-Ab12cd34.js"), []byte("export{}"), 0644)
	if err := a.exec(ctx, `INSERT INTO settings(key,value) VALUES('panel:setup','{"completed":true,"public_url":"http://127.0.0.1:8088","access_mode":"local","tls_mode":"proxy"}')`); err != nil {
		t.Fatal(err)
	}
	handler := a.Handler()
	request := func(path string, headers ...string) *httptest.ResponseRecorder {
		r := httptest.NewRequest("GET", "http://127.0.0.1:8088"+path, nil)
		r.RemoteAddr = "127.0.0.1:5000"
		for i := 0; i+1 < len(headers); i += 2 {
			r.Header.Set(headers[i], headers[i+1])
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	badSession := "voltra_session=" + strings.Repeat("a", 64)
	for _, path := range []string{"/", "/admin/servers", "/assets/Client-Ab12cd34.js"} {
		log.reset()
		if w := request(path, "Authorization", "Bearer invalid", "Cookie", badSession); w.Code != 200 {
			t.Fatalf("%s: %d %s", path, w.Code, w.Body.String())
		}
		for _, sql := range log.taken() {
			if strings.Contains(sql, "browser_sessions") || strings.Contains(sql, "api_keys") || strings.Contains(sql, "users") {
				t.Fatalf("%s looked up an identity: %s", path, sql)
			}
		}
	}
	// API routes still authenticate after setup, even in development mode
	// and from loopback.
	for _, headers := range [][]string{{}, {"Authorization", "Bearer invalid"}, {"Cookie", badSession}} {
		if w := request("/api/client/account", headers...); w.Code != 401 {
			t.Fatalf("API without a valid identity: %d", w.Code)
		}
	}
	if w := request("/api/application/servers"); w.Code != 401 {
		t.Fatalf("admin list without identity: %d", w.Code)
	}
	// Local access mode still refuses foreign hosts for static files.
	r := httptest.NewRequest("GET", "http://panel.example.test/", nil)
	r.RemoteAddr = "127.0.0.1:5000"
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	if w.Code != 403 {
		t.Fatalf("foreign host in local mode: %d", w.Code)
	}
	_ = f
}

func TestSettingsCacheFollowsNotificationsPostgres(t *testing.T) {
	a, log, ctx := tracedTestApp(t)
	a.startLiveChanges()
	defer a.stopLiveChanges()
	deadline := time.Now().Add(5 * time.Second)
	for {
		a.settings.mu.Lock()
		listening := a.settings.listening
		a.settings.mu.Unlock()
		if listening {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("listener did not start")
		}
		time.Sleep(20 * time.Millisecond)
	}
	if s, err := a.setupState(ctx); err != nil || s.Completed {
		t.Fatalf("initial setup %v %v", s, err)
	}
	log.reset()
	for i := 0; i < 5; i++ {
		if _, err := a.setupState(ctx); err != nil {
			t.Fatal(err)
		}
		if _, err := a.maintenanceEnabled(ctx); err != nil {
			t.Fatal(err)
		}
	}
	if reads := len(log.taken()); reads > 1 {
		t.Fatalf("%d database reads while cached", reads)
	}
	// Another process (here: a plain SQL write) changes both settings.
	if err := a.exec(ctx, `INSERT INTO settings(key,value) VALUES('panel:setup','{"completed":true}'),('app.maintenance','true')`); err != nil {
		t.Fatal(err)
	}
	waitFor := func(what string, check func() bool) {
		t.Helper()
		deadline := time.Now().Add(4 * time.Second)
		for !check() {
			if time.Now().After(deadline) {
				t.Fatalf("%s was not picked up from the notification", what)
			}
			time.Sleep(10 * time.Millisecond)
		}
	}
	waitFor("setup", func() bool { s, _ := a.setupState(ctx); return s.Completed })
	waitFor("maintenance", func() bool { m, _ := a.maintenanceEnabled(ctx); return m })
	// This process's own writes are visible at once, without waiting.
	if err := a.exec(ctx, `UPDATE settings SET value='false' WHERE key='app.maintenance'`); err != nil {
		t.Fatal(err)
	}
	a.settingsChanged()
	if m, _ := a.maintenanceEnabled(ctx); m {
		t.Fatal("own write not visible")
	}
	// Without a listener every read goes to the database.
	a.stopLiveChanges()
	a.readChanges.cancel = nil
	log.reset()
	_, _ = a.setupState(ctx)
	_, _ = a.setupState(ctx)
	if reads := len(log.taken()); reads != 2 {
		t.Fatalf("%d reads without a listener", reads)
	}
}
