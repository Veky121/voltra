package nodeagent

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
	"voltra/internal/steamapi"
)

type privateRecoveryDeadlineFixture struct {
	*privateRecoveryBrokerFixture
	inspect func(context.Context, steamapi.PrivateReceiptRecoveryRequest)
}

func (f privateRecoveryDeadlineFixture) Recover(ctx context.Context, v steamapi.PrivateReceiptRecoveryRequest, _ func(steamapi.PrivateEvent) error) error {
	f.inspect(ctx, v)
	return nil
}
func TestPrivateRecoveryHTTPUsesOriginalDeadlineAndCaller(t *testing.T) {
	for _, shorter := range []bool{false, true} {
		t.Run(map[bool]string{false: "original7200", true: "shorter-caller"}[shorter], func(t *testing.T) {
			v, _ := privateRecoveryBrokerRequest(t, 1)
			v.Original.DeadlineSeconds = 7200
			scope := v.Original.Request().Scope()
			var got time.Time
			fixture := &privateRecoveryBrokerFixture{}
			fixture.ready.Store(true)
			runner := privateRecoveryDeadlineFixture{privateRecoveryBrokerFixture: fixture, inspect: func(ctx context.Context, request steamapi.PrivateReceiptRecoveryRequest) {
				got, _ = ctx.Deadline()
				if request.Original.Request().Scope() != scope {
					t.Fatal("broker changed original scope")
				}
			}}
			handler := NewPrivateSteamHandler(runner, func(*http.Request) (PrivatePrincipal, error) {
				return PrivatePrincipal{Session: "fixture", Server: v.Original.Server, Owner: v.Original.Owner}, nil
			})
			raw, _ := json.Marshal(v)
			parent := context.Background()
			want := time.Time{}
			if shorter {
				var cancel context.CancelFunc
				want = time.Now().Add(time.Second)
				parent, cancel = context.WithDeadline(parent, want)
				defer cancel()
			}
			r := httptest.NewRequest("POST", "http://private/recover", bytes.NewReader(raw)).WithContext(parent)
			w := httptest.NewRecorder()
			start := time.Now()
			handler.ServeHTTP(w, r)
			end := time.Now()
			if w.Code != 200 || got.IsZero() {
				t.Fatal("broker did not call recovery", w.Code)
			}
			if shorter {
				if !got.Equal(want) {
					t.Fatal("caller deadline ignored")
				}
			} else if got.Before(start.Add(2*time.Hour)) || got.After(end.Add(2*time.Hour)) {
				t.Fatal("HTTP still capped recovery", got.Sub(start))
			}
		})
	}
}
