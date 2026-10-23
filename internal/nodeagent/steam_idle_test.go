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
	"os"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"voltra/internal/nodetunnel"
	"voltra/internal/steamapi"
)

func TestSteamStreamKeepsIdleExecutorAlive(t *testing.T) {
	if os.Getenv("VOLTRA_STEAM_IDLE_TEST") != "1" {
		t.Skip("set VOLTRA_STEAM_IDLE_TEST=1 to exercise the production HTTP read timeout")
	}
	server, client := net.Pipe()
	defer client.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	runner := testSteamRunner(func(ctx context.Context, _ steamapi.Request, emit func(steamapi.Event) error) {
		select {
		case <-time.After(25 * time.Second):
			_ = emit(steamapi.Event{Type: "result", Stage: "complete", LatestBuild: "200"})
		case <-ctx.Done():
		}
	})
	done := make(chan error, 1)
	go func() { done <- serveSteam(ctx, server, runner) }()
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
	dec := json.NewDecoder(resp.Body)
	terminal := 0
	for {
		var event steamapi.Event
		err := dec.Decode(&event)
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		if event.Type == "error" {
			t.Fatal(event)
		}
		if event.Type == "result" {
			terminal++
		}
	}
	if terminal != 1 {
		t.Fatalf("wanted one result after idle execution, got %d", terminal)
	}
	if err := <-done; err != nil {
		t.Fatal(err)
	}
}

func TestSteamBridgeKeepsLongIdleExecutorAlive(t *testing.T) {
	if os.Getenv("VOLTRA_STEAM_IDLE_TEST") != "1" {
		t.Skip("set VOLTRA_STEAM_IDLE_TEST=1 for long connector idle regression")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 180*time.Second)
	defer cancel()
	result := make(chan error, 1)
	runner := testSteamRunner(func(ctx context.Context, _ steamapi.Request, emit func(steamapi.Event) error) {
		select {
		case <-time.After(150 * time.Second):
			_ = emit(steamapi.Event{Type: "result", Stage: "complete", LatestBuild: "200"})
		case <-ctx.Done():
		}
	})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ws, err := (&websocket.Upgrader{}).Upgrade(w, r, nil)
		if err != nil {
			result <- err
			return
		}
		defer ws.Close()
		if r.URL.Path == "/api/remote/connector" {
			if _, _, err = ws.ReadMessage(); err != nil {
				result <- err
				return
			}
			_ = ws.WriteJSON(map[string]string{"type": "open", "id": "idle-steam-stream", "service": "steam"})
			for {
				if _, _, err = ws.ReadMessage(); err != nil {
					return
				}
			}
		}
		c := nodetunnel.NewConn(ws)
		_ = c.SetDeadline(time.Now().Add(170 * time.Second))
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
		for {
			var event steamapi.Event
			if err = dec.Decode(&event); err != nil {
				result <- err
				return
			}
			if event.Type == "error" {
				result <- fmt.Errorf("terminal error: %s", event.Error)
				return
			}
			if event.Type == "result" {
				result <- nil
				return
			}
		}
	}))
	defer srv.Close()
	base, _ := url.Parse(srv.URL)
	done := make(chan error, 1)
	go func() {
		done <- sessionWithSteam(ctx, base, Config{Token: "TEST", WingsAddress: "127.0.0.1:1"}, runner)
	}()
	select {
	case err := <-result:
		if err != nil {
			t.Fatal(err)
		}
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	cancel()
	<-done
}
