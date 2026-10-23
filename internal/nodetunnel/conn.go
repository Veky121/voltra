// Package nodetunnel carries a TCP byte stream over binary WebSocket messages.
package nodetunnel

import (
	"errors"
	"io"
	"net"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// MaxMessageSize bounds individual data messages on both peers.
const MaxMessageSize = 64 * 1024

type conn struct {
	ws      *websocket.Conn
	readMu  sync.Mutex
	writeMu sync.Mutex
	reader  io.Reader
}

// NewConn takes ownership of ws. Each Write is split into binary messages of at
// most 64 KiB; Read hides message boundaries. Concurrent reads and writes are safe.
// A peer must send binary data messages only. Closing interrupts blocked I/O.
func NewConn(ws *websocket.Conn) net.Conn {
	ws.SetReadLimit(MaxMessageSize)
	return &conn{ws: ws}
}

func (c *conn) Read(p []byte) (int, error) {
	if len(p) == 0 {
		return 0, nil
	}
	c.readMu.Lock()
	defer c.readMu.Unlock()
	for {
		if c.reader == nil {
			kind, r, err := c.ws.NextReader()
			if err != nil {
				if websocket.IsCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway) {
					return 0, io.EOF
				}
				return 0, err
			}
			if kind != websocket.BinaryMessage {
				_ = c.Close()
				return 0, errors.New("tunnel requires binary messages")
			}
			c.reader = r
		}
		n, err := c.reader.Read(p)
		if err == io.EOF {
			c.reader = nil
			if n > 0 {
				return n, nil
			}
			continue
		}
		return n, err
	}
}

func (c *conn) Write(p []byte) (int, error) {
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	written := 0
	for len(p) > 0 {
		n := min(len(p), MaxMessageSize)
		if err := c.ws.WriteMessage(websocket.BinaryMessage, p[:n]); err != nil {
			return written, err
		}
		written += n
		p = p[n:]
	}
	return written, nil
}

func (c *conn) Close() error         { return c.ws.Close() }
func (c *conn) LocalAddr() net.Addr  { return c.ws.UnderlyingConn().LocalAddr() }
func (c *conn) RemoteAddr() net.Addr { return c.ws.UnderlyingConn().RemoteAddr() }
func (c *conn) SetDeadline(t time.Time) error {
	if err := c.SetReadDeadline(t); err != nil {
		return err
	}
	return c.SetWriteDeadline(t)
}
func (c *conn) SetReadDeadline(t time.Time) error { return c.ws.UnderlyingConn().SetReadDeadline(t) }
func (c *conn) SetWriteDeadline(t time.Time) error {
	// Interrupt an in-progress write before taking the writer lock.
	if err := c.ws.UnderlyingConn().SetWriteDeadline(t); err != nil {
		return err
	}
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	return c.ws.SetWriteDeadline(t)
}
