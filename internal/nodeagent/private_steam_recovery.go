package nodeagent

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"sync"
	"time"
	"voltra/internal/steamapi"
	"voltra/internal/steamexec"
)

type PrivateSteamRecoverer interface {
	Recover(context.Context, steamapi.PrivateReceiptRecoveryRequest, func(steamapi.PrivateEvent) error) error
}
type PrivateSteamReceiptRecoveryReadiness interface {
	ReceiptRecoveryReady(context.Context, uint32) error
}

func (r *PrivateSteamConnector) recoveryReady(ctx context.Context, app uint32) bool {
	if !r.readiness.AppPolicyReady(app) {
		return false
	}
	ready, ok := r.readiness.(PrivateSteamReceiptRecoveryReadiness)
	if !ok {
		return false
	}
	_, runner := r.recoverer()
	return runner && ready.ReceiptRecoveryReady(ctx, app) == nil
}
func (r *PrivateSteamConnector) recoverer() (PrivateSteamRecoverer, bool) {
	if r == nil {
		return nil, false
	}
	v, ok := r.recovery.(PrivateSteamRecoverer)
	return v, ok
}
func (h *privateSteamHandler) recoverHTTP(w http.ResponseWriter, r *http.Request, p PrivatePrincipal) {
	recoverer, ok := h.runner.(PrivateSteamRecoverer)
	if !ok {
		http.Error(w, "private Steam recovery unavailable", 503)
		return
	}
	var v steamapi.PrivateReceiptRecoveryRequest
	if privateDecode(w, r, &v) != nil || v.Validate() != nil {
		http.Error(w, "invalid private Steam recovery request", 400)
		return
	}
	ready, hasReadiness := h.runner.(PrivateSteamReceiptRecoveryReadiness)
	if !hasReadiness || ready.ReceiptRecoveryReady(r.Context(), v.Original.Selection.App) != nil {
		http.Error(w, "private Steam recovery unavailable", 503)
		return
	}
	original := v.Original.Request()
	if original.Server != p.Server || original.Owner != p.Owner {
		http.Error(w, "private Steam authorization rejected", 403)
		return
	}
	h.mu.Lock()
	if h.active[p.Server] {
		h.mu.Unlock()
		http.Error(w, "private Steam job active", 409)
		return
	}
	h.active[p.Server] = true
	h.mu.Unlock()
	defer func() { h.mu.Lock(); delete(h.active, p.Server); h.mu.Unlock() }()
	ctx, cancel, e := steamexec.PrivateRecoveryContext(r.Context(), v, time.Time{})
	if e != nil {
		http.Error(w, "invalid private Steam recovery request", 400)
		return
	}
	defer cancel()
	w.Header().Set("Content-Type", "application/x-ndjson")
	w.WriteHeader(200)
	enc := json.NewEncoder(w)
	var mu sync.Mutex
	emit := func(ev steamapi.PrivateEvent) error {
		mu.Lock()
		defer mu.Unlock()
		if ev.Type == "guard_required" || ev.Challenge != nil {
			cancel()
			return errors.New("private Steam recovery Guard rejected")
		}
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
	if recoverer.Recover(ctx, v, emit) != nil {
		_ = emit(steamapi.PrivateEvent{Version: steamapi.PrivateVersion, Type: "error", Stage: "failed", Error: "private Steam receipt recovery failed"})
	}
}

func privateReleaseRequestPolicy(r steamapi.PrivateRequest) bool {
	p, ok := steamapi.PrivateProfile(r.Selection.App)
	if !ok || r.Selection.Platform != p.Platform || r.Selection.Architecture != p.Architecture {
		return false
	}
	roots := map[string]bool{}
	for _, root := range r.Selection.Protected {
		roots[root] = true
	}
	for _, root := range p.ProtectedPaths {
		if !roots[root] {
			return false
		}
	}
	return true
}
