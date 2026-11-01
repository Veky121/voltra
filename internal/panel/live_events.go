package panel

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/jackc/pgx/v5"
)

// First slice: account-local invalidations only. No server payloads, commands,
// telemetry, replay, or cross-process delivery are exposed by this transport.
type liveEventHub struct {
	mu      sync.Mutex
	clients map[int64]map[chan struct{}]struct{}
	total   int
	closed  bool
	done    chan struct{}
}

func (h *liveEventHub) subscribe(userID int64) (<-chan struct{}, <-chan struct{}, func(), bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.closed || userID <= 0 || h.total >= 512 || len(h.clients[userID]) >= 8 {
		return nil, nil, nil, false
	}
	if h.clients == nil {
		h.clients = make(map[int64]map[chan struct{}]struct{})
		h.done = make(chan struct{})
	}
	if h.clients[userID] == nil {
		h.clients[userID] = make(map[chan struct{}]struct{})
	}
	ch := make(chan struct{}, 1)
	h.clients[userID][ch] = struct{}{}
	h.total++
	var once sync.Once
	unsubscribe := func() {
		once.Do(func() {
			h.mu.Lock()
			defer h.mu.Unlock()
			delete(h.clients[userID], ch)
			if len(h.clients[userID]) == 0 {
				delete(h.clients, userID)
			}
			h.total--
		})
	}
	return ch, h.done, unsubscribe, true
}

func (h *liveEventHub) navigationChanged(userID int64) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.closed {
		return
	}
	for ch := range h.clients[userID] {
		select {
		case ch <- struct{}{}:
		default:
		}
	} // Coalesce slow readers.
}
func (h *liveEventHub) close() {
	h.mu.Lock()
	defer h.mu.Unlock()
	if !h.closed {
		h.closed = true
		if h.done != nil {
			close(h.done)
		}
	}
}

func (a *App) liveEventOrigin(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return strings.HasPrefix(pairingBearer(r), desktopTokenPrefix)
	}
	u, err := url.Parse(origin)
	if err != nil || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Path != "" || (u.Scheme != "http" && u.Scheme != "https") {
		return false
	}
	if u.Host == r.Host {
		return true
	}
	return a.Config.DevMode && loopbackRequest(r) && (origin == "http://localhost:5180" || origin == "http://127.0.0.1:5180")
}

// Recheck credentials before every event and heartbeat. A socket must not keep
// the identity captured at upgrade after logout, expiry, disablement or revoke.
// Scoped machine API keys are intentionally unsupported in this first slice.
func (a *App) liveEventIdentity(r *http.Request) (int64, error) {
	developmentID := UserID(r)
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	r = WithUser(r.WithContext(ctx), 0)
	setup, err := a.setupState(ctx)
	if err != nil {
		return 0, err
	}
	if !a.liveEventOrigin(r) || !a.browserOrigin(r, setup) {
		return 0, forbidden()
	}
	localOnly := a.Config.DevMode && !setup.Completed || setup.Completed && setup.AccessMode == "local"
	if localOnly && !developmentHost(r) {
		return 0, forbidden()
	}
	var maintenance bool
	err = a.DB.QueryRow(ctx, "SELECT COALESCE(value::text,'false')::boolean FROM settings WHERE key='app.maintenance'").Scan(&maintenance)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return 0, err
	}
	if maintenance {
		return 0, forbidden()
	}
	if strings.HasPrefix(pairingBearer(r), desktopTokenPrefix) {
		r, err = a.authenticateDesktop(r)
	} else if r.Header.Get("Authorization") != "" {
		return 0, forbidden()
	} else if a.cloudflareBrowserRequest(r) {
		if !setup.Completed {
			return 0, forbidden()
		}
		r, err = a.authenticateCloudflare(r)
	} else {
		var id int64
		id, err = a.sessionUser(r)
		if err == nil && id > 0 {
			r = WithUser(r, id)
		} else if err == nil && a.Config.DevMode && !setup.Completed && loopbackRequest(r) {
			// The outer handler validated any development identity override.
			r = WithUser(r, developmentID)
		}
	}
	if err != nil {
		return 0, err
	}
	u, err := a.user(r)
	if err != nil {
		return 0, err
	}
	return num(u["id"]), nil
}

func (a *App) clientLiveEvents(w http.ResponseWriter, r *http.Request) {
	if !a.liveEventOrigin(r) {
		fail(w, forbidden())
		return
	}
	id, err := a.liveEventIdentity(r)
	if err != nil {
		fail(w, err)
		return
	}
	events, shutdown, unsubscribe, ok := a.liveEvents.subscribe(id)
	if !ok {
		fail(w, APIError{429, "LiveConnectionLimit", "Too many live connections. Retry later."})
		return
	}
	defer unsubscribe()
	upgrader := websocket.Upgrader{CheckOrigin: a.liveEventOrigin, HandshakeTimeout: 5 * time.Second}
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()
	conn.SetReadLimit(16384)
	_ = conn.SetReadDeadline(time.Now().Add(45 * time.Second))
	conn.SetPongHandler(func(string) error { return conn.SetReadDeadline(time.Now().Add(45 * time.Second)) })
	disconnected := make(chan struct{})
	commands := make(chan liveSubscriptionRequest, 1)
	updates := make(chan liveDelivery, 64)
	bindings := map[string]*liveBinding{}
	defer func() {
		for _, b := range bindings {
			b.cancel()
		}
	}()
	go func() {
		defer close(disconnected)
		defer conn.Close()
		var last time.Time
		for {
			var message liveSubscriptionRequest
			if conn.ReadJSON(&message) != nil {
				return
			}
			if message.Type != "subscribe" || len(message.Paths) > 64 || time.Since(last) < 25*time.Millisecond {
				return
			}
			last = time.Now()
			select {
			case commands <- message:
			default:
				select {
				case <-commands:
				default:
				}
				select {
				case commands <- message:
				default:
				}
			}
		}
	}()
	write := func(kind string) error {
		_ = conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
		packet := M{"type": kind, "version": 1}
		if kind == "ready" {
			packet["capabilities"] = []string{"snapshots"}
		}
		return conn.WriteJSON(packet)
	}
	if err = write("ready"); err != nil {
		return
	}
	ticker := time.NewTicker(20 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-shutdown:
			return
		case <-disconnected:
			return
		case command := <-commands:
			current, e := a.liveEventIdentity(r)
			if e != nil || current != id {
				return
			}
			wanted := map[string]bool{}
			for _, path := range command.Paths {
				wanted[path] = true
			}
			for path, b := range bindings {
				if !wanted[path] {
					b.cancel()
					delete(bindings, path)
				}
			}
			ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
			for _, path := range command.Paths {
				if b, exists := bindings[path]; exists {
					b.revision = command.Revision
					b.lastDigest = "" // New consumers need a full snapshot, not just a heartbeat.
					continue
				}
				topic, valid := a.liveTopic(path)
				if !valid {
					continue
				}
				server, err := a.authorizeLiveTopic(r.WithContext(ctx), topic, id)
				if err != nil {
					continue
				}
				if topic.event == "server.resources" {
					topic.server = str(server["uuid"])
				}
				binding := &liveBinding{path: path, revision: command.Revision, topic: topic, updates: updates}
				if a.watchLiveTopic(topic, id, binding) {
					bindings[path] = binding
				}
			}
			cancel()
		case update := <-updates:
			b := update.binding
			if bindings[b.path] != b {
				continue
			}
			if time.Since(update.sample.sampledAt) > 10*time.Second {
				continue
			}
			current, e := a.liveEventIdentity(r)
			if e != nil || current != id {
				return
			}
			ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
			_, accessErr := a.authorizeLiveTopic(r.WithContext(ctx), b.topic, id)
			cancel()
			sample := update.sample
			// Membership can change after a shared account-list sample was read.
			// Build this small list against current access immediately before send.
			if accessErr == nil && b.topic.event == "servers.state" {
				sample = a.loadLiveSample(r.Context(), b.topic, id)
			}
			if accessErr != nil {
				sample = liveSample{status: 403, data: json.RawMessage(`{"errors":[{"detail":"Access changed. Refresh this view."}]}`)}
			}
			_ = conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
			packet := M{"type": "snapshot", "event": b.topic.event, "version": 1, "path": b.path, "revision": b.revision, "status": sample.status, "data": sample.data}
			if b.topic.event == "server.updated" && sample.status == 200 {
				digest := string(sample.data)
				packet["type"] = "invalidated"
				delete(packet, "data")
				if b.lastDigest == digest {
					packet["type"] = "unchanged"
				}
				b.lastDigest = digest
			} else if b.topic.event != "server.resources" && sample.status == 200 {
				sum := sha256.Sum256(sample.data)
				digest := hex.EncodeToString(sum[:])
				if b.lastDigest == digest {
					packet["type"] = "unchanged"
					delete(packet, "data")
				}
				b.lastDigest = digest
			}
			if conn.WriteJSON(packet) != nil {
				return
			}
			if accessErr != nil {
				b.cancel()
				delete(bindings, b.path)
			}
		case <-events:
			current, e := a.liveEventIdentity(r)
			if e != nil || current != id {
				return
			}
			if write("navigation.invalidated") != nil {
				return
			}
		case <-ticker.C:
			current, e := a.liveEventIdentity(r)
			if e != nil || current != id {
				return
			}
			if conn.WriteControl(websocket.PingMessage, nil, time.Now().Add(5*time.Second)) != nil {
				return
			}
		}
	}
}
