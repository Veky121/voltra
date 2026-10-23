package nodetunnel

import (
	"bytes"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func pair(t *testing.T) (*websocket.Conn, *websocket.Conn) {
	t.Helper()
	accepted := make(chan *websocket.Conn, 1)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ws, err := (&websocket.Upgrader{}).Upgrade(w, r, nil)
		if err == nil {
			accepted <- ws
		}
	}))
	t.Cleanup(srv.Close)
	client, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(srv.URL, "http"), nil)
	if err != nil {
		t.Fatal(err)
	}
	server := <-accepted
	t.Cleanup(func() { client.Close(); server.Close() })
	return client, server
}

func TestByteStreamChunkingAndBoundaries(t *testing.T) {
	client, server := pair(t)
	c := NewConn(client)
	_ = c.SetDeadline(time.Now().Add(5 * time.Second))
	payload := bytes.Repeat([]byte{0, 255, 3, 1, 6}, MaxMessageSize)
	result := make(chan error, 1)
	go func() {
		var received []byte
		for len(received) < len(payload) {
			kind, p, err := server.ReadMessage()
			if err != nil {
				result <- err
				return
			}
			if kind != websocket.BinaryMessage || len(p) > MaxMessageSize {
				result <- io.ErrUnexpectedEOF
				return
			}
			received = append(received, p...)
		}
		if !bytes.Equal(payload, received) {
			result <- io.ErrUnexpectedEOF
			return
		}
		// Return the same bytes in unrelated message boundaries, including empty.
		_ = server.WriteMessage(websocket.BinaryMessage, nil)
		for len(received) > 0 {
			n := min(len(received), 7919)
			if err := server.WriteMessage(websocket.BinaryMessage, received[:n]); err != nil {
				result <- err
				return
			}
			received = received[n:]
		}
		result <- nil
	}()
	if n, err := c.Write(payload); err != nil || n != len(payload) {
		t.Fatalf("write: %d %v", n, err)
	}
	got := make([]byte, len(payload))
	if _, err := io.ReadFull(c, got); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, payload) {
		t.Fatal("stream changed binary bytes")
	}
	if err := <-result; err != nil {
		t.Fatal(err)
	}
}

func TestCloseInterruptsBlockedRead(t *testing.T) {
	ws, _ := pair(t)
	c := NewConn(ws)
	done := make(chan error, 1)
	go func() { var p [1]byte; _, err := c.Read(p[:]); done <- err }()
	if err := c.Close(); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("read succeeded after close")
		}
	case <-time.After(time.Second):
		t.Fatal("close did not interrupt read")
	}
}

func TestReadDeadlineAndTextRejection(t *testing.T) {
	t.Run("deadline", func(t *testing.T) {
		ws, _ := pair(t)
		c := NewConn(ws)
		_ = c.SetReadDeadline(time.Now().Add(20 * time.Millisecond))
		_, err := c.Read(make([]byte, 1))
		nerr, ok := err.(net.Error)
		if !ok || !nerr.Timeout() {
			t.Fatalf("expected timeout, got %v", err)
		}
	})
	t.Run("text", func(t *testing.T) {
		ws, peer := pair(t)
		c := NewConn(ws)
		_ = c.SetReadDeadline(time.Now().Add(time.Second))
		if err := peer.WriteMessage(websocket.TextMessage, []byte("not binary")); err != nil {
			t.Fatal(err)
		}
		if _, err := c.Read(make([]byte, 1)); err == nil {
			t.Fatal("accepted a text message")
		}
	})
	t.Run("oversized", func(t *testing.T) {
		ws, peer := pair(t)
		c := NewConn(ws)
		_ = c.SetReadDeadline(time.Now().Add(time.Second))
		_ = peer.WriteMessage(websocket.BinaryMessage, make([]byte, MaxMessageSize+1))
		if _, err := io.Copy(io.Discard, c); err == nil {
			t.Fatal("accepted oversized message")
		}
	})
}

func TestWriteDeadlineInterruptsBlockedWrite(t *testing.T) {
	ws, _ := pair(t)
	c := NewConn(ws)
	done := make(chan error, 1)
	go func() { _, err := c.Write(make([]byte, 32*1024*1024)); done <- err }()
	// The peer does not read. Setting a deadline must interrupt an existing
	// write rather than waiting forever for the writer mutex.
	if err := c.SetWriteDeadline(time.Now().Add(50 * time.Millisecond)); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("write unexpectedly completed")
		}
	case <-time.After(3 * time.Second):
		t.Fatal("write deadline failed to interrupt")
	}
}
