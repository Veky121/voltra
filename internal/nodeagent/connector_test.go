package nodeagent

import (
	"bytes"
	"context"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"voltra/internal/nodetunnel"
)

func TestRunReconnectsAndBridgesThenCancels(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	localDone := make(chan struct{})
	go func() {
		defer close(localDone)
		c, err := listener.Accept()
		if err != nil {
			return
		}
		defer c.Close()
		_, _ = io.Copy(c, c)
	}()
	var controls atomic.Int32
	var socketsMu sync.Mutex
	var sockets []*websocket.Conn
	streamResult := make(chan error, 1)
	payload := bytes.Repeat([]byte{0, 255, 1, 7, 4}, 50000)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer connector-test-secret" {
			w.WriteHeader(401)
			return
		}
		ws, err := (&websocket.Upgrader{}).Upgrade(w, r, nil)
		if err != nil {
			return
		}
		socketsMu.Lock()
		sockets = append(sockets, ws)
		socketsMu.Unlock()
		defer ws.Close()
		switch r.URL.Path {
		case "/api/remote/connector":
			if controls.Add(1) == 1 {
				return
			} // Force a real reconnect.
			if err := ws.WriteJSON(map[string]string{"type": "open", "id": "stream-1"}); err != nil {
				return
			}
			for {
				if _, _, err := ws.ReadMessage(); err != nil {
					return
				}
			}
		case "/api/remote/connector/streams/stream-1":
			c := nodetunnel.NewConn(ws)
			_ = c.SetDeadline(time.Now().Add(5 * time.Second))
			go func() {
				_, err := c.Write(payload)
				if err != nil {
					streamResult <- err
				}
			}()
			got := make([]byte, len(payload))
			_, err := io.ReadFull(c, got)
			if err == nil && !bytes.Equal(got, payload) {
				err = io.ErrUnexpectedEOF
			}
			streamResult <- err
			// Hold both halves open until cancellation, then expect EOF/close.
			_, _ = c.Read(make([]byte, 1))
		default:
			t.Errorf("unexpected connector path %s", r.URL.Path)
		}
	}))
	defer srv.Close()
	defer func() {
		socketsMu.Lock()
		defer socketsMu.Unlock()
		for _, ws := range sockets {
			_ = ws.Close()
		}
	}()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() {
		done <- Run(ctx, Config{PanelURL: srv.URL, Token: "connector-test-secret", WingsAddress: listener.Addr().String()})
	}()
	select {
	case err := <-streamResult:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(8 * time.Second):
		t.Fatal("connector did not reconnect and bridge")
	}
	if controls.Load() < 2 {
		t.Fatal("no reconnect occurred")
	}
	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("Run did not join workers on cancellation")
	}
	select {
	case <-localDone:
	case <-time.After(time.Second):
		t.Fatal("local Wings socket remained open")
	}
}

func TestRunRejectsCredentialsAndUnsafeDestinations(t *testing.T) {
	var attempts atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { attempts.Add(1); w.WriteHeader(401) }))
	defer srv.Close()
	err := Run(context.Background(), Config{PanelURL: srv.URL, Token: "secret", WingsAddress: "127.0.0.1:8080"})
	if err != errUnauthorized || attempts.Load() != 1 {
		t.Fatalf("rejected credentials retried or lost: %v", err)
	}
	err = Run(context.Background(), Config{PanelURL: srv.URL, Token: "secret", WingsAddress: "10.0.0.1:8080"})
	if err == nil || attempts.Load() != 1 {
		t.Fatal("accepted non-loopback target")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := Run(ctx, Config{PanelURL: srv.URL, Token: "secret", WingsAddress: "127.0.0.1:8080"}); err != nil {
		t.Fatal(err)
	}
}

func TestRunBoundsStreamsAndIgnoresDuplicateOpen(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	var localMu sync.Mutex
	var local []net.Conn
	go func() {
		for {
			c, err := listener.Accept()
			if err != nil {
				return
			}
			localMu.Lock()
			local = append(local, c)
			localMu.Unlock()
		}
	}()
	defer func() {
		localMu.Lock()
		defer localMu.Unlock()
		for _, c := range local {
			c.Close()
		}
	}()
	var count atomic.Int32
	limitReached := make(chan struct{})
	var socketsMu sync.Mutex
	var sockets []*websocket.Conn
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ws, err := (&websocket.Upgrader{}).Upgrade(w, r, nil)
		if err != nil {
			return
		}
		socketsMu.Lock()
		sockets = append(sockets, ws)
		socketsMu.Unlock()
		defer ws.Close()
		if r.URL.Path == "/api/remote/connector" {
			for i := range maxStreams + 10 {
				for range 2 {
					_ = ws.WriteJSON(map[string]any{"type": "open", "id": strings.Repeat("a", i+1)})
				}
			}
		} else if count.Add(1) == maxStreams {
			close(limitReached)
		}
		for {
			if _, _, err := ws.ReadMessage(); err != nil {
				return
			}
		}
	}))
	defer srv.Close()
	defer func() {
		socketsMu.Lock()
		defer socketsMu.Unlock()
		for _, ws := range sockets {
			ws.Close()
		}
	}()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() {
		done <- Run(ctx, Config{PanelURL: srv.URL, Token: "secret", WingsAddress: listener.Addr().String()})
	}()
	select {
	case <-limitReached:
	case <-time.After(5 * time.Second):
		t.Fatalf("stream limit was not reached: %d", count.Load())
	}
	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("stream limit workers did not stop")
	}
	if count.Load() > maxStreams {
		t.Fatalf("opened %d concurrent streams, limit %d", count.Load(), maxStreams)
	}
}
