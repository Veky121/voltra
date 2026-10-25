package nodeagent

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"github.com/gorilla/websocket"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
	"voltra/internal/nodetunnel"
	"voltra/internal/steamapi"
)

func TestPrivateRecoveryRealAuthenticatedControlAndDataStream(t *testing.T) {
	for _, cancelActive := range []bool{false, true} {
		t.Run(map[bool]string{false: "result", true: "control-cancel-joins"}[cancelActive], func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			v, grant := privateRecoveryBrokerRequest(t, 1)
			fixture := &privateRecoveryBrokerFixture{}
			fixture.ready.Store(true)
			if cancelActive {
				fixture.entered = make(chan struct{})
				fixture.release = make(chan struct{})
			}
			result := make(chan error, 2)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Header.Get("Authorization") != "Bearer recovery-control-fixture-only" {
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
						return
					}
					found := false
					for _, cap := range hello.Capabilities {
						if cap == steamapi.PrivateRecoveryAppCapability(2394010) {
							found = true
						}
					}
					if !found {
						result <- errors.New("recovery capability missing")
						return
					}
					if e := ws.WriteJSON(map[string]any{"type": "open", "id": "recover-original", "service": steamapi.PrivateStreamService, "private_grant": grant}); e != nil {
						result <- e
						return
					}
					if cancelActive {
						select {
						case <-fixture.entered:
							cancel()
							return
						case <-ctx.Done():
							return
						}
					}
					for {
						if _, _, e := ws.ReadMessage(); e != nil {
							return
						}
					}
				}
				stream := nodetunnel.NewConn(ws)
				defer stream.Close()
				stream.SetDeadline(time.Now().Add(3 * time.Second))
				raw, _ := json.Marshal(v)
				request, _ := http.NewRequest("POST", "http://private/recover", bytes.NewReader(raw))
				request.Header.Set("X-Private-Owner", "forged-owner-not-authority")
				if e := request.Write(stream); e != nil {
					if !cancelActive {
						result <- e
					}
					return
				}
				response, e := http.ReadResponse(bufio.NewReader(stream), request)
				if e != nil {
					if !cancelActive {
						result <- e
					}
					return
				}
				defer response.Body.Close()
				var event steamapi.PrivateEvent
				if e := json.NewDecoder(response.Body).Decode(&event); !cancelActive {
					if e != nil {
						result <- e
					} else if response.StatusCode != 200 || event.Stage != "fixture-only-recovery" || event.NativeAcceptanceVerified {
						result <- errors.New("recovery mechanical event mismatch")
					} else {
						result <- nil
					}
				}
			}))
			defer server.Close()
			done := make(chan error, 1)
			go func() {
				done <- Run(ctx, Config{PanelURL: server.URL, Token: "recovery-control-fixture-only", WingsAddress: "127.0.0.1:1", PrivateSteam: &PrivateSteamConnectorConfig{Runner: fixture, Readiness: fixture}})
			}()
			if !cancelActive {
				select {
				case e := <-result:
					if e != nil {
						t.Fatal(e)
					}
					cancel()
				case <-time.After(5 * time.Second):
					t.Fatal("recovery stream timeout")
				}
			}
			select {
			case e := <-done:
				if e != nil {
					t.Fatal(e)
				}
			case <-time.After(5 * time.Second):
				t.Fatal("recovery stream/worker not joined")
			}
			if fixture.recoveries.Load() != 1 || fixture.runs.Load() != 0 {
				t.Fatal("wrong execution action")
			}
		})
	}
}
