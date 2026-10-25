package nodeagent

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"strconv"
	"sync"
	"time"
	"unicode/utf8"
	"voltra/internal/steamapi"
)

type PrivateSteamRunner interface {
	Run(context.Context, steamapi.PrivateRequest, func(steamapi.PrivateEvent) error, func(context.Context, steamapi.PrivateChallenge) (steamapi.PrivateReply, error)) error
}
type PrivatePrincipal struct{ Session, Server, Owner string }
type privatePending struct {
	principal PrivatePrincipal
	challenge steamapi.PrivateChallenge
	reply     chan steamapi.PrivateReply
	used      bool
	context   context.Context
	expires   time.Time
}
type privateSteamHandler struct {
	runner    PrivateSteamRunner
	principal func(*http.Request) (PrivatePrincipal, error)
	mu        sync.Mutex
	pending   map[string]*privatePending
	active    map[string]bool
}

func NewPrivateSteamHandler(r PrivateSteamRunner, p func(*http.Request) (PrivatePrincipal, error)) http.Handler {
	return &privateSteamHandler{runner: r, principal: p, pending: map[string]*privatePending{}, active: map[string]bool{}}
}
func privateDecode(w http.ResponseWriter, r *http.Request, v any) error {
	r.Body = http.MaxBytesReader(w, r.Body, 65536)
	raw, err := io.ReadAll(r.Body)
	defer clear(raw)
	if err != nil || !strictPrivateJSON(raw) {
		return errors.New("invalid private Steam frame")
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if d.Decode(v) != nil {
		return errors.New("invalid private Steam frame")
	}
	var more any
	if d.Decode(&more) != io.EOF {
		return errors.New("invalid private Steam frame")
	}
	return nil
}
func (h *privateSteamHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if h.principal == nil || h.runner == nil {
		http.Error(w, "private Steam unavailable", 503)
		return
	}
	p, e := h.principal(r)
	if e != nil || p.Session == "" || p.Server == "" || p.Owner == "" {
		http.Error(w, "private Steam unauthorized", 403)
		return
	}
	if r.Method != "POST" || r.URL.RawQuery != "" {
		http.NotFound(w, r)
		return
	}
	switch r.URL.Path {
	case "/recover":
		h.recoverHTTP(w, r, p)
	case "/reply":
		var v steamapi.PrivateReply
		if privateDecode(w, r, &v) != nil {
			http.Error(w, "invalid Guard reply", 400)
			return
		}
		key := p.Session + ":" + v.Job + ":" + v.Nonce + ":" + v.ChallengeID
		h.mu.Lock()
		q := h.pending[key]
		if q == nil || q.used || q.context.Err() != nil || !time.Now().Before(q.expires) || q.principal != p || q.challenge != v.PrivateChallenge || (v.Kind == "device_confirmation" && (v.Accepted == nil || v.Code != nil)) || (v.Kind != "device_confirmation" && (v.Code == nil || v.Accepted != nil)) {
			h.mu.Unlock()
			http.Error(w, "Guard reply rejected", 409)
			return
		}
		q.used = true
		q.reply <- v
		h.mu.Unlock()
		w.WriteHeader(204)
	case "/run":
		var v steamapi.PrivateRequest
		if privateDecode(w, r, &v) != nil || v.Validate() != nil {
			http.Error(w, "invalid private Steam request", 400)
			return
		}
		if v.Server != p.Server || v.Owner != p.Owner {
			http.Error(w, "private Steam authorization rejected", 403)
			return
		}
		key := p.Server
		h.mu.Lock()
		if h.active[key] {
			h.mu.Unlock()
			http.Error(w, "private Steam job active", 409)
			return
		}
		h.active[key] = true
		h.mu.Unlock()
		defer func() { h.mu.Lock(); delete(h.active, key); h.mu.Unlock() }()
		ctx, cancel := context.WithTimeout(r.Context(), time.Duration(v.DeadlineSeconds)*time.Second)
		defer cancel()
		w.Header().Set("Content-Type", "application/x-ndjson")
		w.WriteHeader(200)
		enc := json.NewEncoder(w)
		var write sync.Mutex
		emit := func(ev steamapi.PrivateEvent) error {
			write.Lock()
			defer write.Unlock()
			c := http.NewResponseController(w)
			_ = c.SetWriteDeadline(time.Now().Add(15 * time.Second))
			if e := enc.Encode(ev); e != nil {
				cancel()
				return e
			}
			if e := c.Flush(); e != nil {
				cancel()
				return e
			}
			return nil
		}
		guard := func(gc context.Context, c steamapi.PrivateChallenge) (steamapi.PrivateReply, error) {
			if c.Job != v.Job || c.Nonce != v.Nonce || len(c.ChallengeID) != 32 || (c.Kind != "device_code" && c.Kind != "email_code" && c.Kind != "device_confirmation") {
				return steamapi.PrivateReply{}, errors.New("Guard challenge rejected")
			}
			gc, stop := context.WithTimeout(gc, 20*time.Second)
			defer stop()
			k := p.Session + ":" + c.Job + ":" + c.Nonce + ":" + c.ChallengeID
			expires, _ := gc.Deadline()
			q := &privatePending{principal: p, challenge: c, reply: make(chan steamapi.PrivateReply, 1), context: gc, expires: expires}
			h.mu.Lock()
			if h.pending[k] != nil {
				h.mu.Unlock()
				return steamapi.PrivateReply{}, errors.New("Guard challenge repeated")
			}
			h.pending[k] = q
			h.mu.Unlock()
			defer func() { h.mu.Lock(); delete(h.pending, k); h.mu.Unlock() }()
			if e := emit(steamapi.PrivateEvent{Version: steamapi.PrivateVersion, Type: "guard_required", Challenge: &c}); e != nil {
				return steamapi.PrivateReply{}, e
			}
			select {
			case reply := <-q.reply:
				return reply, nil
			case <-gc.Done():
				return steamapi.PrivateReply{}, errors.New("Guard response expired")
			}
		}
		if e := h.runner.Run(ctx, v, emit, guard); e != nil {
			_ = emit(steamapi.PrivateEvent{Version: steamapi.PrivateVersion, Type: "error", Stage: "failed", Error: "private Steam job failed"})
		}
	default:
		http.NotFound(w, r)
	}
}

// encoding/json permits replacement characters for malformed input. Reject
// invalid UTF8 and unpaired UTF16 escapes before decoding any private literal.
func strictPrivateJSON(raw []byte) bool {
	if !utf8.Valid(raw) {
		return false
	}
	quoted := false
	for i := 0; i < len(raw); i++ {
		if raw[i] == '"' {
			quoted = !quoted
			continue
		}
		if !quoted || raw[i] != '\\' {
			continue
		}
		i++
		if i >= len(raw) {
			return false
		}
		if raw[i] != 'u' {
			continue
		}
		if i+4 >= len(raw) {
			return false
		}
		v, e := strconv.ParseUint(string(raw[i+1:i+5]), 16, 16)
		if e != nil {
			return false
		}
		i += 4
		if v >= 0xdc00 && v <= 0xdfff {
			return false
		}
		if v >= 0xd800 && v <= 0xdbff {
			if i+6 >= len(raw) || raw[i+1] != '\\' || raw[i+2] != 'u' {
				return false
			}
			low, e := strconv.ParseUint(string(raw[i+3:i+7]), 16, 16)
			if e != nil || low < 0xdc00 || low > 0xdfff {
				return false
			}
			i += 6
		}
	}
	return true
}

// ServePrivateSteamStream serves one already-authenticated connector stream.
// The session owner supplies one shared handler/broker for run and reply streams;
// this function never authenticates request headers or advertises capabilities.
func ServePrivateSteamStream(ctx context.Context, c net.Conn, handler http.Handler) error {
	l := &singleStreamListener{conn: c, done: make(chan struct{})}
	var handlers sync.WaitGroup
	s := &http.Server{Handler: handler, ReadHeaderTimeout: 10 * time.Second, ReadTimeout: 20 * time.Second, MaxHeaderBytes: 8192, BaseContext: func(net.Listener) context.Context { return ctx }, ConnState: func(_ net.Conn, state http.ConnState) {
		if state == http.StateNew {
			handlers.Add(1)
		}
		if state == http.StateClosed {
			_ = l.Close()
			handlers.Done()
		}
	}}
	s.SetKeepAlivesEnabled(false)
	stop := context.AfterFunc(ctx, func() { _ = s.Close(); _ = l.Close() })
	defer stop()
	err := s.Serve(l)
	handlers.Wait()
	if errors.Is(err, net.ErrClosed) || errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return err
}
