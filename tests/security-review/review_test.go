package securityreview

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"voltra/internal/panel"
)

// The wire contract is taken from native Wings router/router_server.go:
// Action server.PowerAction `json:"action"`. A mock accepting signal would hide
// an invalid daemon request even though the panel-side client API uses signal.
func TestCLIBulkPowerUsesNativeWingsAction(t *testing.T) {
	a, _ := reviewApp(t)
	var validCalls atomic.Int64
	daemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload struct {
			Action string `json:"action"`
		}
		if !strings.HasSuffix(r.URL.Path, "/power") || json.NewDecoder(r.Body).Decode(&payload) != nil || payload.Action != "restart" {
			http.Error(w, `{"error":"invalid native power action"}`, 422)
			return
		}
		validCalls.Add(1)
		w.WriteHeader(202)
	}))
	defer daemon.Close()
	address, _ := url.Parse(daemon.URL)
	port, _ := strconv.Atoi(address.Port())
	sqlExec(t, a.DB, "INSERT INTO locations(short) VALUES('review')")
	body := fmt.Sprintf(`{"name":"Review","location_id":1,"fqdn":"127.0.0.1","scheme":"http","memory_overallocate":0,"disk_overallocate":0,"daemon_sftp":2022,"memory":4096,"disk":20480,"daemon_listen":%d}`, port)
	if result := requestBody(a, "POST", "/api/admin/nodes", "", body); result.Code != 201 {
		t.Fatalf("create node status %d", result.Code)
	}
	sqlExec(t, a.DB, "INSERT INTO nests(uuid,author,name) VALUES($1,'review','review')", uuid.NewString())
	sqlExec(t, a.DB, "INSERT INTO eggs(uuid,nest_id,author,name) VALUES($1,1,'review','review')", uuid.NewString())
	sqlExec(t, a.DB, `INSERT INTO servers(uuid,uuid_short,identifier,name,owner_id,node_id,nest_id,egg_id,image,installed_at) VALUES($1,'review01','review01','review',1,1,1,1,'alpine',now())`, uuid.NewString())
	var output bytes.Buffer
	if err := a.RunCommand(context.Background(), []string{"p:server:bulk-power", "restart", "--servers=1", "--force"}, &output); err != nil {
		t.Fatal("bulk power failed native Wings wire contract:", err)
	}
	if validCalls.Load() != 1 {
		t.Errorf("native daemon accepted %d power calls, expected one", validCalls.Load())
	}
}

func revocationFixture(t *testing.T, handler http.HandlerFunc) (*panel.App, string, string, string) {
	t.Helper()
	a, _ := reviewApp(t)
	oldUUID, newUUID, serverUUID := uuid.NewString(), uuid.NewString(), uuid.NewString()
	daemon := httptest.NewServer(handler)
	t.Cleanup(daemon.Close)
	address, _ := url.Parse(daemon.URL)
	port, _ := strconv.Atoi(address.Port())
	sqlExec(t, a.DB, "INSERT INTO locations(short) VALUES('review')")
	body := fmt.Sprintf(`{"name":"Review","location_id":1,"fqdn":"127.0.0.1","scheme":"http","memory_overallocate":0,"disk_overallocate":0,"daemon_sftp":2022,"memory":4096,"disk":20480,"daemon_listen":%d}`, port)
	if result := requestBody(a, "POST", "/api/admin/nodes", "", body); result.Code != 201 {
		t.Fatalf("create node status %d", result.Code)
	}
	sqlExec(t, a.DB, "INSERT INTO nests(uuid,author,name) VALUES($1,'review','review')", uuid.NewString())
	sqlExec(t, a.DB, "INSERT INTO eggs(uuid,nest_id,author,name) VALUES($1,1,'review','review')", uuid.NewString())
	sqlExec(t, a.DB, "INSERT INTO users(uuid,username,email) VALUES($1,'oldowner','old@example.invalid'),($2,'newowner','new@example.invalid')", oldUUID, newUUID)
	sqlExec(t, a.DB, `INSERT INTO servers(uuid,uuid_short,identifier,name,owner_id,node_id,nest_id,egg_id,image,installed_at) VALUES($1,'review01','review01','review',2,1,1,1,'alpine',now())`, serverUUID)
	return a, oldUUID, newUUID, serverUUID
}

func runReviewRevocations(t *testing.T, a *panel.App) context.CancelFunc {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	// Model a fresh worker with durable dependencies, without copying process
	// caches or their synchronization primitives from the serving application.
	resumed := &panel.App{DB: a.DB, Config: a.Config, HTTP: a.HTTP}
	go func() { defer close(done); resumed.RunRevocations(ctx) }()
	t.Cleanup(func() {
		cancel()
		select {
		case <-done:
		case <-time.After(10 * time.Second):
			t.Error("revocation worker failed to stop")
		}
	})
	return cancel
}

func waitReview(t *testing.T, condition func() bool, detail string) {
	t.Helper()
	until := time.Now().Add(5 * time.Second)
	for time.Now().Before(until) {
		if condition() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal(detail)
}

func TestOfflineOwnerReassignmentPersistsAndRetriesRevocation(t *testing.T) {
	var offline atomic.Bool
	offline.Store(true)
	var calls atomic.Int64
	var oldUUID, serverUUID string
	handler := func(w http.ResponseWriter, r *http.Request) {
		if offline.Load() {
			w.WriteHeader(503)
			return
		}
		if r.URL.Path == "/api/deauthorize-user" {
			var payload struct {
				User    string   `json:"user"`
				Servers []string `json:"servers"`
			}
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil || payload.User != oldUUID || len(payload.Servers) != 1 || payload.Servers[0] != serverUUID {
				t.Error("revocation escaped exact previous-user/server target")
				w.WriteHeader(422)
				return
			}
			calls.Add(1)
		}
		w.WriteHeader(204)
	}
	a, old, _, server := revocationFixture(t, handler)
	oldUUID, serverUUID = old, server
	result := requestBody(a, "PATCH", "/api/application/servers/1/details", "", `{"user":3}`)
	if result.Code != 200 {
		t.Fatalf("offline owner reassignment status %d, expected successful native queued behavior", result.Code)
	}
	var owner, pending int64
	if err := a.DB.QueryRow(context.Background(), "SELECT owner_id FROM servers WHERE id=1").Scan(&owner); err != nil {
		t.Fatal(err)
	}
	if owner != 3 {
		t.Fatalf("offline reassignment did not persist new owner: %d", owner)
	}
	r := httptest.NewRequest("GET", "/api/client/servers/review01/resources", nil)
	r.Host = "localhost:8088"
	r.RemoteAddr = "127.0.0.1:55555"
	r.Header.Set("X-Dev-User-ID", "2")
	denied := httptest.NewRecorder()
	a.Handler().ServeHTTP(denied, r)
	if denied.Code != 404 {
		t.Errorf("old owner still has panel access: %d", denied.Code)
	}
	if err := a.DB.QueryRow(context.Background(), "SELECT count(*) FROM daemon_revocations WHERE completed_at IS NULL AND user_uuid=$1 AND server_uuid=$2", oldUUID, serverUUID).Scan(&pending); err != nil {
		t.Fatal(err)
	}
	if pending != 1 {
		t.Fatalf("offline mutation lost durable revocation: %d", pending)
	}
	cancel := runReviewRevocations(t, a)
	waitReview(t, func() bool {
		var attempts int64
		var durable bool
		err := a.DB.QueryRow(context.Background(), "SELECT attempts,completed_at IS NULL AND next_attempt_at>now() AND last_error IS NOT NULL FROM daemon_revocations WHERE user_uuid=$1", oldUUID).Scan(&attempts, &durable)
		return err == nil && attempts >= 1 && durable
	}, "failed network attempt was not retained durably with retry")
	cancel()
	offline.Store(false)
	sqlExec(t, a.DB, "UPDATE daemon_revocations SET next_attempt_at=now(),lease_until=NULL WHERE completed_at IS NULL")
	runReviewRevocations(t, a)
	waitReview(t, func() bool {
		var completed bool
		err := a.DB.QueryRow(context.Background(), "SELECT completed_at IS NOT NULL FROM daemon_revocations WHERE user_uuid=$1", oldUUID).Scan(&completed)
		return err == nil && completed
	}, "recovered worker did not invalidate old owner daemon sessions")
	if calls.Load() != 1 {
		t.Errorf("expected exactly one recovered old-owner invalidation, got %d", calls.Load())
	}
}

func TestRevocationEnqueueFailureRollsBackOwnerMutation(t *testing.T) {
	a, _, _, _ := revocationFixture(t, func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(204) })
	sqlExec(t, a.DB, `CREATE FUNCTION reject_review_revocation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'controlled enqueue rejection'; END $$`)
	sqlExec(t, a.DB, `CREATE TRIGGER reject_review_revocation BEFORE INSERT OR UPDATE ON daemon_revocations FOR EACH ROW EXECUTE FUNCTION reject_review_revocation()`)
	result := requestBody(a, "PATCH", "/api/application/servers/1/details", "", `{"user":3,"name":"must rollback"}`)
	if result.Code < 400 {
		t.Errorf("failed durable enqueue accepted owner mutation status %d", result.Code)
	}
	var owner int64
	var name string
	if err := a.DB.QueryRow(context.Background(), "SELECT owner_id,name FROM servers WHERE id=1").Scan(&owner, &name); err != nil {
		t.Fatal(err)
	}
	if owner != 2 || name != "review" {
		t.Errorf("enqueue failure partially mutated server owner=%d name=%q", owner, name)
	}
}

func TestInFlightRevocationCannotEraseNewGeneration(t *testing.T) {
	entered := make(chan struct{}, 4)
	release := make(chan struct{}, 2)
	var blocking atomic.Bool
	var oldUUID, serverUUID string
	a, old, _, server := revocationFixture(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/deauthorize-user" {
			var payload struct {
				User    string   `json:"user"`
				Servers []string `json:"servers"`
			}
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil || payload.User != oldUUID || len(payload.Servers) != 1 || payload.Servers[0] != serverUUID {
				t.Error("worker targeted a different user/server")
				w.WriteHeader(422)
				return
			}
			if blocking.Load() {
				entered <- struct{}{}
				<-release
			}
		}
		w.WriteHeader(204)
	})
	oldUUID, serverUUID = old, server
	sqlExec(t, a.DB, "UPDATE servers SET owner_id=1 WHERE id=1")
	sqlExec(t, a.DB, `INSERT INTO subusers(user_id,server_id,permissions) VALUES(2,1,'["websocket.connect","control.start"]')`)
	path := "/api/client/servers/review01/users/" + oldUUID
	if result := requestBody(a, "POST", path, "", `{"permissions":["websocket.connect"]}`); result.Code != 200 {
		t.Fatalf("initial permission update status %d", result.Code)
	}
	blocking.Store(true)
	runReviewRevocations(t, a)
	t.Cleanup(func() { close(release) })
	select {
	case <-entered:
	case <-time.After(5 * time.Second):
		t.Fatal("first worker request never reached daemon")
	}
	updated := make(chan int, 1)
	go func() {
		updated <- requestBody(a, "POST", path, "", `{"permissions":["websocket.connect","control.stop"]}`).Code
	}()
	select {
	case status := <-updated:
		if status != 200 {
			t.Fatalf("in-flight permission update status %d", status)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("network call held a queue lock and blocked permission mutation")
	}
	var generation int64
	var pending bool
	if err := a.DB.QueryRow(context.Background(), "SELECT generation,completed_at IS NULL FROM daemon_revocations WHERE user_uuid=$1", oldUUID).Scan(&generation, &pending); err != nil {
		t.Fatal(err)
	}
	if generation < 2 || !pending {
		t.Fatalf("new generation missing during old lease: generation=%d pending=%v", generation, pending)
	}
	release <- struct{}{}
	select {
	case <-entered:
	case <-time.After(5 * time.Second):
		t.Fatal("old worker completion erased newer generation instead of retrying")
	}
	if err := a.DB.QueryRow(context.Background(), "SELECT completed_at IS NULL FROM daemon_revocations WHERE user_uuid=$1", oldUUID).Scan(&pending); err != nil {
		t.Fatal(err)
	}
	if !pending {
		t.Fatal("queue completed before latest generation daemon request succeeded")
	}
	release <- struct{}{}
	waitReview(t, func() bool {
		var complete bool
		err := a.DB.QueryRow(context.Background(), "SELECT completed_at IS NOT NULL FROM daemon_revocations WHERE user_uuid=$1", oldUUID).Scan(&complete)
		return err == nil && complete
	}, "latest generation did not complete")
	var retained bool
	if err := a.DB.QueryRow(context.Background(), `SELECT permissions @> '["websocket.connect","control.stop"]'::jsonb AND jsonb_array_length(permissions)=2 FROM subusers WHERE user_id=2 AND server_id=1`).Scan(&retained); err != nil {
		t.Fatal(err)
	}
	if !retained {
		t.Error("revocation modified current permissions")
	}
}

// These are independent HTTP regressions. Each run owns a private PostgreSQL
// schema and a private HTTP daemon; no running application fixtures are touched.
func reviewApp(t *testing.T) (*panel.App, *pgxpool.Pool) {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL is required")
	}
	ctx := context.Background()
	admin, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal("connect test database:", err)
	}
	t.Cleanup(admin.Close)
	schema := "security_review_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, err = admin.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, err := admin.Exec(ctx, "DROP SCHEMA "+schema+" CASCADE")
		if err != nil {
			t.Error(err)
		}
	})
	parsed, err := url.Parse(dsn)
	if err != nil {
		t.Fatal("parse test database URL")
	}
	q := parsed.Query()
	q.Set("search_path", schema)
	q.Set("application_name", schema)
	parsed.RawQuery = q.Encode()
	a, err := panel.New(ctx, panel.Config{DatabaseURL: parsed.String(), DevMode: true, PublicURL: "http://localhost:8088", DevUserID: 1, EncryptionKey: "independent-security-review-fixtures"})
	if err != nil {
		t.Fatal("initialize isolated panel:", err)
	}
	t.Cleanup(a.Close)
	if err = a.SeedDevelopment(ctx); err != nil {
		t.Fatal(err)
	}
	return a, admin
}

func sqlExec(t *testing.T, pool *pgxpool.Pool, query string, args ...any) {
	t.Helper()
	if _, err := pool.Exec(context.Background(), query, args...); err != nil {
		t.Fatal(err)
	}
}

func request(a *panel.App, method, path, bearer string) *httptest.ResponseRecorder {
	return requestBody(a, method, path, bearer, "{}")
}
func requestBody(a *panel.App, method, path, bearer, body string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, path, strings.NewReader(body))
	r.RemoteAddr = "127.0.0.1:55555"
	r.Host = "localhost:8088"
	if bearer != "" {
		r.Header.Set("Authorization", "Bearer "+bearer)
	}
	w := httptest.NewRecorder()
	a.Handler().ServeHTTP(w, r)
	return w
}

func TestExternalIDCannotChangeApplicationScope(t *testing.T) {
	a, _ := reviewApp(t)
	sqlExec(t, a.DB, "UPDATE users SET external_id='eggs' WHERE id=1")
	// Creation uses the normal browser route; the key deliberately has no users grant.
	w := httptest.NewRecorder()
	r := httptest.NewRequest("POST", "/api/admin/api-keys", strings.NewReader(`{"description":"security review","permissions":{"eggs":1}}`))
	r.RemoteAddr = "127.0.0.1:55555"
	r.Host = "localhost:8088"
	a.Handler().ServeHTTP(w, r)
	if w.Code != 201 {
		t.Fatalf("create key status %d", w.Code)
	}
	// Decode only the secret, never print the response or token on failure.
	var data struct {
		Meta struct {
			Secret string `json:"secret_token"`
		} `json:"meta"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &data); err != nil || data.Meta.Secret == "" {
		t.Fatal("missing created key secret")
	}
	result := request(a, "GET", "/api/application/users/external/eggs", data.Meta.Secret)
	if result.Code != 403 {
		t.Errorf("external ID eggs crossed users scope: status %d, expected 403", result.Code)
	}
}

func TestOppositeTransferCallbacksCannotBothMutateAllocations(t *testing.T) {
	a, admin := reviewApp(t)
	daemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(204) }))
	defer daemon.Close()
	address, _ := url.Parse(daemon.URL)
	port, _ := strconv.Atoi(address.Port())
	sqlExec(t, a.DB, "INSERT INTO locations(short) VALUES('review')")
	for i := 1; i <= 2; i++ {
		body := fmt.Sprintf(`{"name":"Review%d","location_id":1,"fqdn":"127.0.0.1","scheme":"http","memory_overallocate":0,"disk_overallocate":0,"daemon_sftp":2022,"memory":4096,"disk":20480,"daemon_listen":%d}`, i, port)
		created := requestBody(a, "POST", "/api/admin/nodes", "", body)
		if created.Code != 201 {
			t.Fatalf("create isolated node %d status %d", i, created.Code)
		}
	}
	config := request(a, "GET", "/api/admin/nodes/2/configuration", "")
	if config.Code != 200 {
		t.Fatalf("get machine config status %d", config.Code)
	}
	var machine struct {
		TokenID string `json:"token_id"`
		Token   string `json:"token"`
	}
	if err := json.Unmarshal(config.Body.Bytes(), &machine); err != nil || machine.TokenID == "" || machine.Token == "" {
		t.Fatal("invalid fixture machine config")
	}
	sqlExec(t, a.DB, "INSERT INTO nests(uuid,author,name) VALUES($1,'review','review')", uuid.NewString())
	sqlExec(t, a.DB, "INSERT INTO eggs(uuid,nest_id,author,name) VALUES($1,1,'review','review')", uuid.NewString())
	serverUUID := uuid.NewString()
	sqlExec(t, a.DB, `INSERT INTO servers(uuid,uuid_short,identifier,name,owner_id,node_id,nest_id,egg_id,image,installed_at) VALUES($1,'review01','review01','review',1,1,1,1,'alpine',now())`, serverUUID)
	sqlExec(t, a.DB, "INSERT INTO allocations(node_id,server_id,ip,port) VALUES(1,1,'127.0.0.1',20101),(2,1,'127.0.0.1',20102)")
	sqlExec(t, a.DB, "UPDATE servers SET allocation_id=1 WHERE id=1")
	sqlExec(t, a.DB, "INSERT INTO server_transfers(server_id,old_node,new_node,old_allocation,new_allocation) VALUES(1,1,2,1,2)")
	ctx := context.Background()
	blocker, err := a.DB.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer blocker.Rollback(ctx)
	if _, err = blocker.Exec(ctx, "SELECT id FROM allocations ORDER BY id FOR UPDATE"); err != nil {
		t.Fatal(err)
	}
	results := make(chan int, 2)
	for _, result := range []string{"success", "failure"} {
		go func(result string) {
			results <- request(a, "POST", "/api/remote/servers/"+serverUUID+"/transfer/"+result, machine.TokenID+"."+machine.Token).Code
		}(result)
	}
	deadline := time.Now().Add(5 * time.Second)
	var waits int
	for time.Now().Before(deadline) {
		// Each isolated panel connection identifies its schema as application_name.
		var schema string
		if err = a.DB.QueryRow(ctx, "SELECT current_schema()").Scan(&schema); err != nil {
			t.Fatal(err)
		}
		err = admin.QueryRow(ctx, "SELECT count(*) FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'", schema).Scan(&waits)
		if err != nil {
			t.Fatal(err)
		}
		if waits >= 2 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if waits < 2 {
		t.Fatal("callbacks did not reach controlled database lock barrier")
	}
	if err = blocker.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	statuses := []int{<-results, <-results}
	successes := 0
	for _, status := range statuses {
		if status == 204 {
			successes++
		} else if status != 409 {
			t.Errorf("unexpected callback status %d", status)
		}
	}
	if successes != 1 {
		t.Errorf("callbacks both accepted stale transfer state: statuses %v", statuses)
	}
	var primaryOwned bool
	if err = a.DB.QueryRow(ctx, "SELECT a.server_id=s.id FROM servers s JOIN allocations a ON a.id=s.allocation_id WHERE s.id=1").Scan(&primaryOwned); err != nil {
		t.Fatal(err)
	}
	if !primaryOwned {
		t.Error("server primary allocation was freed by a stale opposite callback")
	}
}
