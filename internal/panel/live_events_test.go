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
	// Logout must invalidate the already-upgraded connection before delivery.
	if err = a.exec(ctx, "DELETE FROM browser_sessions WHERE token_hash=$1", pairingHash(token)); err != nil {
		t.Fatal(err)
	}
	a.liveEvents.navigationChanged(num(u["id"]))
	_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	var message M
	if err = conn.ReadJSON(&message); err == nil {
		t.Fatal("event delivered after session revocation")
	}
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
