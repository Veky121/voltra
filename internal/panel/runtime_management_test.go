package panel

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"github.com/gorilla/websocket"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"
	"voltra/internal/nodetunnel"
)

func TestRuntimeSteamConnectorTransport(t *testing.T) {
	a, h, admin := pairingTestApp(t)
	ctx := context.Background()
	insert := func(table string, data M) M {
		row, err := a.insert(ctx, table, data)
		if err != nil {
			t.Fatal(err)
		}
		return row
	}
	loc := insert("locations", M{"short": "runtime-connector"})
	sealed, err := a.seal("runtime-fixture")
	if err != nil {
		t.Fatal(err)
	}
	node := insert("nodes", M{"uuid": newUUID(), "name": "Runtime fixture", "location_id": loc["id"], "fqdn": "127.0.0.1", "daemon_listen": 1, "daemon_token_id": "runtime-fixture", "daemon_token": sealed})
	token := randomToken(32)
	insert("node_connectors", M{"node_id": node["id"], "token_hash": pairingHash(token)})
	panel := httptest.NewServer(h)
	defer panel.Close()
	wsURL := "ws" + strings.TrimPrefix(panel.URL, "http")
	control, _, err := websocket.DefaultDialer.Dial(wsURL+"/api/remote/connector", http.Header{"Authorization": {"Bearer " + token}})
	if err != nil {
		t.Fatal(err)
	}
	defer control.Close()
	if err = control.WriteJSON(M{"type": "hello", "capabilities": []string{"runtime-maintenance-v1"}}); err != nil {
		t.Fatal(err)
	}
	finished := make(chan struct{})
	go func() {
		defer close(finished)
		for {
			var message M
			if control.ReadJSON(&message) != nil {
				return
			}
			if str(message["service"]) != "runtime" {
				t.Error("wrong node service")
				return
			}
			ws, _, err := websocket.DefaultDialer.Dial(wsURL+"/api/remote/connector/streams/"+str(message["id"]), http.Header{"Authorization": {"Bearer " + token}})
			if err != nil {
				t.Error(err)
				return
			}
			stream := nodetunnel.NewConn(ws)
			req, err := http.ReadRequest(bufio.NewReader(stream))
			if err != nil {
				stream.Close()
				t.Error(err)
				return
			}
			var body M
			if json.NewDecoder(req.Body).Decode(&body) != nil {
				t.Error("invalid request body")
			}
			req.Body.Close()
			status := 200
			switch req.URL.Path {
			case "/steamcmd":
				if req.Method != "GET" {
					t.Error("wrong status method")
				}
			case "/steamcmd/check":
				if req.Method != "POST" || len(body) != 0 {
					t.Error("check request leaked inputs")
				}
				status = 202
			case "/steamcmd/schedule":
				if req.Method != "POST" || len(body) != 1 || body["enabled"] != false {
					t.Error("wrong schedule payload")
				}
			default:
				t.Error("wrong runtime path")
			}
			data := []byte(`{"scope":"metadata","supported":true,"busy":false,"version":"1234567890","schedule_enabled":false,"helper_image":"fixture","last_error":"","initialized":true,"recovery_required":false}`)
			fmt.Fprintf(stream, "HTTP/1.1 %d OK\r\nContent-Type: application/json\r\nContent-Length: %d\r\nConnection: close\r\n\r\n", status, len(data))
			stream.Write(data)
			stream.Close()
		}
	}()
	defer func() {
		control.Close()
		select {
		case <-finished:
		case <-time.After(5 * time.Second):
			t.Error("fixture did not stop")
		}
	}()
	waitConnector(t, a, num(node["id"]), nil)
	deadline := time.Now().Add(3 * time.Second)
	for {
		a.connectors().mu.Lock()
		c := a.connectors().controls[num(node["id"])]
		ready := c != nil && c.capabilities["runtime-maintenance-v1"]
		a.connectors().mu.Unlock()
		if ready {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("runtime capability not received")
		}
		time.Sleep(time.Millisecond)
	}
	path := fmt.Sprintf("/api/admin/nodes/%d/runtime/steamcmd", num(node["id"]))
	status := infraExpect(t, h, admin, "GET", path, nil, 200)
	if str(status["version"]) != "1234567890" {
		t.Fatal("version lost in transport")
	}
	infraExpect(t, h, admin, "POST", path, M{"action": "check"}, 202)
	infraExpect(t, h, admin, "POST", path, M{"action": "schedule", "enabled": false}, 200)
}

func TestRuntimeAdminAuthorizationAndProxy(t *testing.T) {
	a, handler, admin := infraTestApp(t)
	ctx := context.Background()
	var calls atomic.Int32
	var legacy atomic.Bool
	wings := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.URL.Path != "/api/runtime-images" || !strings.HasPrefix(r.Header.Get("Authorization"), "Bearer ") {
			t.Error("unexpected daemon request")
			http.Error(w, "bad request", 400)
			return
		}
		if legacy.Load() {
			http.NotFound(w, r)
			return
		}
		if r.Method == "POST" {
			writeJSON(w, 202, M{"status": "accepted"})
			return
		}
		writeJSON(w, 200, M{"version": 1, "images": []M{}})
	}))
	defer wings.Close()
	host, p, _ := net.SplitHostPort(strings.TrimPrefix(wings.URL, "http://"))
	port, _ := strconv.Atoi(p)
	location := asMap(infraExpect(t, handler, admin, "POST", "/api/application/locations", M{"short": "runtime-test"}, 201)["attributes"])
	node := asMap(infraExpect(t, handler, admin, "POST", "/api/application/nodes", M{"name": "Runtime test", "location_id": location["id"], "fqdn": host, "scheme": "http", "memory": 1000, "memory_overallocate": 0, "disk": 2000, "disk_overallocate": 0, "daemon_listen": port, "daemon_sftp": 2022}, 201)["attributes"])
	member, err := a.insert(ctx, "users", M{"uuid": newUUID(), "username": "runtime-member", "email": "runtime-member@example.invalid", "root_admin": false})
	if err != nil {
		t.Fatal(err)
	}
	url := fmt.Sprintf("/api/admin/nodes/%d/runtime/images", num(node["id"]))
	request := M{"action": "check", "reference": "example/java:25"}
	for _, method := range []string{"GET", "POST"} {
		infraExpect(t, handler, 0, method, url, request, 401)
		infraExpect(t, handler, num(member["id"]), method, url, request, 403)
	}
	if calls.Load() != 0 {
		t.Fatal("unauthorized request reached daemon")
	}
	infraExpect(t, handler, admin, "GET", url, nil, 200)
	infraExpect(t, handler, admin, "POST", url, request, 202)
	receipt, err := a.one(ctx, "SELECT count(*) AS count FROM activity_logs WHERE event='admin:runtime:requested'")
	if err != nil || num(receipt["count"]) != 1 {
		t.Fatalf("missing request audit: %v %v", receipt, err)
	}
	if err = a.exec(ctx, "UPDATE nodes SET maintenance_mode=true WHERE id=$1", node["id"]); err != nil {
		t.Fatal(err)
	}
	infraExpect(t, handler, admin, "POST", url, request, 409)
	if calls.Load() != 2 {
		t.Fatal("maintenance mutation reached daemon")
	}
	legacy.Store(true)
	infraExpect(t, handler, admin, "GET", url, nil, 503)
	infraExpect(t, handler, admin, "GET", strings.TrimSuffix(url, "images")+"steamcmd", nil, 503)
}

func TestRuntimeActionValidation(t *testing.T) {
	id := "sha256:" + strings.Repeat("a", 64)
	for _, tc := range []struct {
		kind, body string
		valid      bool
	}{
		{"images", `{"action":"check","reference":"ghcr.io/pterodactyl/yolks:java_25"}`, true},
		{"images", `{"action":"approve","reference":"example/java:25","expected_id":"` + id + `"}`, true},
		{"images", `{"action":"rollback","reference":"example/java:25","expected_id":"` + id + `"}`, true},
		{"images", `{"action":"approve","reference":"example/java:25"}`, false},
		{"images", `{"action":"check","reference":"--privileged"}`, false},
		{"images", `{"action":"check","reference":"https://user:password@registry/image"}`, false},
		{"images", `{"action":"delete","reference":"example/java:25"}`, false},
		{"images", `{"action":"check","reference":"example/java:25","command":"sh"}`, false},
		{"images", `{"action":"check","reference":"example/java:25"} {}`, false},
		{"images", `null`, false},
		{"steamcmd", `{"action":"check"}`, true},
		{"steamcmd", `{"action":"schedule","enabled":false}`, true},
		{"steamcmd", `{"action":"schedule","enabled":true}`, true},
		{"steamcmd", `{"action":"schedule"}`, false},
		{"steamcmd", `{"action":"check","enabled":false}`, false},
		{"images", `{"action":"schedule","reference":"example/java:25","enabled":false}`, true},
		{"images", `{"action":"schedule","reference":"example/java:25","enabled":"false"}`, false},
		{"images", `{"action":"schedule","reference":"example/java:25"}`, false},
		{"steamcmd", `{"action":"check","reference":"other"}`, false},
		{"steamcmd", `{"action":"login"}`, false},
		{"unknown", `{"action":"check"}`, false},
	} {
		t.Run(tc.kind+tc.body, func(t *testing.T) {
			_, err := decodeRuntimeAction(strings.NewReader(tc.body), tc.kind)
			if (err == nil) != tc.valid {
				t.Fatalf("valid=%v error=%v", tc.valid, err)
			}
		})
	}
}

func TestRuntimeResponseBoundaries(t *testing.T) {
	for _, tc := range []struct {
		name, body string
		status     int
		valid      bool
	}{
		{"status", `{"version":1,"images":[]}`, 200, true},
		{"accepted", `{"status":"accepted"}`, 202, true},
		{"null", `null`, 200, false},
		{"truncated", `{"version":`, 200, false},
		{"oversized", `{"message":"` + strings.Repeat("x", 2<<20) + `"}`, 200, false},
		{"busy", `{"error":"secret-node-output"}`, 409, false},
		{"redirect", `{"location":"https://other"}`, 302, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			res := &http.Response{StatusCode: tc.status, Body: io.NopCloser(strings.NewReader(tc.body))}
			_, err := readRuntimeResponse(res)
			if (err == nil) != tc.valid {
				t.Fatalf("valid=%v err=%v", tc.valid, err)
			}
			if err != nil && strings.Contains(err.Error(), "secret-node-output") {
				t.Fatal("remote content leaked")
			}
		})
	}
}

func TestRuntimeStatusRejectsIncompatibleShapes(t *testing.T) {
	for _, raw := range []string{
		`{"version":1,"images":null}`,
		`{"version":2,"images":[]}`,
		`{"version":1,"images":[{"reference":"example:latest","busy":false,"schedule_enabled":true,"error":{},"approved_id":"","candidate_id":"","previous_id":""}]}`,
		`{"version":1,"images":[{"reference":"example:latest","busy":false,"schedule_enabled":true,"error":"","approved_id":"","candidate_id":"","previous_id":"","next_check_at":{}}]}`,
	} {
		var value M
		if err := json.Unmarshal([]byte(raw), &value); err != nil {
			t.Fatal(err)
		}
		if validRuntimeStatus("images", value) {
			t.Fatalf("accepted incompatible status: %s", raw)
		}
	}
}
