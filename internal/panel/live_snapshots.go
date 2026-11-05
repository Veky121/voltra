package panel

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

type liveTopic struct {
	path, server, event string
	consoleAfter        string
	interval            time.Duration
	handler             http.HandlerFunc
}
type liveSample struct {
	sampledAt time.Time
	data      json.RawMessage
	status    int
}
type liveDelivery struct {
	binding    *liveBinding
	sample     liveSample
	generation uint64
}
type liveBinding struct {
	lastDigest     string
	lastGeneration uint64
	lastSent       time.Time
	path           string
	revision       uint64
	topic          liveTopic
	updates        chan liveDelivery
	cancel         func()
	resync         chan struct{}
	worker         *liveSnapshotWorker
}
type liveSnapshotWorker struct {
	topic      liveTopic
	generation uint64
	user       int64
	cancel     context.CancelFunc
	wake       chan struct{}
	bindings   map[*liveBinding]struct{}
	last       *liveSample
}
type liveSnapshotHub struct {
	mu      sync.Mutex
	workers map[string]*liveSnapshotWorker
	slots   chan struct{}
	closed  bool
}
type liveSubscriptionRequest struct {
	Type     string   `json:"type"`
	Paths    []string `json:"paths"`
	Revision uint64   `json:"revision"`
	Domains  []string `json:"domains,omitempty"`
}

// Exact allowlist, with no arbitrary handler dispatch, file contents, startup
// variables, private Steam credentials, downloads, or command execution.
func (a *App) liveTopic(path string) (liveTopic, bool) {
	t := liveTopic{path: path, interval: 60 * time.Second}
	if path == "/api/client?summary=overview&states=1" {
		t.handler = a.clientServers
		t.event = "servers.state"
		t.interval = 15 * time.Second
		return t, true
	}
	u, err := url.ParseRequestURI(path)
	if err != nil || u.Fragment != "" || u.EscapedPath() != u.Path || len(path) > 2048 {
		return t, false
	}
	parts := strings.Split(strings.TrimPrefix(u.Path, "/api/client/servers/"), "/")
	if !strings.HasPrefix(path, "/api/client/servers/") || len(parts) < 1 || len(parts) > 3 || parts[0] == "" || strings.ContainsAny(parts[0], "%.\\") {
		return t, false
	}
	if !liveQueryAllowed(parts, u.Query()) {
		return t, false
	}
	t.server = parts[0]
	if len(parts) == 3 {
		if parts[1] != "files" || parts[2] != "list" {
			return t, false
		}
		t.handler = a.clientFiles
		t.event = "files.updated"
		t.interval = 15 * time.Second
		return t, true
	}
	if len(parts) == 1 {
		t.handler = a.clientServerDetail
		t.event = "server.updated"
		return t, true
	}
	switch parts[1] {
	case "console-history":
		t.handler = a.clientConsoleStream
		t.event = "console.entries"
		t.interval = time.Second
	case "resources":
		t.handler = a.clientResources
		t.event = "server.resources"
		t.interval = time.Second
	case "steam":
		t.handler = a.clientSteamStatus
		t.event = "jobs.updated"
		t.interval = 60 * time.Second
	case "users":
		t.handler = a.collabUsers
		t.event = "users.updated"
	case "backups":
		t.handler = a.clientBackups
		t.event = "backups.updated"
	case "schedules":
		t.handler = a.collabSchedules
		t.event = "schedules.updated"
	case "activity":
		t.handler = a.collabActivity
		t.event = "activity.updated"
	default:
		return t, false
	}
	return t, true
}

func (a *App) authorizeLiveTopic(r *http.Request, t liveTopic, user int64) (M, error) {
	copy := r.Clone(r.Context())
	copy = WithUser(copy, user)
	u, _ := url.Parse(t.path)
	copy.URL = u
	copy.Method = http.MethodGet
	copy.SetPathValue("server", t.server)
	if t.server == "" {
		return a.user(copy)
	}
	permission := ""
	switch t.event {
	case "files.updated":
		permission = "file.read"
	case "users.updated":
		permission = "user.read"
	case "console.entries":
		permission = "websocket.connect"
	case "jobs.updated":
		permission = "startup.read"
	case "backups.updated":
		permission = "backup.read"
	case "schedules.updated":
		permission = "schedule.read"
	case "activity.updated":
		permission = "activity.read"
	}
	return a.server(copy, permission)
}

type liveResponse struct {
	header   http.Header
	body     bytes.Buffer
	status   int
	overflow bool
}

func (w *liveResponse) Header() http.Header { return w.header }
func (w *liveResponse) WriteHeader(status int) {
	if w.status == 0 {
		w.status = status
	}
}
func (w *liveResponse) Write(p []byte) (int, error) {
	if w.status == 0 {
		w.status = 200
	}
	if w.body.Len()+len(p) > 1<<20 {
		w.overflow = true
		return len(p), nil
	}
	return w.body.Write(p)
}

func (a *App) loadLiveSample(ctx context.Context, t liveTopic, user int64) (sample liveSample) {
	defer func() {
		if recovered := recover(); recovered != nil {
			slog.Error("live snapshot panic", "panic", recovered)
			sample = liveSample{status: 503, data: json.RawMessage(`{"errors":[{"detail":"Live update unavailable. Refresh through HTTP."}]}`)}
		}
	}()
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	w := &liveResponse{header: make(http.Header)}
	if t.event == "server.resources" {
		s, err := a.one(ctx, "SELECT * FROM servers WHERE uuid=$1", t.server)
		if err != nil {
			fail(w, err)
		} else if snapshot, e := a.clientResourceSnapshot(ctx, s); e != nil {
			fail(w, e)
		} else {
			writeJSON(w, 200, clientResourceResponse(snapshot))
		}
	} else if t.event == "server.updated" {
		r, _ := http.NewRequestWithContext(ctx, "GET", "http://localhost"+t.path, nil)
		r = WithUser(r, user)
		r.SetPathValue("server", t.server)
		s, err := a.server(r, "")
		if err != nil {
			fail(w, err)
		} else {
			u, e := a.user(r)
			if e != nil {
				fail(w, e)
			} else {
				grants, e := a.query(ctx, "SELECT permissions FROM subusers WHERE user_id=$1 AND server_id=$2", user, s["id"])
				if e != nil {
					fail(w, e)
				} else {
					body, _ := json.Marshal(M{"server": s, "root_admin": u["root_admin"], "grants": grants})
					digest := sha256.Sum256(body)
					writeJSON(w, 200, M{"revision": hex.EncodeToString(digest[:])})
				}
			}
		}
	} else {
		r, _ := http.NewRequestWithContext(ctx, "GET", "http://localhost"+t.path, nil)
		if t.event == "console.entries" && t.consoleAfter != "" {
			r.URL.RawQuery = "after=" + url.QueryEscape(t.consoleAfter)
		}
		r = WithUser(r, user)
		r.SetPathValue("server", t.server)
		t.handler(w, r)
	}
	if w.overflow || !json.Valid(w.body.Bytes()) {
		return liveSample{status: 503, data: json.RawMessage(`{"errors":[{"detail":"Live response unavailable. Refresh through HTTP."}]}`)}
	}
	return liveSample{data: append(json.RawMessage(nil), w.body.Bytes()...), status: w.status}
}

func (a *App) watchLiveTopic(t liveTopic, user int64, b *liveBinding) bool {
	h := &a.liveSnapshots
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.closed {
		return false
	}
	if h.workers == nil {
		h.workers = map[string]*liveSnapshotWorker{}
		h.slots = make(chan struct{}, 16)
	}
	key := str(user) + ":" + t.path
	if t.event == "server.resources" {
		key = "resources:" + t.server
	} // Shared across authorized viewers.
	w := h.workers[key]
	if w == nil {
		if len(h.workers) >= 256 {
			return false
		}
		ctx, cancel := context.WithCancel(context.Background())
		w = &liveSnapshotWorker{topic: t, user: user, cancel: cancel, wake: make(chan struct{}, 1), bindings: map[*liveBinding]struct{}{}}
		h.workers[key] = w
		go a.runLiveSnapshot(ctx, key, w)
	}
	w.bindings[b] = struct{}{}
	b.worker = w
	if w.last != nil && time.Since(w.last.sampledAt) < 10*time.Second {
		select {
		case b.updates <- liveDelivery{b, *w.last, w.generation}:
		default:
		}
	}
	select {
	case w.wake <- struct{}{}:
	default:
	}
	var once sync.Once
	b.cancel = func() {
		once.Do(func() {
			h.mu.Lock()
			defer h.mu.Unlock()
			delete(w.bindings, b)
			if len(w.bindings) == 0 {
				w.cancel()
				if h.workers[key] == w {
					delete(h.workers, key)
				}
			}
		})
	}
	return true
}

func (a *App) runLiveSnapshot(ctx context.Context, key string, w *liveSnapshotWorker) {
	h := &a.liveSnapshots
	for {
		select {
		case h.slots <- struct{}{}:
		case <-ctx.Done():
			return
		}
		h.mu.Lock()
		generation := w.generation
		h.mu.Unlock()
		value := a.loadLiveSample(ctx, w.topic, w.user)
		value.sampledAt = time.Now()
		<-h.slots
		if ctx.Err() != nil {
			return
		}
		h.mu.Lock()
		if generation != w.generation {
			h.mu.Unlock()
			continue
		}
		w.last = &value
		for b := range w.bindings {
			select {
			case b.updates <- liveDelivery{b, value, generation}:
			default:
				select {
				case b.resync <- struct{}{}:
				default:
				}
			}
		}
		h.mu.Unlock()
		delay := w.topic.interval
		if w.topic.event == "console.entries" && value.status == 200 {
			var batch struct {
				Cursor string `json:"cursor"`
				More   bool   `json:"more"`
			}
			if json.Unmarshal(value.data, &batch) == nil {
				w.topic.consoleAfter = batch.Cursor
				if batch.More {
					delay = 10 * time.Millisecond
				}
			}
		}
		if value.status >= 400 {
			delay = 10 * time.Second
		}
		timer := time.NewTimer(delay)
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
		case <-w.wake:
			timer.Stop()
			select {
			case <-ctx.Done():
				return
			case <-time.After(250 * time.Millisecond):
			}
		}
	}
}
func (h *liveSnapshotHub) invalidate(user int64) { h.invalidateDomains("all") }
func (h *liveSnapshotHub) close() {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.closed = true
	for _, w := range h.workers {
		w.cancel()
	}
	h.workers = nil
}

type liveMutationResponse struct {
	http.ResponseWriter
	status int
}

func (w *liveMutationResponse) WriteHeader(status int) {
	if w.status == 0 {
		w.status = status
	}
	w.ResponseWriter.WriteHeader(status)
}
func (w *liveMutationResponse) Write(p []byte) (int, error) {
	if w.status == 0 {
		w.status = 200
	}
	return w.ResponseWriter.Write(p)
}
func (w *liveMutationResponse) Unwrap() http.ResponseWriter { return w.ResponseWriter }
func (w *liveMutationResponse) Flush() {
	if w.status == 0 {
		w.status = 200
	}
	_ = http.NewResponseController(w.ResponseWriter).Flush()
}

// Query values are intentionally narrow. Signed URLs, credentials and arbitrary
// include/filter parameters must never become shared snapshot payloads.
func liveQueryAllowed(parts []string, q url.Values) bool {
	for key, values := range q {
		if len(values) != 1 {
			return false
		}
		v := values[0]
		family := ""
		if len(parts) > 1 {
			family = parts[1]
		}
		switch {
		case family == "files" && len(parts) == 3 && parts[2] == "list" && key == "directory":
			if len(v) > 1024 || strings.ContainsAny(v, "\x00\r\n") {
				return false
			}
		case family == "schedules" && key == "include" && v == "tasks":
		case (family == "backups" || family == "activity") && (key == "page" || key == "per_page"):
			n, e := strconv.Atoi(v)
			if e != nil || n < 1 || n > 10000 || (key == "per_page" && n > 100) {
				return false
			}
		case family == "backups" && key == "sort" && (v == "newest" || v == "oldest" || v == "largest" || v == "smallest" || v == "name"):
		case family == "backups" && key == "origin" && (v == "manual" || v == "scheduled" || v == "unknown"):
		default:
			return false
		}
	}
	return true
}
