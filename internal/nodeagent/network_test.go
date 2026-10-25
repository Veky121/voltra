package nodeagent

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"github.com/gorilla/websocket"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
	"voltra/internal/nodetunnel"
)

func TestNetworkConnectorAuthenticatedStream(t *testing.T) {
	occupied, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer occupied.Close()
	port := int64(occupied.Addr().(*net.TCPAddr).Port)
	result := make(chan error, 2)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer test-network-secret" {
			w.WriteHeader(401)
			return
		}
		ws, err := (&websocket.Upgrader{}).Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer ws.Close()
		if r.URL.Path == "/api/remote/connector" {
			var hello struct {
				Type         string
				Capabilities []string
			}
			if err = ws.ReadJSON(&hello); err != nil {
				result <- err
				return
			}
			found := false
			for _, cap := range hello.Capabilities {
				if cap == NetworkCapability {
					found = true
				}
			}
			if !found {
				result <- fmt.Errorf("missing network capability")
				return
			}
			if err = ws.WriteJSON(map[string]string{"type": "open", "id": "network-test", "service": "network"}); err != nil {
				result <- err
				return
			}
			for {
				if _, _, err = ws.ReadMessage(); err != nil {
					return
				}
			}
		}
		if r.URL.Path != "/api/remote/connector/streams/network-test" {
			result <- fmt.Errorf("unexpected stream path")
			return
		}
		conn := nodetunnel.NewConn(ws)
		_ = conn.SetDeadline(time.Now().Add(3 * time.Second))
		body, _ := json.Marshal(NetworkProbeRequest{IP: "127.0.0.1", Ports: []int64{port}})
		req, _ := http.NewRequest("POST", "http://node/probe", bytes.NewReader(body))
		if err = req.Write(conn); err != nil {
			result <- err
			return
		}
		resp, err := http.ReadResponse(bufio.NewReader(conn), req)
		if err != nil {
			result <- err
			return
		}
		defer resp.Body.Close()
		var got NetworkProbeResult
		if err = json.NewDecoder(resp.Body).Decode(&got); err != nil {
			result <- err
			return
		}
		if resp.StatusCode != 200 || got.Status != "verified" || len(got.Ports) != 1 || got.Ports[0].TCPAvailable {
			result <- fmt.Errorf("incorrect occupied result: %+v", got)
			return
		}
		result <- nil
	}))
	defer srv.Close()
	base, _ := url.Parse(srv.URL)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	// A deliberately unusable Wings target proves network service bypasses Wings.
	go func() {
		done <- session(ctx, base, Config{PanelURL: srv.URL, Token: "test-network-secret", WingsAddress: "127.0.0.1:1"})
	}()
	select {
	case err = <-result:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("network connector timed out")
	}
	cancel()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("connector did not shut down")
	}
}

func TestNetworkProbeOccupiedAndReleased(t *testing.T) {
	tcp, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer tcp.Close()
	port := int64(tcp.Addr().(*net.TCPAddr).Port)
	udp, err := net.ListenPacket("udp4", tcp.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	defer udp.Close()
	q := NetworkProbeRequest{IP: "127.0.0.1", Ports: []int64{port}}
	got, err := ProbeNetworkPorts(context.Background(), q)
	if err != nil {
		t.Fatal(err)
	}
	if got.Ports[0].TCPAvailable || got.Ports[0].UDPAvailable || got.Ports[0].Reason == "" {
		t.Fatalf("occupied sockets reported free: %+v", got)
	}
	tcp.Close()
	udp.Close()
	got, err = ProbeNetworkPorts(context.Background(), q)
	if err != nil {
		t.Fatal(err)
	}
	if !got.Ports[0].TCPAvailable || !got.Ports[0].UDPAvailable || !got.Snapshot {
		t.Fatalf("released sockets unavailable: %+v", got)
	}
	// A returned positive result must leave no listener behind.
	tcp, err = net.Listen("tcp4", net.JoinHostPort(q.IP, strings.Split(tcp.Addr().String(), ":")[1]))
	if err != nil {
		t.Fatal(err)
	}
	tcp.Close()
}

func TestNetworkRequestBounds(t *testing.T) {
	for _, body := range []string{`{"ip":"example.com","ports":[25565]}`, `{"ip":"127.0.0.1","ports":[22]}`, `{"ip":"127.0.0.1","ports":[25565,25565]}`, `{"ip":"127.0.0.1","ports":[25565],"url":"http://example.com"}`, `{"ip":"127.0.0.1","ports":[25565]} {}`, strings.Repeat(" ", 4097)} {
		w := httptest.NewRecorder()
		networkHandler().ServeHTTP(w, httptest.NewRequest("POST", "/probe", strings.NewReader(body)))
		if w.Code != 400 {
			t.Fatalf("accepted %q: %d", body, w.Code)
		}
	}
	q := NetworkProbeRequest{IP: "127.0.0.1", Ports: make([]int64, 65)}
	if q.Validate() == nil {
		t.Fatal("unbounded count")
	}
	w := httptest.NewRecorder()
	networkHandler().ServeHTTP(w, httptest.NewRequest("GET", "/probe", nil))
	if w.Code != 404 {
		t.Fatal(w.Code)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := ProbeNetworkPorts(ctx, NetworkProbeRequest{IP: "127.0.0.1", Ports: []int64{25565}}); err == nil {
		t.Fatal("cancel ignored")
	}
	w = httptest.NewRecorder()
	networkHandler().ServeHTTP(w, httptest.NewRequest("POST", "/probe", strings.NewReader(`{"ip":"192.0.2.77","ports":[25565]}`)))
	var out NetworkProbeResult
	if json.Unmarshal(w.Body.Bytes(), &out) != nil || len(out.Ports) != 1 || out.Ports[0].TCPAvailable || out.Ports[0].UDPAvailable {
		t.Fatalf("nonlocal bind false success: %s", w.Body)
	}
}
