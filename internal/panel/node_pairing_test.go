package panel

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"voltra/internal/nodeagent"
)

func pairingTestApp(t *testing.T) (*App, *http.ServeMux, int64) {
	t.Helper()
	a, h, u := infraTestApp(t)
	mux := h.(*http.ServeMux)
	a.registerNodePairing(mux)
	t.Cleanup(func() { a.connectors().close() })
	return a, mux, u
}
func pairingRequest(t *testing.T, h http.Handler, user int64, method, path, token string, body any) (int, M) {
	t.Helper()
	var b []byte
	var e error
	if body != nil {
		b, e = json.Marshal(body)
		if e != nil {
			t.Fatal(e)
		}
	}
	r := httptest.NewRequest(method, path, bytes.NewReader(b))
	if user > 0 {
		r = WithUser(r, user)
	}
	if token != "" {
		r.Header.Set("Authorization", "Bearer "+token)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	m := M{}
	if e = json.Unmarshal(w.Body.Bytes(), &m); e != nil {
		t.Fatalf("non-JSON response %d: %s", w.Code, w.Body)
	}
	return w.Code, m
}
func pairSession(t *testing.T, h http.Handler, user int64, maximum int64) M {
	t.Helper()
	status, m := pairingRequest(t, h, user, "POST", "/api/admin/node-enrollments", "", M{"max_nodes": maximum})
	if status != 201 {
		t.Fatalf("session %d: %v", status, m)
	}
	return m
}
func pairNodeRequest(t *testing.T, h http.Handler, s M) M {
	t.Helper()
	parts := strings.SplitN(str(asMap(s["connection_strings"])["local"]), "#", 2)
	status, m := pairingRequest(t, h, 0, "POST", "/api/remote/enroll", "", M{"token": parts[1], "hostname": "pairing-fixture", "platform": "linux", "architecture": "amd64", "memory_mib": 4096, "disk_mib": 20480})
	if status != 201 {
		t.Fatalf("request %d: %v", status, m)
	}
	return m
}
func TestNodePairingApprovalAndCredentialIsolation(t *testing.T) {
	a, h, u := pairingTestApp(t)
	ctx := context.Background()
	s := pairSession(t, h, u, 1)
	request := pairNodeRequest(t, h, s)
	path := "/api/remote/enroll/" + str(request["id"])
	token := str(request["request_token"])
	if status, _ := pairingRequest(t, h, 0, "GET", path, randomToken(32), nil); status != 401 {
		t.Fatalf("other request credential accepted: %d", status)
	}
	if status, m := pairingRequest(t, h, 0, "GET", path, token, nil); status != 200 || m["status"] != "pending" || m["connector_token"] != nil {
		t.Fatalf("unapproved credentials: %d %v", status, m)
	}
	if status, _ := pairingRequest(t, h, 0, "POST", "/api/admin/node-requests/"+str(request["id"])+"/approve", "", M{}); status == 200 {
		t.Fatal("anonymous approval")
	}
	status, approved := pairingRequest(t, h, u, "POST", "/api/admin/node-requests/"+str(request["id"])+"/approve", "", M{})
	if status != 200 {
		t.Fatalf("approve %d: %v", status, approved)
	}
	status, result := pairingRequest(t, h, 0, "GET", path, token, nil)
	if status != 200 || len(str(result["connector_token"])) != 64 {
		t.Fatalf("approved result %d: %v", status, result)
	}
	config := asMap(result["configuration"])
	if asMap(config["api"])["host"] != "127.0.0.1" || boolean(asMap(asMap(config["api"])["ssl"])["enabled"]) {
		t.Fatal("Wings management listener is exposed")
	}
	if asMap(asMap(config["system"])["sftp"])["bind_address"] != "127.0.0.1" {
		t.Fatal("paired SFTP listener is exposed")
	}
	id := num(result["node_id"])
	stored, e := a.one(ctx, "SELECT daemon_token FROM nodes WHERE id=$1", id)
	if e != nil {
		t.Fatal(e)
	}
	if !strings.HasPrefix(str(stored["daemon_token"]), "enc:v1:") {
		t.Fatal("daemon secret not encrypted")
	}
	// A list response must never contain either bootstrap or permanent credentials.
	status, list := pairingRequest(t, h, u, "GET", "/api/admin/node-enrollments", "", nil)
	raw, _ := json.Marshal(list)
	if status != 200 || bytes.Contains(raw, []byte(token)) || bytes.Contains(raw, []byte(str(result["connector_token"]))) || bytes.Contains(raw, []byte(str(config["token"]))) {
		t.Fatal("credential leaked in list")
	}
	if status, _ := pairingRequest(t, h, 0, "POST", path+"/complete", token, nil); status != 200 {
		t.Fatalf("complete: %d", status)
	}
	if status, _ := pairingRequest(t, h, 0, "POST", path+"/complete", token, nil); status != 200 {
		t.Fatalf("complete not idempotent: %d", status)
	}
	if _, m := pairingRequest(t, h, 0, "GET", path, token, nil); m["status"] != "completed" || m["configuration"] != nil || m["connector_token"] != nil {
		t.Fatal("completed bootstrap still exposes credentials")
	}
	parts := strings.SplitN(str(asMap(s["connection_strings"])["local"]), "#", 2)
	if _, e = a.connectorNode(ctx, parts[1]); e == nil {
		t.Fatal("pairing token accepted as connector credential")
	}
	if status, _ := pairingRequest(t, h, u, "POST", "/api/admin/nodes/"+str(id)+"/disconnect", "", nil); status != 200 {
		t.Fatalf("revoke: %d", status)
	}
	if _, e = a.connectorNode(ctx, str(result["connector_token"])); e == nil {
		t.Fatal("revoked credential accepted")
	}
}

func TestNodePairingConcurrentLimitCloseRejectAndExpiry(t *testing.T) {
	a, h, u := pairingTestApp(t)
	s := pairSession(t, h, u, 1)
	r1, r2 := pairNodeRequest(t, h, s), pairNodeRequest(t, h, s)
	var wg sync.WaitGroup
	statuses := make(chan int, 2)
	for _, r := range []M{r1, r2} {
		wg.Add(1)
		go func(r M) {
			defer wg.Done()
			status, _ := pairingRequest(t, h, u, "POST", "/api/admin/node-requests/"+str(r["id"])+"/approve", "", M{})
			statuses <- status
		}(r)
	}
	wg.Wait()
	close(statuses)
	successes := 0
	for status := range statuses {
		if status == 200 {
			successes++
		} else if status != 422 {
			t.Fatalf("unexpected approval status %d", status)
		}
	}
	if successes != 1 {
		t.Fatalf("capacity race admitted %d nodes", successes)
	}
	s = pairSession(t, h, u, 0)
	r1 = pairNodeRequest(t, h, s)
	r2 = pairNodeRequest(t, h, s)
	if status, _ := pairingRequest(t, h, u, "POST", "/api/admin/node-requests/"+str(r1["id"])+"/reject", "", nil); status != 200 {
		t.Fatalf("reject %d", status)
	}
	if status, m := pairingRequest(t, h, 0, "GET", "/api/remote/enroll/"+str(r1["id"]), str(r1["request_token"]), nil); status != 200 || m["status"] != "rejected" {
		t.Fatal("rejected request not terminal")
	}
	if status, _ := pairingRequest(t, h, u, "POST", "/api/admin/node-enrollments/"+str(s["id"])+"/close", "", nil); status != 200 {
		t.Fatalf("close %d", status)
	}
	if status, _ := pairingRequest(t, h, u, "POST", "/api/admin/node-requests/"+str(r2["id"])+"/approve", "", M{}); status != 422 {
		t.Fatal("closed session approved")
	}
	s = pairSession(t, h, u, 0)
	r1 = pairNodeRequest(t, h, s)
	_, e := a.DB.Exec(context.Background(), "UPDATE node_requests SET expires_at=now()-interval '1 second' WHERE id=$1", r1["id"])
	if e != nil {
		t.Fatal(e)
	}
	if _, m := pairingRequest(t, h, 0, "GET", "/api/remote/enroll/"+str(r1["id"]), str(r1["request_token"]), nil); m["status"] != "expired" {
		t.Fatal("expired request active")
	}
}

func waitConnector(t *testing.T, a *App, id int64, old *connectorControl) {
	t.Helper()
	deadline := time.Now().Add(8 * time.Second)
	for time.Now().Before(deadline) {
		h := a.connectors()
		h.mu.Lock()
		c := h.controls[id]
		h.mu.Unlock()
		if c != nil && c != old {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("connector did not come online")
}
func TestNodeConnectorHTTPStreamingWebsocketReconnectRevocation(t *testing.T) {
	a, h, u := pairingTestApp(t)
	ctx := context.Background()
	payload := bytes.Repeat([]byte("streamed-data-"), 100000)
	sum := sha256.Sum256(payload)
	wings := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/ws" {
			ws, e := (&websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}).Upgrade(w, r, nil)
			if e != nil {
				return
			}
			defer ws.Close()
			for {
				kind, b, e := ws.ReadMessage()
				if e != nil {
					return
				}
				if ws.WriteMessage(kind, b) != nil {
					return
				}
			}
		}
		if r.Header.Get("Authorization") == "" {
			http.Error(w, "no daemon credential", 401)
			return
		}
		if r.Method == "POST" {
			data, e := io.ReadAll(r.Body)
			if e != nil {
				t.Error(e)
				return
			}
			actual := sha256.Sum256(data)
			if actual != sum {
				t.Error("upload corrupted")
			}
			w.WriteHeader(204)
			return
		}
		w.Header().Set("Content-Type", "application/octet-stream")
		_, _ = w.Write(payload)
	}))
	defer wings.Close()
	panel := httptest.NewServer(h)
	defer panel.Close()
	a.Config.PublicURL = panel.URL
	s := pairSession(t, h, u, 0)
	request := pairNodeRequest(t, h, s)
	status, approval := pairingRequest(t, h, u, "POST", "/api/admin/node-requests/"+str(request["id"])+"/approve", "", M{})
	if status != 200 {
		t.Fatalf("approve %d %v", status, approval)
	}
	_, result := pairingRequest(t, h, 0, "GET", "/api/remote/enroll/"+str(request["id"]), str(request["request_token"]), nil)
	id := num(result["node_id"])
	n, e := a.node(ctx, id)
	if e != nil {
		t.Fatal(e)
	}
	runCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	done := make(chan error, 1)
	go func() {
		done <- nodeagent.Run(runCtx, nodeagent.Config{PanelURL: panel.URL, Token: str(result["connector_token"]), WingsAddress: strings.TrimPrefix(wings.URL, "http://")})
	}()
	defer func() {
		cancel()
		select {
		case <-done:
		case <-time.After(5 * time.Second):
			t.Error("connector did not stop")
		}
	}()
	waitConnector(t, a, id, nil)
	response, e := a.daemon(ctx, n, "GET", "/large", nil)
	if e != nil {
		t.Fatal(e)
	}
	data, e := io.ReadAll(response.Body)
	response.Body.Close()
	if e != nil || !bytes.Equal(data, payload) {
		t.Fatalf("streaming download corrupted: %v", e)
	}
	response, e = a.daemon(ctx, n, "POST", "/large", bytes.NewReader(payload))
	if e != nil {
		t.Fatal(e)
	}
	response.Body.Close()
	dialer := websocket.Dialer{NetDialContext: func(ctx context.Context, network, addr string) (net.Conn, error) { return a.dialNodeConnector(ctx, id) }}
	ws, resp, e := dialer.DialContext(ctx, "ws://127.0.0.1/ws", nil)
	if resp != nil && resp.Body != nil {
		resp.Body.Close()
	}
	if e != nil {
		t.Fatal(e)
	}
	if e = ws.WriteMessage(websocket.TextMessage, []byte("console command")); e != nil {
		t.Fatal(e)
	}
	_, b, e := ws.ReadMessage()
	if e != nil || string(b) != "console command" {
		t.Fatalf("WebSocket tunnel: %q %v", b, e)
	}
	ws.Close()
	a.connectors().mu.Lock()
	old := a.connectors().controls[id]
	a.connectors().mu.Unlock()
	a.connectors().disconnect(id)
	waitConnector(t, a, id, old)
	response, e = a.daemon(ctx, n, "GET", "/reconnected", nil)
	if e != nil {
		t.Fatal(e)
	}
	response.Body.Close()
	if status, _ = pairingRequest(t, h, u, "POST", "/api/admin/nodes/"+str(id)+"/disconnect", "", nil); status != 200 {
		t.Fatalf("revoke %d", status)
	}
	if _, e = a.daemon(ctx, n, "GET", "/offline", nil); e == nil {
		t.Fatal("revoked node still reachable")
	}
	if a.connectors().connected(id) {
		t.Fatal("revoked node online")
	}
}

func TestPairingURLsRequireTLSExceptLoopback(t *testing.T) {
	for _, raw := range []string{"http://192.168.1.20", "https://user:secret@example.com", "https://example.com/path", "https://example.com?token=x", "https://example.com#token"} {
		if _, e := pairingPanelURL(raw); e == nil {
			t.Errorf("accepted %s", raw)
		}
	}
	for _, raw := range []string{"https://panel.example.com", "http://127.0.0.1:8088", "http://localhost:8088"} {
		if _, e := pairingPanelURL(raw); e != nil {
			t.Errorf("rejected %s: %v", raw, e)
		}
	}
}
