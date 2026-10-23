package nodeagent

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"reflect"
	"runtime"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"voltra/internal/nodetunnel"
	"voltra/internal/steamapi"
)

type testSteamRunner func(context.Context, steamapi.Request, func(steamapi.Event) error)

func (f testSteamRunner) Run(ctx context.Context, r steamapi.Request, emit func(steamapi.Event) error) {
	f(ctx, r, emit)
}
func steamRequest() steamapi.Request {
	return steamapi.Request{JobID: "11111111-1111-1111-1111-111111111111", ServerUUID: "22222222-2222-2222-2222-222222222222", AppID: 2394010, Operation: "check", Branch: "public"}
}

func TestSteamHTTPRejectsUntrustedInput(t *testing.T) {
	var calls atomic.Int32
	h := steamHandler(testSteamRunner(func(context.Context, steamapi.Request, func(steamapi.Event) error) { calls.Add(1) }))
	body, _ := json.Marshal(steamRequest())
	for _, test := range []struct {
		method, path, body string
		status             int
	}{
		{"GET", "/run", string(body), 404}, {"POST", "/run?path=/host", string(body), 404}, {"POST", "/else", string(body), 404},
		{"POST", "/run", strings.TrimSuffix(string(body), "}") + `,"command":"rm -rf /"}`, 400},
		{"POST", "/run", string(body) + "{}", 400}, {"POST", "/run", "null", 400}, {"POST", "/run", strings.Repeat("x", 5000), 400},
	} {
		t.Run(fmt.Sprintf("%s/%d", test.path, test.status), func(t *testing.T) {
			w := httptest.NewRecorder()
			h.ServeHTTP(w, httptest.NewRequest(test.method, test.path, strings.NewReader(test.body)))
			if w.Code != test.status {
				t.Fatal(w.Code, w.Body.String())
			}
			var ev steamapi.Event
			if json.Unmarshal(w.Body.Bytes(), &ev) != nil || ev.Type != "error" {
				t.Fatal("missing terminal error")
			}
		})
	}
	if calls.Load() != 0 {
		t.Fatal("invalid requests reached executor")
	}
}

func TestSteamStreamFlushesBeforeCompletionAndClosesAfterOneRequest(t *testing.T) {
	server, client := net.Pipe()
	defer client.Close()
	progressRead := make(chan struct{})
	runner := testSteamRunner(func(ctx context.Context, r steamapi.Request, emit func(steamapi.Event) error) {
		if r != steamRequest() {
			t.Error("wrong request", r)
		}
		_ = emit(steamapi.Event{Type: "progress", Stage: "metadata", Detail: "loading"})
		select {
		case <-progressRead:
		case <-ctx.Done():
			return
		}
		_ = emit(steamapi.Event{Type: "result", Stage: "complete", LatestBuild: "200"})
	})
	done := make(chan error, 1)
	go func() { done <- serveSteam(context.Background(), server, runner) }()
	body, _ := json.Marshal(steamRequest())
	req, _ := http.NewRequest("POST", "http://node/run", bytes.NewReader(body))
	if err := req.Write(client); err != nil {
		t.Fatal(err)
	}
	resp, err := http.ReadResponse(bufio.NewReader(client), req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 || resp.Header.Get("Content-Type") != "application/x-ndjson" {
		t.Fatal(resp.Status, resp.Header)
	}
	dec := json.NewDecoder(resp.Body)
	var ev steamapi.Event
	if err = dec.Decode(&ev); err != nil || ev.Type != "progress" {
		t.Fatal("first event was not flushed", ev, err)
	}
	close(progressRead)
	if err = dec.Decode(&ev); err != nil || ev.Type != "result" {
		t.Fatal(ev, err)
	}
	if err = dec.Decode(&ev); err != io.EOF {
		t.Fatal("extra event", err)
	}
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("single stream server did not close")
	}
}

func TestSteamStreamCancellationJoinsRunner(t *testing.T) {
	for _, disconnect := range []bool{false, true} {
		t.Run(fmt.Sprint(disconnect), func(t *testing.T) {
			server, client := net.Pipe()
			defer client.Close()
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			started := make(chan struct{})
			cleaned := make(chan struct{})
			runner := testSteamRunner(func(ctx context.Context, _ steamapi.Request, _ func(steamapi.Event) error) {
				close(started)
				<-ctx.Done()
				time.Sleep(20 * time.Millisecond)
				close(cleaned)
			})
			done := make(chan error, 1)
			go func() { done <- serveSteam(ctx, server, runner) }()
			body, _ := json.Marshal(steamRequest())
			req, _ := http.NewRequest("POST", "http://node/run", bytes.NewReader(body))
			if err := req.Write(client); err != nil {
				t.Fatal(err)
			}
			response, err := http.ReadResponse(bufio.NewReader(client), req)
			if err != nil {
				t.Fatal(err)
			}
			defer response.Body.Close()
			<-started
			if disconnect {
				_ = client.Close()
			} else {
				cancel()
			}
			select {
			case <-done:
				select {
				case <-cleaned:
				default:
					t.Fatal("server returned before helper cleanup")
				}
			case <-time.After(time.Second):
				t.Fatal("disconnect did not cancel helper")
			}
		})
	}
}

func TestConnectorAdvertisesAndRoutesSteamWithoutWings(t *testing.T) {
	result := make(chan error, 1)
	hello := make(chan []string, 1)
	runner := testSteamRunner(func(_ context.Context, _ steamapi.Request, emit func(steamapi.Event) error) {
		_ = emit(steamapi.Event{Type: "progress", Stage: "metadata"})
		_ = emit(steamapi.Event{Type: "result", Stage: "complete", LatestBuild: "200"})
	})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer TEST_CONNECTOR_SECRET" {
			w.WriteHeader(401)
			return
		}
		ws, err := (&websocket.Upgrader{}).Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer ws.Close()
		if r.URL.Path == "/api/remote/connector" {
			var msg struct {
				Type         string
				Capabilities []string
			}
			if err = ws.ReadJSON(&msg); err != nil {
				result <- err
				return
			}
			if msg.Type != "hello" {
				result <- fmt.Errorf("missing hello")
				return
			}
			hello <- msg.Capabilities
			_ = ws.WriteJSON(map[string]string{"type": "open", "id": "steam-stream", "service": "steam"})
			for {
				if _, _, err = ws.ReadMessage(); err != nil {
					return
				}
			}
		}
		c := nodetunnel.NewConn(ws)
		_ = c.SetDeadline(time.Now().Add(3 * time.Second))
		body, _ := json.Marshal(steamRequest())
		req, _ := http.NewRequest("POST", "http://node/run", bytes.NewReader(body))
		if err = req.Write(c); err != nil {
			result <- err
			return
		}
		resp, err := http.ReadResponse(bufio.NewReader(c), req)
		if err != nil {
			result <- err
			return
		}
		defer resp.Body.Close()
		dec := json.NewDecoder(resp.Body)
		var ev steamapi.Event
		for {
			if err = dec.Decode(&ev); err != nil {
				result <- err
				return
			}
			if ev.Type == "result" {
				result <- nil
				return
			}
		}
	}))
	defer srv.Close()
	base, _ := url.Parse(srv.URL)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	// Deliberately unusable Wings address proves service=steam never dials it.
	go func() {
		done <- sessionWithSteam(ctx, base, Config{PanelURL: srv.URL, Token: "TEST_CONNECTOR_SECRET", WingsAddress: "127.0.0.1:1"}, runner)
	}()
	select {
	case got := <-hello:
		want := []string{}
		if runtime.GOOS == "linux" && runtime.GOARCH == "amd64" {
			want = []string{steamapi.Capability}
		}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("capabilities %v want %v", got, want)
		}
	case <-time.After(time.Second):
		t.Fatal("missing hello")
	}
	select {
	case err := <-result:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(4 * time.Second):
		t.Fatal("Steam connector stream failed")
	}
	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("connector did not join Steam worker")
	}
}
