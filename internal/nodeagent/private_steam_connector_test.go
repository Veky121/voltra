package nodeagent

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"github.com/gorilla/websocket"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
	"voltra/internal/nodetunnel"
	"voltra/internal/steamapi"
)

// Fixture authority only: not a provisioned production release/readiness claim.
type privateConnectorFixtureReadiness struct{ ready bool }

func (r privateConnectorFixtureReadiness) ProductionReady(context.Context) error {
	if !r.ready {
		return errors.New("offline candidate is not production-ready")
	}
	return nil
}
func (r privateConnectorFixtureReadiness) AppPolicyReady(app uint32) bool {
	return r.ready && (app == 2394010 || app == 42)
}
func privateConnectorRequest() steamapi.PrivateRequest {
	v := privateNodeRequest()
	v.Selection.App = 2394010
	p, _ := steamapi.Profile(2394010)
	v.Selection.Protected = p.ProtectedPaths
	return v
}
func privateConnectorGrant(v steamapi.PrivateRequest) steamapi.PrivateStreamGrant {
	return steamapi.PrivateStreamGrant{Server: v.Server, Owner: v.Owner, Job: v.Job, Nonce: v.Nonce, Action: "run"}
}
func privateConnectorPOST(t *testing.T, registry *PrivateSteamConnector, grant steamapi.PrivateStreamGrant, path string, value any) (int, error) {
	t.Helper()
	server, client := net.Pipe()
	done := make(chan error, 1)
	go func() { done <- registry.ServeStream(context.Background(), server, grant) }()
	defer client.Close()
	_ = client.SetDeadline(time.Now().Add(3 * time.Second))
	raw, _ := json.Marshal(value)
	request, _ := http.NewRequest("POST", "http://private"+path, bytes.NewReader(raw))
	request.Header.Set("X-Private-Owner", strings.Repeat("f", 64))
	request.Header.Set("X-Private-Session", "forged-user-authority")
	if e := request.Write(client); e != nil {
		<-done
		return 0, e
	}
	response, e := http.ReadResponse(bufio.NewReader(client), request)
	if e != nil {
		<-done
		return 0, e
	}
	_, _ = io.Copy(io.Discard, response.Body)
	response.Body.Close()
	client.Close()
	<-done
	return response.StatusCode, nil
}

func TestPrivateConnectorDefaultOffAndCandidateNotAuthority(t *testing.T) {
	runner := privateRunnerFunc(func(context.Context, steamapi.PrivateRequest, func(steamapi.PrivateEvent) error, func(context.Context, steamapi.PrivateChallenge) (steamapi.PrivateReply, error)) error {
		return nil
	})
	for _, config := range []*PrivateSteamConnectorConfig{nil, {Runner: runner}, {Runner: runner, Readiness: privateConnectorFixtureReadiness{false}}} {
		r := NewPrivateSteamConnector(context.Background(), config)
		if len(r.Capabilities()) != 0 {
			t.Fatal("offline private capability advertised")
		}
		r.Close()
	}
	if _, ok := any(&PrivateCandidateInstallation{}).(PrivateSteamProductionReadiness); ok {
		t.Fatal("offline candidate became production authority")
	}
	var config Config
	if json.Unmarshal([]byte(`{"panel_url":"http://127.0.0.1","private_steam":{"production_ready":true,"bundle":"/attacker"}}`), &config) != nil || config.PrivateSteam != nil {
		t.Fatal("wire configuration activated private service")
	}
}

func TestPrivateConnectorAuthenticatedGrantRejectsBodyRouteReplayAndPolicyAttacks(t *testing.T) {
	var calls atomic.Int32
	runner := privateRunnerFunc(func(_ context.Context, _ steamapi.PrivateRequest, emit func(steamapi.PrivateEvent) error, _ func(context.Context, steamapi.PrivateChallenge) (steamapi.PrivateReply, error)) error {
		calls.Add(1)
		return emit(steamapi.PrivateEvent{Version: steamapi.PrivateVersion, Type: "result"})
	})
	config := &PrivateSteamConnectorConfig{Runner: runner, Readiness: privateConnectorFixtureReadiness{true}}
	for _, scenario := range []string{"owner", "server", "job", "nonce", "route", "unknown_app", "platform", "architecture", "missing_protection", "valid"} {
		t.Run(scenario, func(t *testing.T) {
			registry := NewPrivateSteamConnector(context.Background(), config)
			defer registry.Close()
			request := privateConnectorRequest()
			grant := privateConnectorGrant(request)
			path := "/run"
			expected := 403
			switch scenario {
			case "owner":
				request.Owner = strings.Repeat("d", 64)
			case "server":
				request.Server = "33333333-3333-3333-3333-333333333333"
			case "job":
				request.Job = "33333333-3333-3333-3333-333333333333"
			case "nonce":
				request.Nonce = strings.Repeat("d", 64)
			case "route":
				path = "/reply"
			case "unknown_app":
				request.Selection.App = 42
				expected = 503
			case "platform":
				request.Selection.Platform = "windows"
				expected = 503
			case "architecture":
				request.Selection.Architecture = "32"
				expected = 503
			case "missing_protection":
				request.Selection.Protected = []string{}
			case "valid":
				expected = 200
			}
			before := calls.Load()
			status, e := privateConnectorPOST(t, registry, grant, path, request)
			if e != nil || status != expected {
				t.Fatal("binding response", status, e)
			}
			if scenario != "valid" && calls.Load() != before {
				t.Fatal("unauthorized body reached runner")
			}
			if scenario == "valid" {
				if calls.Load() != before+1 {
					t.Fatal("valid grant did not reach runner")
				}
				if _, e = privateConnectorPOST(t, registry, grant, path, request); e == nil {
					t.Fatal("completed run grant replay accepted")
				}
			}
		})
	}
}

func TestPrivateConnectorNewReplyStreamsStayInPendingControlGeneration(t *testing.T) {
	request := privateConnectorRequest()
	grant := privateConnectorGrant(request)
	challenge := steamapi.PrivateChallenge{Job: request.Job, Nonce: request.Nonce, ChallengeID: strings.Repeat("c", 32), Kind: "device_code"}
	runner := privateRunnerFunc(func(ctx context.Context, _ steamapi.PrivateRequest, emit func(steamapi.PrivateEvent) error, guard func(context.Context, steamapi.PrivateChallenge) (steamapi.PrivateReply, error)) error {
		if _, e := guard(ctx, challenge); e != nil {
			return e
		}
		return emit(steamapi.PrivateEvent{Version: steamapi.PrivateVersion, Type: "result"})
	})
	config := &PrivateSteamConnectorConfig{Runner: runner, Readiness: privateConnectorFixtureReadiness{true}}
	registry := NewPrivateSteamConnector(context.Background(), config)
	defer registry.Close()
	server, client := net.Pipe()
	done := make(chan error, 1)
	go func() { done <- registry.ServeStream(context.Background(), server, grant) }()
	defer client.Close()
	_ = client.SetDeadline(time.Now().Add(3 * time.Second))
	raw, _ := json.Marshal(request)
	req, _ := http.NewRequest("POST", "http://private/run", bytes.NewReader(raw))
	if e := req.Write(client); e != nil {
		t.Fatal(e)
	}
	response, e := http.ReadResponse(bufio.NewReader(client), req)
	if e != nil {
		t.Fatal(e)
	}
	defer response.Body.Close()
	scanner := bufio.NewScanner(response.Body)
	if !scanner.Scan() {
		t.Fatal("missing pending Guard event")
	}
	code := "synthetic-reply"
	reply := steamapi.PrivateReply{PrivateChallenge: challenge, Code: &code}
	replyGrant := grant
	replyGrant.Action = "reply"
	wrong := replyGrant
	wrong.Owner = strings.Repeat("d", 64)
	if _, e = privateConnectorPOST(t, registry, wrong, "/reply", reply); e == nil {
		t.Fatal("different control grant owner accepted")
	}
	wrongReply := reply
	wrongReply.Nonce = strings.Repeat("d", 64)
	if status, e := privateConnectorPOST(t, registry, replyGrant, "/reply", wrongReply); e != nil || status != 403 {
		t.Fatal("body nonce not bound to control grant", status, e)
	}
	next := NewPrivateSteamConnector(context.Background(), config)
	if next.principal == registry.principal {
		t.Fatal("control generation principal reused")
	}
	if _, e = privateConnectorPOST(t, next, replyGrant, "/reply", reply); e == nil {
		t.Fatal("old pending challenge accepted by new control generation")
	}
	next.Close()
	if status, e := privateConnectorPOST(t, registry, replyGrant, "/reply", reply); e != nil || status != 204 {
		t.Fatal("valid new stream did not reuse same broker", status, e)
	}
	if !scanner.Scan() || !bytes.Contains(scanner.Bytes(), []byte(`"type":"result"`)) {
		t.Fatal("bound pending job did not resume")
	}
	client.Close()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("run stream did not close")
	}
}

type privateConnectorRevocableReadiness struct{ production, policy atomic.Bool }

func (r *privateConnectorRevocableReadiness) ProductionReady(context.Context) error {
	if !r.production.Load() {
		return errors.New("production release revoked")
	}
	return nil
}
func (r *privateConnectorRevocableReadiness) AppPolicyReady(app uint32) bool {
	return r.policy.Load() && app == 2394010
}
func TestPrivateConnectorReadinessRevocationFailsClosed(t *testing.T) {
	authority := &privateConnectorRevocableReadiness{}
	authority.production.Store(true)
	authority.policy.Store(true)
	var calls atomic.Int32
	runner := privateRunnerFunc(func(context.Context, steamapi.PrivateRequest, func(steamapi.PrivateEvent) error, func(context.Context, steamapi.PrivateChallenge) (steamapi.PrivateReply, error)) error {
		calls.Add(1)
		return nil
	})
	registry := NewPrivateSteamConnector(context.Background(), &PrivateSteamConnectorConfig{Runner: runner, Readiness: authority})
	defer registry.Close()
	if len(registry.Capabilities()) != 2 {
		t.Fatal("fixture policy not ready")
	}
	authority.policy.Store(false)
	if len(registry.Capabilities()) != 0 {
		t.Fatal("revoked app policy advertised")
	}
	request := privateConnectorRequest()
	if status, e := privateConnectorPOST(t, registry, privateConnectorGrant(request), "/run", request); e != nil || status != 503 {
		t.Fatal("revoked app policy admitted", status, e)
	}
	authority.production.Store(false)
	if len(registry.Capabilities()) != 0 {
		t.Fatal("revoked production release advertised")
	}
	if calls.Load() != 0 {
		t.Fatal("revoked readiness reached runner")
	}
}

func TestPrivateConnectorRealControlAndDataStreams(t *testing.T) {
	for _, cancelGuard := range []bool{false, true} {
		t.Run(map[bool]string{false: "run-and-new-reply-stream", true: "control-cancel-reaps-guard-job"}[cancelGuard], func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			request := privateConnectorRequest()
			grant := privateConnectorGrant(request)
			challenge := steamapi.PrivateChallenge{Job: request.Job, Nonce: request.Nonce, ChallengeID: strings.Repeat("c", 32), Kind: "device_code"}
			challengeSeen := make(chan struct{}, 1)
			result := make(chan error, 4)
			reaped := make(chan struct{})
			var closeReaped sync.Once
			runner := privateRunnerFunc(func(ctx context.Context, v steamapi.PrivateRequest, emit func(steamapi.PrivateEvent) error, guard func(context.Context, steamapi.PrivateChallenge) (steamapi.PrivateReply, error)) error {
				defer closeReaped.Do(func() { close(reaped) })
				if v.Server != grant.Server || v.Job != grant.Job {
					return errors.New("fixture binding mismatch")
				}
				reply, e := guard(ctx, challenge)
				if cancelGuard {
					return e
				}
				if e != nil || reply.Code == nil || *reply.Code != "synthetic-fixture-guard" {
					return errors.New("fixture Guard mismatch")
				}
				return emit(steamapi.PrivateEvent{Version: steamapi.PrivateVersion, Type: "result"})
			})
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Header.Get("Authorization") != "Bearer connector-fixture-only" {
					w.WriteHeader(403)
					return
				}
				ws, e := (&websocket.Upgrader{}).Upgrade(w, r, nil)
				if e != nil {
					return
				}
				defer ws.Close()
				if r.URL.Path == "/api/remote/connector" {
					var hello struct {
						Capabilities []string `json:"capabilities"`
					}
					if ws.ReadJSON(&hello) != nil {
						result <- errors.New("missing hello")
						return
					}
					caps := map[string]bool{}
					for _, c := range hello.Capabilities {
						caps[c] = true
					}
					if !caps[steamapi.PrivateCapability] || !caps[steamapi.PrivateAppCapability(2394010)] || caps[steamapi.PrivateAppCapability(42)] || !caps[NetworkCapability] {
						result <- errors.New("readiness capability mismatch")
						return
					}
					if ws.WriteJSON(map[string]any{"type": "open", "id": "private-run", "service": steamapi.PrivateStreamService, "private_grant": grant}) != nil {
						return
					}
					select {
					case <-challengeSeen:
						if cancelGuard {
							cancel()
							return
						}
						replyGrant := grant
						replyGrant.Action = "reply"
						if ws.WriteJSON(map[string]any{"type": "open", "id": "private-reply", "service": steamapi.PrivateStreamService, "private_grant": replyGrant}) != nil {
							return
						}
					case <-ctx.Done():
						return
					}
					for {
						if _, _, e = ws.ReadMessage(); e != nil {
							return
						}
					}
				}
				conn := nodetunnel.NewConn(ws)
				defer conn.Close()
				_ = conn.SetDeadline(time.Now().Add(5 * time.Second))
				var value any
				path := "/run"
				if strings.HasSuffix(r.URL.Path, "private-run") {
					value = request
				} else {
					path = "/reply"
					code := "synthetic-fixture-guard"
					value = steamapi.PrivateReply{PrivateChallenge: challenge, Code: &code}
				}
				raw, _ := json.Marshal(value)
				req, _ := http.NewRequest("POST", "http://private"+path, bytes.NewReader(raw))
				req.Header.Set("X-Private-Owner", "forged-owner")
				if e = req.Write(conn); e != nil {
					result <- e
					return
				}
				response, e := http.ReadResponse(bufio.NewReader(conn), req)
				if e != nil {
					if !cancelGuard {
						result <- e
					}
					return
				}
				defer response.Body.Close()
				if path == "/reply" {
					if response.StatusCode != 204 {
						result <- errors.New("new reply stream did not reach shared broker")
					}
					return
				}
				if response.StatusCode != 200 {
					result <- errors.New("run stream rejected")
					return
				}
				scanner := bufio.NewScanner(response.Body)
				for scanner.Scan() {
					var event steamapi.PrivateEvent
					if json.Unmarshal(scanner.Bytes(), &event) != nil {
						result <- errors.New("invalid event")
						return
					}
					if event.Type == "guard_required" {
						challengeSeen <- struct{}{}
					}
					if event.Type == "result" {
						result <- nil
						return
					}
				}
			}))
			defer server.Close()
			runDone := make(chan error, 1)
			go func() {
				runDone <- Run(ctx, Config{PanelURL: server.URL, Token: "connector-fixture-only", WingsAddress: "127.0.0.1:1", PrivateSteam: &PrivateSteamConnectorConfig{Runner: runner, Readiness: privateConnectorFixtureReadiness{true}}})
			}()
			if !cancelGuard {
				select {
				case e := <-result:
					if e != nil {
						t.Fatal(e)
					}
					cancel()
				case <-time.After(5 * time.Second):
					t.Fatal("run/reply stream timed out")
				}
			}
			select {
			case <-reaped:
			case <-time.After(5 * time.Second):
				t.Fatal("pending runner not reaped")
			}
			cancel()
			select {
			case e := <-runDone:
				if e != nil {
					t.Fatal(e)
				}
			case <-time.After(3 * time.Second):
				t.Fatal("control generation did not close streams and join")
			}
		})
	}
}
