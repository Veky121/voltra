package panel

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func TestLiveEventHubIsolationAndBounds(t *testing.T) {
	h := &liveEventHub{}
	a, done, unsub, ok := h.subscribe(1)
	if !ok {
		t.Fatal("subscribe")
	}
	defer unsub()
	b, _, other, ok := h.subscribe(2)
	if !ok {
		t.Fatal("subscribe")
	}
	defer other()
	for i := 0; i < 100; i++ {
		h.navigationChanged(1)
	}
	if len(a) != 1 || len(b) != 0 {
		t.Fatal("invalidation leaked or did not coalesce")
	}
	for i := 0; i < 7; i++ {
		_, _, cancel, ok := h.subscribe(1)
		if !ok {
			t.Fatal("limit too small")
		}
		defer cancel()
	}
	if _, _, _, ok := h.subscribe(1); ok {
		t.Fatal("per-user limit bypassed")
	}
	unsub()
	unsub() // Cleanup is idempotent.
	h.close()
	h.close()
	select {
	case <-done:
	default:
		t.Fatal("shutdown not signalled")
	}
	if _, _, _, ok := h.subscribe(3); ok {
		t.Fatal("subscribed after close")
	}
}

func TestLiveEventOrigin(t *testing.T) {
	a := &App{}
	for _, tt := range []struct {
		origin string
		want   bool
	}{{"https://panel.test", true}, {"https://evil.test", false}, {"", false}, {"https://user@panel.test", false}, {"https://panel.test/path", false}, {"https://panel.test?x=1", false}} {
		r := httptest.NewRequest("GET", "https://panel.test/api/client/events", nil)
		r.Header.Set("Origin", tt.origin)
		if a.liveEventOrigin(r) != tt.want {
			t.Fatalf("origin %q", tt.origin)
		}
	}
}

func TestLiveEventDesktopRevocationPostgres(t *testing.T) {
	a, ctx := collabTestApp(t)
	u, _ := collabFixture(t, a, ctx, "http://127.0.0.1:1")
	token := desktopTokenPrefix + randomToken(32)
	if err := a.exec(ctx, "INSERT INTO desktop_devices(id,user_id,name,token_hash,expires_at) VALUES($1,$2,'test',$3,now()+interval '1 hour')", newUUID(), u["id"], pairingHash(token)); err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest("GET", "http://127.0.0.1/api/client/events", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	if id, err := a.liveEventIdentity(req); err != nil || id != num(u["id"]) {
		t.Fatalf("desktop identity %d: %v", id, err)
	}
	if err := a.exec(ctx, "UPDATE desktop_devices SET revoked_at=now() WHERE user_id=$1", u["id"]); err != nil {
		t.Fatal(err)
	}
	if _, err := a.liveEventIdentity(req); err == nil {
		t.Fatal("revoked desktop authenticated")
	}
	req.Header.Set("Authorization", "Bearer machine-key-not-supported")
	if _, err := a.liveEventIdentity(req); err == nil {
		t.Fatal("machine credential accepted")
	}
}

func TestLiveEventsPostgres(t *testing.T) {
	a, ctx := collabTestApp(t)
	defer a.liveEvents.close()
	u, s := collabFixture(t, a, ctx, "http://127.0.0.1:1")
	token := randomToken(32)
	if err := a.exec(ctx, "INSERT INTO browser_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')", pairingHash(token), u["id"]); err != nil {
		t.Fatal(err)
	}
	// Committed row changes reach sockets as hints, as in production.
	a.startLiveChanges()
	defer a.stopLiveChanges()
	server := httptest.NewServer(a.Handler())
	defer server.Close()
	a.Config.PublicURL = server.URL
	headers := http.Header{"Origin": {server.URL}, "Cookie": {sessionCookie + "=" + token}}
	wsURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/api/client/events"
	conn, res, err := websocket.DefaultDialer.Dial(wsURL, headers)
	if err != nil {
		if res != nil {
			t.Fatalf("upgrade: %d", res.StatusCode)
		}
		t.Fatal(err)
	}
	defer conn.Close()
	read := func() M {
		t.Helper()
		_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
		var m M
		if err := conn.ReadJSON(&m); err != nil {
			t.Fatal(err)
		}
		return m
	}
	if read()["type"] != "ready" {
		t.Fatal("missing ready")
	}
	// A real successful mutation must publish to this account's sockets.
	req, _ := http.NewRequest("PUT", server.URL+"/api/client/servers/"+str(s["uuid_short"])+"/navigation", strings.NewReader(`{"favorite":true}`))
	req.Header = headers.Clone()
	req.Header.Set("Content-Type", "application/json")
	response, err := server.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != 200 {
		t.Fatalf("favorite: %d", response.StatusCode)
	}
	if read()["type"] != "navigation.invalidated" {
		t.Fatal("missing mutation event")
	}
	// Ending the session closes the already-upgraded connection: the deleted
	// row arrives as an access hint and the socket re-checks its cached identity.
	if err = a.exec(ctx, "DELETE FROM browser_sessions WHERE token_hash=$1", pairingHash(token)); err != nil {
		t.Fatal(err)
	}
	_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	var message M
	if err = conn.ReadJSON(&message); err == nil {
		t.Fatalf("event delivered after session revocation: %v", message)
	}
	a.liveEvents.navigationChanged(num(u["id"]))
	_, res, err = websocket.DefaultDialer.Dial(wsURL, headers)
	if err == nil {
		t.Fatal("revoked session upgraded")
	}
	if res == nil || res.StatusCode != 401 {
		t.Fatalf("revoked status: %v", res)
	}
	res.Body.Close()
	// Restore valid authentication to exercise origin rejection independently.
	if err = a.exec(ctx, "INSERT INTO browser_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')", pairingHash(token), u["id"]); err != nil {
		t.Fatal(err)
	}
	badOrigin := headers.Clone()
	badOrigin.Set("Origin", "https://evil.test")
	_, res, err = websocket.DefaultDialer.Dial(wsURL, badOrigin)
	if err == nil {
		t.Fatal("cross-origin upgraded")
	}
	if res == nil || res.StatusCode != 403 {
		t.Fatalf("origin status: %v", res)
	}
	res.Body.Close()
}

// Without any change signal (a session that expires on its own), a socket
// still re-checks its identity before sending once liveAuthTTL has passed.
func TestLiveEventIdentityCacheIsBoundedPostgres(t *testing.T) {
	previous := liveAuthTTL
	liveAuthTTL = 100 * time.Millisecond
	defer func() { liveAuthTTL = previous }()
	a, ctx := collabTestApp(t)
	defer a.liveEvents.close()
	u, _ := collabFixture(t, a, ctx, "http://127.0.0.1:1")
	server := httptest.NewServer(a.Handler())
	defer server.Close()
	a.Config.PublicURL = server.URL
	conn := liveTestConnect(t, a, server, num(u["id"]))
	a.liveEvents.navigationChanged(num(u["id"]))
	if liveRead(t, conn, func(m M) bool { return m["type"] == "navigation.invalidated" }) == nil {
		t.Fatal("missing event")
	}
	// No listener runs here, so the expiry produces no hint.
	if err := a.exec(ctx, "UPDATE browser_sessions SET expires_at=now()-interval '1 second' WHERE user_id=$1", u["id"]); err != nil {
		t.Fatal(err)
	}
	time.Sleep(2 * liveAuthTTL)
	a.liveEvents.navigationChanged(num(u["id"]))
	_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	var message M
	if err := conn.ReadJSON(&message); err == nil {
		t.Fatalf("event delivered after the session expired: %v", message)
	}
}

// State changes and row hints name their server: only that server's viewers
// hear of them, with the identifiers their client paths use.
func TestLiveReadHintsScopedByServerPostgres(t *testing.T) {
	a, ctx := collabTestApp(t)
	defer a.liveSnapshots.close()
	ownerA, serverA := collabFixture(t, a, ctx, "http://127.0.0.1:1")
	ownerB, err := a.insert(ctx, "users", M{"uuid": newUUID(), "username": "other-owner", "email": "other-owner@example.test"})
	if err != nil {
		t.Fatal(err)
	}
	uuid := newUUID()
	serverB, err := a.insert(ctx, "servers", M{"uuid": uuid, "uuid_short": uuid[:8], "identifier": uuid[:8], "name": "other", "owner_id": ownerB["id"], "node_id": serverA["node_id"], "nest_id": serverA["nest_id"], "egg_id": serverA["egg_id"], "image": "alpine:latest", "installed_at": time.Now()})
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(a.Handler())
	defer server.Close()
	a.Config.PublicURL = server.URL
	socketA := liveTestConnect(t, a, server, num(ownerA["id"]))
	socketB := liveTestConnect(t, a, server, num(ownerB["id"]))
	for _, c := range []*websocket.Conn{socketA, socketB} {
		if err = c.WriteJSON(M{"type": "subscribe", "revision": 1, "paths": []string{}, "domains": []string{"backups", "servers"}}); err != nil {
			t.Fatal(err)
		}
	}
	time.Sleep(100 * time.Millisecond)
	a.startLiveChanges()
	defer a.stopLiveChanges()
	// The listener's start-up "all" hint reaches both, without servers.
	for _, c := range []*websocket.Conn{socketA, socketB} {
		packet := liveRead(t, c, func(m M) bool { return m["type"] == "reads.invalidated" })
		if _, scoped := packet["servers"]; scoped {
			t.Fatalf("global hint scoped: %v", packet)
		}
	}
	if _, err = a.insert(ctx, "backups", M{"uuid": newUUID(), "server_id": serverA["id"], "name": "Only A"}); err != nil {
		t.Fatal(err)
	}
	a.publishServerReadChanges([]int64{num(serverA["id"])}, "servers")
	packet := liveRead(t, socketA, func(m M) bool { return m["type"] == "reads.invalidated" })
	servers := asSlice(packet["servers"])
	names := map[string]bool{}
	for _, value := range servers {
		names[str(value)] = true
	}
	if !names[str(serverA["uuid"])] || !names[str(serverA["uuid_short"])] || names[str(serverB["uuid"])] {
		t.Fatalf("scoped hint: %v", packet)
	}
	_ = socketB.SetReadDeadline(time.Now().Add(500 * time.Millisecond))
	var leaked M
	if socketB.ReadJSON(&leaked) == nil {
		t.Fatalf("another owner heard of server A: %v", leaked)
	}
}
