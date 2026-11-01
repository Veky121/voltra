package panel

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func TestLiveTopicAllowlist(t *testing.T) {
	a := &App{}
	for _, path := range []string{"/api/client?summary=overview&states=1", "/api/client/servers/abc", "/api/client/servers/abc/resources", "/api/client/servers/abc/steam", "/api/client/servers/abc/backups", "/api/client/servers/abc/schedules", "/api/client/servers/abc/activity"} {
		if _, ok := a.liveTopic(path); !ok {
			t.Fatalf("missing %s", path)
		}
	}
	for _, path := range []string{"https://evil.test/api/client/servers/a/resources", "/api/admin/users", "/api/client/servers/a/startup", "/api/client/servers/a/game-settings", "/api/client/servers/a/files/contents", "/api/client/servers/a/steam/private", "/api/client/servers/a/resources?token=x", "/api/client/servers/%2e%2e/resources", "/api/client/servers/../resources"} {
		if _, ok := a.liveTopic(path); ok {
			t.Fatalf("unsafe %s", path)
		}
	}
}

func TestLiveSnapshotBounds(t *testing.T) {
	a := &App{}
	a.liveSnapshots.workers = map[string]*liveSnapshotWorker{}
	for i := 0; i < 256; i++ {
		a.liveSnapshots.workers[string(rune(i))] = &liveSnapshotWorker{cancel: func() {}}
	}
	topic, _ := a.liveTopic("/api/client/servers/another/resources")
	if a.watchLiveTopic(topic, 1, &liveBinding{updates: make(chan liveDelivery, 1)}) {
		t.Fatal("collector limit bypassed")
	}
	w := &liveResponse{header: make(http.Header)}
	_, _ = w.Write(make([]byte, (1<<20)+1))
	if !w.overflow || w.body.Len() != 0 {
		t.Fatal("live payload limit bypassed")
	}
	a.liveSnapshots.close()
}

func TestLiveSnapshotPanicIsContained(t *testing.T) {
	a := &App{}
	sample := a.loadLiveSample(context.Background(), liveTopic{path: "/test", handler: func(http.ResponseWriter, *http.Request) { panic("test failure") }}, 1)
	if sample.status != 503 {
		t.Fatalf("panic returned %d", sample.status)
	}
}

func liveRead(t *testing.T, c *websocket.Conn, predicate func(M) bool) M {
	t.Helper()
	_ = c.SetReadDeadline(time.Now().Add(4 * time.Second))
	for {
		var packet M
		if err := c.ReadJSON(&packet); err != nil {
			t.Fatal(err)
		}
		if predicate(packet) {
			return packet
		}
	}
}
func liveTestConnect(t *testing.T, a *App, server *httptest.Server, user int64) *websocket.Conn {
	t.Helper()
	token := randomToken(32)
	if err := a.exec(context.Background(), "INSERT INTO browser_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')", pairingHash(token), user); err != nil {
		t.Fatal(err)
	}
	conn, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http")+"/api/client/events", http.Header{"Origin": {server.URL}, "Cookie": {sessionCookie + "=" + token}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { conn.Close() })
	liveRead(t, conn, func(m M) bool { return m["type"] == "ready" })
	return conn
}

func TestLiveSnapshotsSharingAndRevocationPostgres(t *testing.T) {
	a, ctx := collabTestApp(t)
	defer a.liveSnapshots.close()
	defer a.resourceReads.close()
	var calls atomic.Int64
	wings := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := calls.Add(1)
		writeJSON(w, 200, M{"state": "running", "utilization": M{"uptime": n}})
	}))
	defer wings.Close()
	u, s := collabFixture(t, a, ctx, wings.URL)
	viewer, err := a.insert(ctx, "users", M{"uuid": newUUID(), "username": "viewer", "email": "viewer@example.test"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = a.insert(ctx, "subusers", M{"user_id": viewer["id"], "server_id": s["id"], "permissions": []any{"file.read"}}); err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(a.Handler())
	defer server.Close()
	a.Config.PublicURL = server.URL
	ownerSocket := liveTestConnect(t, a, server, num(u["id"]))
	viewerSocket := liveTestConnect(t, a, server, num(viewer["id"]))
	path := "/api/client/servers/" + str(s["uuid_short"]) + "/resources"
	for _, socket := range []*websocket.Conn{ownerSocket, viewerSocket} {
		if err = socket.WriteJSON(M{"type": "subscribe", "revision": 1, "paths": []string{path}}); err != nil {
			t.Fatal(err)
		}
		packet := liveRead(t, socket, func(m M) bool { return m["type"] == "snapshot" })
		if num(packet["status"]) != 200 || packet["event"] != "server.resources" {
			t.Fatalf("snapshot: %v", packet)
		}
	}
	a.liveSnapshots.mu.Lock()
	workers := len(a.liveSnapshots.workers)
	listeners := 0
	for _, w := range a.liveSnapshots.workers {
		listeners += len(w.bindings)
	}
	a.liveSnapshots.mu.Unlock()
	if workers != 1 || listeners != 2 {
		t.Fatalf("collectors=%d listeners=%d", workers, listeners)
	}
	if err = a.exec(ctx, "DELETE FROM subusers WHERE user_id=$1", viewer["id"]); err != nil {
		t.Fatal(err)
	}
	a.liveSnapshots.invalidate(num(viewer["id"]))
	denied := liveRead(t, viewerSocket, func(m M) bool { return num(m["status"]) == 403 })
	if asMap(denied["data"])["attributes"] != nil {
		t.Fatal("resource data delivered after access revoked")
	}
	if packet := liveRead(t, ownerSocket, func(m M) bool { return m["type"] == "snapshot" }); num(packet["status"]) != 200 {
		t.Fatal("owner lost shared collector")
	}
	ownerSocket.Close()
	viewerSocket.Close()
	deadline := time.Now().Add(2 * time.Second)
	for {
		a.liveSnapshots.mu.Lock()
		remaining := len(a.liveSnapshots.workers)
		a.liveSnapshots.mu.Unlock()
		if remaining == 0 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("collectors leaked: %d", remaining)
		}
		time.Sleep(time.Millisecond)
	}
}

func TestLiveSnapshotsLifecycleAndJobEventsPostgres(t *testing.T) {
	a, ctx := collabTestApp(t)
	defer a.liveSnapshots.close()
	u, s := collabFixture(t, a, ctx, "http://127.0.0.1:1")
	if err := a.exec(ctx, "INSERT INTO steam_servers(server_id,game,app_id) VALUES($1,'cs2',730)", s["id"]); err != nil {
		t.Fatal(err)
	}
	if err := a.exec(ctx, "INSERT INTO steam_jobs(id,server_id,operation,status,stage) VALUES('live-job',$1,'update','running','download')", s["id"]); err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(a.Handler())
	defer server.Close()
	a.Config.PublicURL = server.URL
	conn := liveTestConnect(t, a, server, num(u["id"]))
	base := "/api/client/servers/" + str(s["uuid_short"])
	if err := conn.WriteJSON(M{"type": "subscribe", "revision": 1, "paths": []string{base, base + "/steam"}}); err != nil {
		t.Fatal(err)
	}
	packet := liveRead(t, conn, func(m M) bool { return m["event"] == "jobs.updated" })
	if num(packet["status"]) != 200 || !strings.Contains(str(packet["data"]), "download") {
		t.Fatalf("job event: %v", packet)
	}
	if err := a.exec(ctx, "UPDATE steam_jobs SET stage='complete',status='completed' WHERE id='live-job'"); err != nil {
		t.Fatal(err)
	}
	a.liveSnapshots.invalidate(num(u["id"]))
	packet = liveRead(t, conn, func(m M) bool { return m["event"] == "jobs.updated" && strings.Contains(str(m["data"]), "complete") })
	if packet["event"] != "jobs.updated" {
		t.Fatal("missing progress")
	}
	if err := a.exec(ctx, "UPDATE servers SET status='installing',updated_at=now() WHERE id=$1", s["id"]); err != nil {
		t.Fatal(err)
	}
	a.liveSnapshots.invalidate(num(u["id"]))
	packet = liveRead(t, conn, func(m M) bool { return m["event"] == "server.updated" && m["type"] == "invalidated" })
	if packet["data"] != nil {
		t.Fatal("full server data should be fetched through authorized HTTP")
	}
}
