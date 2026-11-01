package panel

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strconv"
	"sync/atomic"
	"testing"
	"time"
)

func waitResourceReaders(t *testing.T, h *sharedResourceReads, key resourceReadKey, n int) {
	t.Helper()
	timer := time.NewTimer(2 * time.Second)
	defer timer.Stop()
	tick := time.NewTicker(time.Millisecond)
	defer tick.Stop()
	for {
		h.mu.Lock()
		f := h.flights[key]
		count := 0
		if f != nil {
			count = f.waiters
		}
		h.mu.Unlock()
		if count == n {
			return
		}
		select {
		case <-timer.C:
			t.Fatalf("waiters=%d, want %d", count, n)
		case <-tick.C:
		}
	}
}

func TestSharedResourcesCancellationAndFreshness(t *testing.T) {
	h := &sharedResourceReads{}
	defer h.close()
	key := resourceReadKey{"server", 1}
	entered, release := make(chan struct{}), make(chan struct{})
	var calls atomic.Int64
	fetch := func(ctx context.Context) (M, error) {
		calls.Add(1)
		close(entered)
		select {
		case <-release:
			return M{"state": "running"}, nil
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
	first, cancel := context.WithCancel(context.Background())
	defer cancel()
	firstResult, secondResult := make(chan error, 1), make(chan error, 1)
	go func() { _, err := h.read(first, key, fetch); firstResult <- err }()
	<-entered
	go func() {
		value, err := h.read(context.Background(), key, fetch)
		if err == nil && value["state"] != "running" {
			err = errors.New("wrong snapshot")
		}
		secondResult <- err
	}()
	waitResourceReaders(t, h, key, 2)
	cancel()
	if err := <-firstResult; !errors.Is(err, context.Canceled) {
		t.Fatalf("cancel: %v", err)
	}
	close(release)
	if err := <-secondResult; err != nil {
		t.Fatal(err)
	}
	_, err := h.read(context.Background(), key, func(context.Context) (M, error) { calls.Add(1); return M{"state": "stopped"}, nil })
	if err != nil || calls.Load() != 2 {
		t.Fatalf("completed telemetry reused: %d %v", calls.Load(), err)
	}
}

func TestSharedResourcesBoundsAndShutdown(t *testing.T) {
	h := &sharedResourceReads{flights: make(map[resourceReadKey]*resourceReadFlight)}
	for i := 0; i < 64; i++ {
		h.flights[resourceReadKey{"server", int64(i)}] = &resourceReadFlight{waiters: 1, cancel: func() {}}
	}
	if _, err := h.read(context.Background(), resourceReadKey{"overflow", 1}, nil); err == nil {
		t.Fatal("unbounded upstream reads")
	}
	h.close()
	if _, err := h.read(context.Background(), resourceReadKey{"closed", 1}, nil); !errors.Is(err, context.Canceled) {
		t.Fatalf("shutdown: %v", err)
	}
}

func TestRequestReadsFreshnessAndIsolationPostgres(t *testing.T) {
	a, ctx := collabTestApp(t)
	u, _ := collabFixture(t, a, ctx, "http://127.0.0.1:1")
	r := withRequestReads(httptest.NewRequest("GET", "http://localhost/api/client/account", nil))
	load := func(req *http.Request) M {
		t.Helper()
		value, err := a.one(req.Context(), "SELECT * FROM users WHERE id=$1", u["id"])
		if err != nil {
			t.Fatal(err)
		}
		return value
	}
	initial := load(r)
	initial["username"] = "mutated-copy"
	if load(r)["username"] == "mutated-copy" {
		t.Fatal("caller mutated shared row")
	}
	if err := a.exec(ctx, "UPDATE users SET disabled=true WHERE id=$1", u["id"]); err != nil {
		t.Fatal(err)
	}
	if boolean(load(r)["disabled"]) {
		t.Fatal("request snapshot was not reused")
	}
	fresh := withRequestReads(httptest.NewRequest("GET", "http://localhost/api/client/account", nil))
	if !boolean(load(fresh)["disabled"]) {
		t.Fatal("authorization cached across requests")
	}
	for _, method := range []string{"PUT", "POST", "DELETE"} {
		req := withRequestReads(httptest.NewRequest(method, "http://localhost/api/client/account", nil))
		if req.Context().Value(requestReadContextKey{}) != nil {
			t.Fatal("mutation cached")
		}
	}
	socket := httptest.NewRequest("GET", "http://localhost/api/client/events", nil)
	socket.Header.Set("Upgrade", "websocket")
	if withRequestReads(socket).Context().Value(requestReadContextKey{}) != nil {
		t.Fatal("socket identity cached")
	}
}

func TestClientListBatchResponseParityPostgres(t *testing.T) {
	a, ctx := collabTestApp(t)
	u, s := collabFixture(t, a, ctx, "http://127.0.0.1:1")
	allocation, err := a.insert(ctx, "allocations", M{"node_id": s["node_id"], "server_id": s["id"], "ip": "127.0.0.1", "port": 25565, "notes": "owner only"})
	if err != nil {
		t.Fatal(err)
	}
	if err = a.exec(ctx, "UPDATE servers SET allocation_id=$1 WHERE id=$2", allocation["id"], s["id"]); err != nil {
		t.Fatal(err)
	}
	variable, err := a.insert(ctx, "egg_variables", M{"egg_id": s["egg_id"], "name": "Test", "env_variable": "TEST", "default_value": "default", "user_viewable": true, "user_editable": true})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = a.insert(ctx, "server_variables", M{"server_id": s["id"], "variable_id": variable["id"], "variable_value": "override"}); err != nil {
		t.Fatal(err)
	}
	id := newUUID()
	second, err := a.insert(ctx, "servers", M{"uuid": id, "uuid_short": id[:8], "identifier": id[:8], "name": "second", "owner_id": u["id"], "node_id": s["node_id"], "nest_id": s["nest_id"], "egg_id": s["egg_id"], "image": "fixture", "allocation_id": allocation["id"]})
	if err != nil {
		t.Fatal(err)
	}
	viewer, err := a.insert(ctx, "users", M{"uuid": newUUID(), "username": "viewer", "email": "viewer@example.test"})
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range []M{s, second} {
		if _, err = a.insert(ctx, "subusers", M{"user_id": viewer["id"], "server_id": entry["id"], "permissions": []any{"file.read"}}); err != nil {
			t.Fatal(err)
		}
	}
	servers, err := a.query(ctx, "SELECT * FROM servers ORDER BY id")
	if err != nil {
		t.Fatal(err)
	}
	for _, user := range []M{u, viewer} {
		expected := []M{}
		for _, server := range servers {
			value, e := a.clientServer(ctx, user, server)
			if e != nil {
				t.Fatal(e)
			}
			expected = append(expected, value)
		}
		req := WithUser(httptest.NewRequest("GET", "http://localhost/api/client", nil), num(user["id"]))
		recorder := httptest.NewRecorder()
		a.clientServers(recorder, req)
		if recorder.Code != 200 {
			t.Fatalf("batch: %d %s", recorder.Code, recorder.Body.String())
		}
		var actual, normalizedExpected any
		if err = json.Unmarshal(recorder.Body.Bytes(), &actual); err != nil {
			t.Fatal(err)
		}
		body, _ := json.Marshal(collection("server", expected))
		_ = json.Unmarshal(body, &normalizedExpected)
		if !reflect.DeepEqual(actual.(map[string]any)["data"], normalizedExpected.(map[string]any)["data"]) {
			t.Fatalf("batch changed response for user %v", user["id"])
		}
	}
}

func TestSharedResourcesAuthorizationPostgres(t *testing.T) {
	a, ctx := collabTestApp(t)
	defer a.resourceReads.close()
	entered, release := make(chan struct{}, 1), make(chan struct{})
	defer func() {
		select {
		case <-release:
		default:
			close(release)
		}
	}()
	var calls atomic.Int64
	wings := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		entered <- struct{}{}
		select {
		case <-release:
			writeJSON(w, 200, M{"state": "running", "utilization": M{}})
		case <-r.Context().Done():
		}
	}))
	defer wings.Close()
	u, s := collabFixture(t, a, ctx, wings.URL)
	outsider, err := a.insert(ctx, "users", M{"uuid": newUUID(), "username": "outsider", "email": "outsider@example.test"})
	if err != nil {
		t.Fatal(err)
	}
	a.Config.DevMode = true
	a.Config.DevUserID = num(u["id"])
	server := httptest.NewServer(a.Handler())
	defer server.Close()
	client := server.Client()
	client.Timeout = 3 * time.Second
	path := server.URL + "/api/client/servers/" + str(s["uuid_short"]) + "/resources"
	statuses := make(chan int, 2)
	request := func(id int64) int {
		req, _ := http.NewRequest("GET", path, nil)
		req.Header.Set("X-Dev-User-ID", strconv.FormatInt(id, 10))
		res, e := client.Do(req)
		if e != nil {
			return 0
		}
		defer res.Body.Close()
		io.Copy(io.Discard, res.Body)
		return res.StatusCode
	}
	go func() { statuses <- request(num(u["id"])) }()
	<-entered
	go func() { statuses <- request(num(u["id"])) }()
	waitResourceReaders(t, &a.resourceReads, resourceReadKey{str(s["uuid"]), num(s["node_id"])}, 2)
	if status := request(num(outsider["id"])); status != 404 {
		t.Fatalf("outsider joined authorized read: %d", status)
	}
	close(release)
	for i := 0; i < 2; i++ {
		if status := <-statuses; status != 200 {
			t.Fatalf("authorized resource status=%d", status)
		}
	}
	if calls.Load() != 1 {
		t.Fatalf("upstream calls=%d", calls.Load())
	}
}
