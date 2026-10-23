package panel

import (
	"context"
	"errors"
	"net"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"voltra/internal/nodetunnel"
	"voltra/internal/steamapi"
)

type connectorControl struct {
	socket         *websocket.Conn
	token          string
	nodeID         int64
	write          sync.Mutex
	done           chan struct{}
	once           sync.Once
	streams        map[net.Conn]struct{}
	health         M
	healthAt       time.Time
	healthChecking bool
	capabilities   map[string]bool
}
type connectorPending struct {
	control *connectorControl
	result  chan net.Conn
	done    <-chan struct{}
}
type connectorHub struct {
	mu       sync.Mutex
	controls map[int64]*connectorControl
	pending  map[string]*connectorPending
	closed   bool
}

var connectorInitialization sync.Mutex

func (a *App) connectors() *connectorHub {
	connectorInitialization.Lock()
	defer connectorInitialization.Unlock()
	if a.connectorHub == nil {
		a.connectorHub = &connectorHub{controls: make(map[int64]*connectorControl), pending: make(map[string]*connectorPending)}
	}
	return a.connectorHub
}
func (h *connectorHub) connected(id int64) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.controls[id] != nil
}
func (h *connectorHub) stop(c *connectorControl) {
	c.once.Do(func() {
		close(c.done)
		_ = c.socket.Close()
		h.mu.Lock()
		if h.controls[c.nodeID] == c {
			delete(h.controls, c.nodeID)
		}
		streams := make([]net.Conn, 0, len(c.streams))
		for conn := range c.streams {
			streams = append(streams, conn)
		}
		h.mu.Unlock()
		for _, conn := range streams {
			_ = conn.Close()
		}
	})
}
func (h *connectorHub) disconnect(id int64) {
	h.mu.Lock()
	c := h.controls[id]
	h.mu.Unlock()
	if c != nil {
		h.stop(c)
	}
}
func (h *connectorHub) close() {
	h.mu.Lock()
	h.closed = true
	all := make([]*connectorControl, 0, len(h.controls))
	for _, c := range h.controls {
		all = append(all, c)
	}
	h.mu.Unlock()
	for _, c := range all {
		h.stop(c)
	}
}
func (a *App) connectNodeConnector(w http.ResponseWriter, r *http.Request) {
	token := pairingBearer(r)
	id, e := a.connectorNode(r.Context(), token)
	if e != nil {
		fail(w, e)
		return
	}
	// Machine connections never use a browser cookie or Origin.
	if r.Header.Get("Origin") != "" {
		fail(w, forbidden())
		return
	}
	socket, e := (&websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}).Upgrade(w, r, nil)
	if e != nil {
		return
	}
	c := &connectorControl{socket: socket, nodeID: id, token: token, done: make(chan struct{}), streams: make(map[net.Conn]struct{})}
	h := a.connectors()
	h.mu.Lock()
	old := h.controls[id]
	if !h.closed {
		h.controls[id] = c
	}
	closed := h.closed
	h.mu.Unlock()
	if closed {
		_ = socket.Close()
		return
	}
	if old != nil {
		h.stop(old)
	}
	defer h.stop(c)
	socket.SetReadLimit(4096)
	_ = socket.SetReadDeadline(time.Now().Add(75 * time.Second))
	socket.SetPongHandler(func(string) error { return socket.SetReadDeadline(time.Now().Add(75 * time.Second)) })
	// Revalidate revocation/deletion even on an idle connection.
	go func() {
		ticker := time.NewTicker(20 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-c.done:
				return
			case <-ticker.C:
				ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				valid := a.validConnector(ctx, id, token)
				cancel()
				if !valid || socket.WriteControl(websocket.PingMessage, nil, time.Now().Add(5*time.Second)) != nil {
					h.stop(c)
					return
				}
			}
		}
	}()
	for {
		var message struct {
			Type         string   `json:"type"`
			Capabilities []string `json:"capabilities"`
		}
		if e = socket.ReadJSON(&message); e != nil {
			return
		}
		if message.Type == "hello" {
			h.mu.Lock()
			c.capabilities = map[string]bool{}
			for _, capability := range message.Capabilities {
				if steamapi.KnownCapability(capability) {
					c.capabilities[capability] = true
				}
			}
			h.mu.Unlock()
		}
	}
}

type connectorStream struct {
	net.Conn
	hub     *connectorHub
	control *connectorControl
	once    sync.Once
}

func (c *connectorStream) Close() error {
	err := c.Conn.Close()
	c.once.Do(func() { c.hub.mu.Lock(); delete(c.control.streams, c); c.hub.mu.Unlock() })
	return err
}
func (a *App) connectNodeStream(w http.ResponseWriter, r *http.Request) {
	id, e := a.connectorNode(r.Context(), pairingBearer(r))
	if e != nil {
		fail(w, e)
		return
	}
	if r.Header.Get("Origin") != "" {
		fail(w, forbidden())
		return
	}
	h := a.connectors()
	key := r.PathValue("stream")
	h.mu.Lock()
	p := h.pending[key]
	if p == nil || p.control.nodeID != id || h.controls[id] != p.control {
		h.mu.Unlock()
		fail(w, notFound())
		return
	}
	// Claim exactly once before upgrade; repeated or cross-node IDs are rejected.
	delete(h.pending, key)
	h.mu.Unlock()
	socket, e := (&websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}).Upgrade(w, r, nil)
	if e != nil {
		return
	}
	socket.SetReadLimit(nodetunnel.MaxMessageSize)
	conn := &connectorStream{Conn: nodetunnel.NewConn(socket), hub: h, control: p.control}
	h.mu.Lock()
	select {
	case <-p.control.done:
		h.mu.Unlock()
		_ = conn.Close()
		return
	default:
	}
	p.control.streams[conn] = struct{}{}
	h.mu.Unlock()
	select {
	case p.result <- conn:
	case <-p.control.done:
		_ = conn.Close()
	case <-r.Context().Done():
		_ = conn.Close()
	case <-p.done:
		_ = conn.Close()
	}
}
func (a *App) dialNodeConnector(ctx context.Context, id int64) (net.Conn, error) {
	return a.dialNodeService(ctx, id, "")
}
func (a *App) dialNodeService(ctx context.Context, id int64, service string) (net.Conn, error) {
	h := a.connectors()
	h.mu.Lock()
	c := h.controls[id]
	if c == nil || len(c.streams) >= 256 || len(h.pending) >= 2048 {
		h.mu.Unlock()
		return nil, errors.New("node connector is offline or at its connection limit")
	}
	if service != "" && (service != "steam" || !c.capabilities["steam-v1"]) {
		h.mu.Unlock()
		return nil, errors.New("update and reconnect the node agent to enable Steam maintenance")
	}
	h.mu.Unlock()
	if !a.validConnector(ctx, id, c.token) {
		h.stop(c)
		return nil, errors.New("node connector access was revoked")
	}
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	key := randomToken(24)
	p := &connectorPending{control: c, result: make(chan net.Conn), done: ctx.Done()}
	h.mu.Lock()
	h.pending[key] = p
	h.mu.Unlock()
	defer func() { h.mu.Lock(); delete(h.pending, key); h.mu.Unlock() }()
	c.write.Lock()
	_ = c.socket.SetWriteDeadline(time.Now().Add(5 * time.Second))
	e := c.socket.WriteJSON(M{"type": "open", "id": key, "service": service})
	c.write.Unlock()
	if e != nil {
		h.stop(c)
		return nil, errors.New("node connector disconnected")
	}
	select {
	case conn := <-p.result:
		return conn, nil
	case <-c.done:
		return nil, errors.New("node connector disconnected")
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}
func (a *App) connectorTransport(node M) http.RoundTripper {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil
	transport.DisableKeepAlives = true
	transport.DialContext = func(ctx context.Context, network, address string) (net.Conn, error) {
		return a.dialNodeConnector(ctx, num(node["id"]))
	}
	return transport
}
