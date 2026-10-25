package nodeagent

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"sync"
	"time"

	"voltra/internal/nodetunnel"
	"voltra/internal/steamapi"
)

// PrivateSteamProductionReadiness must be supplied by ROOT-trusted production
// release/provisioning code. Offline candidate approval does not satisfy it.
// It is deliberately not serializable and accepts no control-frame paths.
type PrivateSteamProductionReadiness interface {
	ProductionReady(context.Context) error
	AppPolicyReady(uint32) bool
}

type PrivateSteamConnectorConfig struct {
	Runner    PrivateSteamRunner              `json:"-"`
	Readiness PrivateSteamProductionReadiness `json:"-"`
}

type privateConnectorJob struct {
	grant  steamapi.PrivateStreamGrant
	active bool
	app    uint32
}
type privateConnectorGrantKey struct{}

// PrivateSteamConnector belongs to one authenticated control generation. Its
// single Guard broker is shared by newly opened run/reply data streams.
type PrivateSteamConnector struct {
	ctx        context.Context
	cancel     context.CancelFunc
	principal  string
	readiness  PrivateSteamProductionReadiness
	apps       map[uint32]bool
	broker     http.Handler
	recovery   PrivateSteamRunner
	recoveries map[string]bool
	mu         sync.Mutex
	closed     bool
	streams    map[net.Conn]bool
	jobs       map[string]*privateConnectorJob
	workers    sync.WaitGroup
	once       sync.Once
}

func NewPrivateSteamConnector(ctx context.Context, config *PrivateSteamConnectorConfig) *PrivateSteamConnector {
	ctx, cancel := context.WithCancel(ctx)
	r := &PrivateSteamConnector{ctx: ctx, cancel: cancel, apps: map[uint32]bool{}, streams: map[net.Conn]bool{}, jobs: map[string]*privateConnectorJob{}, recoveries: map[string]bool{}}
	if config == nil || config.Runner == nil || config.Readiness == nil || ctx.Err() != nil || config.Readiness.ProductionReady(ctx) != nil {
		return r
	}
	var generation [32]byte
	if _, err := rand.Read(generation[:]); err != nil {
		return r
	}
	r.principal = hex.EncodeToString(generation[:])
	r.recovery = config.Runner
	r.readiness = config.Readiness
	for _, app := range steamapi.RegisteredPrivateApps() {
		if r.readiness.AppPolicyReady(app) {
			r.apps[app] = true
		}
	}
	if len(r.apps) == 0 {
		return r
	}
	r.broker = NewPrivateSteamHandler(config.Runner, func(request *http.Request) (PrivatePrincipal, error) {
		grant, ok := request.Context().Value(privateConnectorGrantKey{}).(steamapi.PrivateStreamGrant)
		if !ok || grant.Validate() != nil || r.ctx.Err() != nil {
			return PrivatePrincipal{}, errors.New("private Steam unavailable")
		}
		return PrivatePrincipal{Session: r.principal, Server: grant.Server, Owner: grant.Owner}, nil
	})
	return r
}

func (r *PrivateSteamConnector) Capabilities() []string {
	if r == nil || r.broker == nil || r.ctx.Err() != nil || r.readiness.ProductionReady(r.ctx) != nil {
		return nil
	}
	out := []string{steamapi.PrivateCapability}
	for _, app := range steamapi.RegisteredPrivateApps() {
		if r.apps[app] && r.readiness.AppPolicyReady(app) {
			out = append(out, steamapi.PrivateAppCapability(app))
		}
	}
	if len(out) == 1 {
		return nil
	}
	recoveryCaps := []string{}
	for _, app := range steamapi.RegisteredPrivateApps() {
		if r.apps[app] && r.recoveryReady(r.ctx, app) {
			recoveryCaps = append(recoveryCaps, steamapi.PrivateRecoveryAppCapability(app))
		}
	}
	if len(recoveryCaps) > 0 {
		out = append(out, steamapi.PrivateRecoveryCapability)
		out = append(out, recoveryCaps...)
	}
	return out
}

// wipePrivateBody does not retain a second credential-bearing backing buffer
// after the existing strict broker consumes the request.
type wipePrivateBody struct {
	data   []byte
	offset int
}

func (b *wipePrivateBody) Read(p []byte) (int, error) {
	if b.offset >= len(b.data) {
		return 0, io.EOF
	}
	n := copy(p, b.data[b.offset:])
	clear(b.data[b.offset : b.offset+n])
	b.offset += n
	return n, nil
}
func (b *wipePrivateBody) Close() error { clear(b.data); return nil }

func (r *PrivateSteamConnector) boundHandler(grant steamapi.PrivateStreamGrant) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		if r.ctx.Err() != nil || r.readiness.ProductionReady(r.ctx) != nil {
			http.Error(w, "private Steam unavailable", 503)
			return
		}
		if request.Method != "POST" || request.URL.Path != "/"+grant.Action || request.URL.RawQuery != "" {
			http.Error(w, "private Steam stream action rejected", 403)
			return
		}
		raw, err := io.ReadAll(io.LimitReader(request.Body, 65537))
		defer clear(raw)
		if err != nil || len(raw) > 65536 || !strictPrivateJSON(raw) {
			http.Error(w, "invalid private Steam frame", 400)
			return
		}
		if grant.Action == "recover" {
			var v steamapi.PrivateReceiptRecoveryRequest
			d := json.NewDecoder(bytes.NewReader(raw))
			d.DisallowUnknownFields()
			if d.Decode(&v) != nil || v.Validate() != nil {
				http.Error(w, "invalid private Steam recovery request", 400)
				return
			}
			original := v.Original.Request()
			if v.RecoveryID != grant.RecoveryID || original.Server != grant.Server || original.Owner != grant.Owner || original.Job != grant.Job || original.Nonce != grant.Nonce || original.Scope().RequestDigest != grant.RequestDigest || !privateReleaseRequestPolicy(original) || !r.apps[original.Selection.App] || !r.recoveryReady(request.Context(), original.Selection.App) {
				http.Error(w, "private Steam recovery binding rejected", 403)
				return
			}
			request = request.WithContext(context.WithValue(request.Context(), privateConnectorGrantKey{}, grant))
			body := &wipePrivateBody{data: raw}
			request.Body = body
			defer body.Close()
			r.broker.ServeHTTP(w, request)
			return
		}
		var envelope struct {
			Server    string                    `json:"server"`
			Owner     string                    `json:"owner"`
			Job       string                    `json:"job"`
			Nonce     string                    `json:"nonce"`
			Selection steamapi.PrivateSelection `json:"selection"`
		}
		if json.Unmarshal(raw, &envelope) != nil || envelope.Job != grant.Job || envelope.Nonce != grant.Nonce {
			http.Error(w, "private Steam stream binding rejected", 403)
			return
		}
		if grant.Action == "run" {
			if envelope.Server != grant.Server || envelope.Owner != grant.Owner {
				http.Error(w, "private Steam stream binding rejected", 403)
				return
			}
			app := envelope.Selection.App
			if !r.apps[app] || !r.readiness.AppPolicyReady(app) {
				http.Error(w, "private Steam app policy unavailable", 503)
				return
			}
			profile, ok := steamapi.PrivateProfile(app)
			if !ok || envelope.Selection.Platform != profile.Platform || envelope.Selection.Architecture != profile.Architecture {
				http.Error(w, "private Steam app policy unavailable", 503)
				return
			}
			protected := map[string]bool{}
			for _, path := range envelope.Selection.Protected {
				protected[path] = true
			}
			for _, path := range profile.ProtectedPaths {
				if !protected[path] {
					http.Error(w, "private Steam preservation policy rejected", 403)
					return
				}
			}
			r.mu.Lock()
			job := r.jobs[grant.Job]
			if job != nil && job.active && samePrivateBinding(job.grant, grant) {
				job.app = app
			}
			r.mu.Unlock()
		}
		request = request.WithContext(context.WithValue(request.Context(), privateConnectorGrantKey{}, grant))
		body := &wipePrivateBody{data: raw}
		request.Body = body
		defer body.Close()
		r.broker.ServeHTTP(w, request)
	})
}

func samePrivateBinding(a, b steamapi.PrivateStreamGrant) bool {
	return a.Server == b.Server && a.Owner == b.Owner && a.Job == b.Job && a.Nonce == b.Nonce
}

func (r *PrivateSteamConnector) ServeStream(ctx context.Context, conn net.Conn, grant steamapi.PrivateStreamGrant) error {
	defer conn.Close()
	if grant.Validate() != nil || r == nil || r.broker == nil || r.ctx.Err() != nil || r.readiness.ProductionReady(r.ctx) != nil {
		return errors.New("private Steam unavailable")
	}
	if grant.Action == "recover" {
		ready := false
		for _, app := range steamapi.RegisteredPrivateApps() {
			if r.apps[app] && r.recoveryReady(ctx, app) {
				ready = true
				break
			}
		}
		if !ready {
			return errors.New("private Steam recovery unavailable")
		}
	}
	r.mu.Lock()
	if r.closed {
		r.mu.Unlock()
		return errors.New("private Steam unavailable")
	}
	if grant.Action == "run" {
		if len(r.jobs) >= 256 || r.jobs[grant.Job] != nil {
			r.mu.Unlock()
			return errors.New("private Steam job grant rejected")
		}
		r.jobs[grant.Job] = &privateConnectorJob{grant: grant, active: true}
	} else if grant.Action == "recover" {
		if _, ok := r.recoverer(); !ok || len(r.recoveries) >= 256 || r.recoveries[grant.RecoveryID] {
			r.mu.Unlock()
			return errors.New("private Steam recovery grant rejected")
		}
		r.recoveries[grant.RecoveryID] = true
	} else if grant.Action == "reply" {
		job := r.jobs[grant.Job]
		if job == nil || !job.active || job.app == 0 || !r.readiness.AppPolicyReady(job.app) || !samePrivateBinding(job.grant, grant) {
			r.mu.Unlock()
			return errors.New("private Steam reply grant rejected")
		}
	}
	r.streams[conn] = true
	r.workers.Add(1)
	r.mu.Unlock()
	defer func() {
		r.mu.Lock()
		delete(r.streams, conn)
		if grant.Action == "run" {
			r.jobs[grant.Job].active = false
		}
		r.mu.Unlock()
		r.workers.Done()
	}()
	streamCtx, cancel := context.WithCancel(r.ctx)
	defer cancel()
	stop := context.AfterFunc(ctx, cancel)
	defer stop()
	return ServePrivateSteamStream(streamCtx, conn, r.boundHandler(grant))
}

// Close cancels pending Guard requests, closes all streams and joins their
// handlers; the runner must honor its context and reap its worker before return.
func (r *PrivateSteamConnector) Close() {
	if r == nil {
		return
	}
	r.once.Do(func() {
		r.mu.Lock()
		r.closed = true
		r.cancel()
		streams := make([]net.Conn, 0, len(r.streams))
		for conn := range r.streams {
			streams = append(streams, conn)
		}
		r.mu.Unlock()
		for _, conn := range streams {
			_ = conn.Close()
		}
		r.workers.Wait()
	})
}

func (r *PrivateSteamConnector) bridge(ctx context.Context, base *url.URL, config Config, id string, grant steamapi.PrivateStreamGrant) error {
	if grant.Validate() != nil || len(r.Capabilities()) == 0 {
		return errors.New("private Steam unavailable")
	}
	ws, err := dial(ctx, endpoint(base, "/api/remote/connector/streams/"+id, true), config.Token)
	if err != nil {
		return err
	}
	stream := nodetunnel.NewConn(ws)
	defer stream.Close()
	_ = stream.SetReadDeadline(time.Now().Add(pongTimeout))
	ws.SetPongHandler(func(string) error { return stream.SetReadDeadline(time.Now().Add(pongTimeout)) })
	streamCtx, cancel := context.WithCancel(ctx)
	done := make(chan struct{})
	go keepalive(streamCtx, ws, done)
	defer func() { cancel(); <-done }()
	return r.ServeStream(streamCtx, stream, grant)
}

// Prevent accidental use of a bytes-backed request as authority elsewhere.
var _ io.ReadCloser = (*wipePrivateBody)(nil)
