package nodeagent

import (
	"context"
	"errors"
	"fmt"
	"sync/atomic"
	"testing"
	"time"
	"voltra/internal/steamapi"
)

// Mechanical broker fixture only, never an approved release or accepted worker receipt.
type privateRecoveryBrokerFixture struct {
	ready      atomic.Bool
	runs       atomic.Int32
	recoveries atomic.Int32
	entered    chan struct{}
	release    chan struct{}
}

func (f *privateRecoveryBrokerFixture) ProductionReady(context.Context) error { return nil }
func (f *privateRecoveryBrokerFixture) AppPolicyReady(app uint32) bool        { return app == 2394010 }
func (f *privateRecoveryBrokerFixture) ReceiptRecoveryReady(context.Context, uint32) error {
	if !f.ready.Load() {
		return errors.New("fixture recovery OFF")
	}
	return nil
}
func (f *privateRecoveryBrokerFixture) Run(_ context.Context, _ steamapi.PrivateRequest, emit func(steamapi.PrivateEvent) error, _ func(context.Context, steamapi.PrivateChallenge) (steamapi.PrivateReply, error)) error {
	f.runs.Add(1)
	return emit(steamapi.PrivateEvent{Version: steamapi.PrivateVersion, Type: "result", Stage: "fixture-only-run"})
}
func (f *privateRecoveryBrokerFixture) Recover(ctx context.Context, _ steamapi.PrivateReceiptRecoveryRequest, emit func(steamapi.PrivateEvent) error) error {
	f.recoveries.Add(1)
	if f.entered != nil {
		close(f.entered)
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-f.release:
		}
	}
	return emit(steamapi.PrivateEvent{Version: steamapi.PrivateVersion, Type: "result", Stage: "fixture-only-recovery"})
}
func privateRecoveryBrokerRequest(t *testing.T, id int) (steamapi.PrivateReceiptRecoveryRequest, steamapi.PrivateStreamGrant) {
	t.Helper()
	r := privateConnectorRequest()
	r.Username = ""
	r.Password = ""
	r.Guard = ""
	r.BetaPassword = ""
	o, e := steamapi.PrivateRecoveryOriginalFromRequest(r)
	if e != nil {
		t.Fatal(e)
	}
	v := steamapi.PrivateReceiptRecoveryRequest{Version: steamapi.PrivateRecoveryCapability, RecoveryID: fmt.Sprintf("44444444-4444-4444-4444-%012d", id), Original: o}
	g := privateConnectorGrant(r)
	g.Action = "recover"
	g.RecoveryID = v.RecoveryID
	g.RequestDigest = r.Scope().RequestDigest
	return v, g
}
func TestPrivateRecoveryConnectorActionScopeAndRunReplay(t *testing.T) {
	f := &privateRecoveryBrokerFixture{}
	f.ready.Store(true)
	registry := NewPrivateSteamConnector(context.Background(), &PrivateSteamConnectorConfig{Runner: f, Readiness: f})
	defer registry.Close()
	r := privateConnectorRequest()
	run := privateConnectorGrant(r)
	if status, e := privateConnectorPOST(t, registry, run, "/run", r); e != nil || status != 200 {
		t.Fatal(status, e)
	}
	for n := 1; n <= 2; n++ {
		v, g := privateRecoveryBrokerRequest(t, n)
		if status, e := privateConnectorPOST(t, registry, g, "/recover", v); e != nil || status != 200 {
			t.Fatal(status, e)
		}
	}
	if _, e := privateConnectorPOST(t, registry, run, "/run", r); e == nil {
		t.Fatal("recovery reopened used Run")
	}
	v, g := privateRecoveryBrokerRequest(t, 1)
	if _, e := privateConnectorPOST(t, registry, g, "/recover", v); e == nil {
		t.Fatal("recoveryID replay accepted")
	}
	if f.runs.Load() != 1 || f.recoveries.Load() != 2 {
		t.Fatal("wrong action executed")
	}
	for _, kind := range []string{"digest", "deadline", "owner", "route", "credential"} {
		t.Run(kind, func(t *testing.T) {
			v, g := privateRecoveryBrokerRequest(t, 10+len(registry.recoveries))
			var body any = v
			path := "/recover"
			switch kind {
			case "digest":
				g.RequestDigest = repeatRecoveryHex()
			case "deadline":
				v.Original.DeadlineSeconds++
				body = v
			case "owner":
				v.Original.Owner = repeatRecoveryHex()
				body = v
			case "route":
				path = "/run"
			case "credential":
				body = map[string]any{"version": v.Version, "recovery_id": v.RecoveryID, "original": map[string]any{"username": "", "version": v.Original.Version}}
			}
			before := f.recoveries.Load()
			status, e := privateConnectorPOST(t, registry, g, path, body)
			if e == nil && status == 200 || f.recoveries.Load() != before {
				t.Fatal("invalid recovery reached runner", status, e)
			}
		})
	}
}
func repeatRecoveryHex() string {
	return "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
}
func TestPrivateRecoveryConnectorRequiresSeparateReadiness(t *testing.T) {
	f := &privateRecoveryBrokerFixture{}
	registry := NewPrivateSteamConnector(context.Background(), &PrivateSteamConnectorConfig{Runner: f, Readiness: f})
	defer registry.Close()
	for _, cap := range registry.Capabilities() {
		if cap == steamapi.PrivateRecoveryCapability || cap == steamapi.PrivateRecoveryAppCapability(2394010) {
			t.Fatal("method presence advertised recovery")
		}
	}
	v, g := privateRecoveryBrokerRequest(t, 1)
	if _, e := privateConnectorPOST(t, registry, g, "/recover", v); e == nil {
		t.Fatal("recovery OFF accepted stream")
	}
	f.ready.Store(true)
	found := false
	for _, cap := range registry.Capabilities() {
		if cap == steamapi.PrivateRecoveryAppCapability(2394010) {
			found = true
		}
	}
	if !found {
		t.Fatal("explicit fixture readiness not scoped")
	}
}

func TestPrivateRecoverySharesServerExclusionAndBoundsIDs(t *testing.T) {
	f := &privateRecoveryBrokerFixture{entered: make(chan struct{}), release: make(chan struct{})}
	f.ready.Store(true)
	registry := NewPrivateSteamConnector(context.Background(), &PrivateSteamConnectorConfig{Runner: f, Readiness: f})
	defer registry.Close()
	first, g := privateRecoveryBrokerRequest(t, 1)
	done := make(chan error, 1)
	go func() {
		status, e := privateConnectorPOST(t, registry, g, "/recover", first)
		if e == nil && status != 200 {
			e = errors.New("recovery not accepted")
		}
		done <- e
	}()
	select {
	case <-f.entered:
	case <-time.After(time.Second):
		t.Fatal("recovery not active")
	}
	request := privateConnectorRequest()
	if status, e := privateConnectorPOST(t, registry, privateConnectorGrant(request), "/run", request); e != nil || status != 409 {
		t.Fatal("run overlapped recovery", status, e)
	}
	second, g2 := privateRecoveryBrokerRequest(t, 2)
	if status, e := privateConnectorPOST(t, registry, g2, "/recover", second); e != nil || status != 409 {
		t.Fatal("second recovery overlapped", status, e)
	}
	close(f.release)
	select {
	case e := <-done:
		if e != nil {
			t.Fatal(e)
		}
	case <-time.After(time.Second):
		t.Fatal("recovery did not finish")
	}
	registry.mu.Lock()
	for n := 0; n < 256; n++ {
		registry.recoveries[fmt.Sprintf("bounded-%d", n)] = true
	}
	registry.mu.Unlock()
	third, g3 := privateRecoveryBrokerRequest(t, 3)
	if _, e := privateConnectorPOST(t, registry, g3, "/recover", third); e == nil {
		t.Fatal("recovery ID bound ignored")
	}
}
