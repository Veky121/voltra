package steamexec

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"
	"voltra/internal/steamapi"
)

func privateRecoveryDeadlineRequest(t *testing.T, seconds uint32) steamapi.PrivateReceiptRecoveryRequest {
	t.Helper()
	r := steamapi.PrivateRequest{Version: steamapi.PrivateVersion, Job: "11111111-1111-1111-1111-111111111111", Server: "22222222-2222-2222-2222-222222222222", Owner: strings.Repeat("a", 64), Nonce: strings.Repeat("b", 64), Selection: steamapi.PrivateSelection{App: 42, Branch: "public", Platform: "linux", Architecture: "64", Language: "english"}, ContentBudget: "1048576", RollbackReserve: "4096", CacheQuota: "1048576", DeadlineSeconds: 1}
	o, e := steamapi.PrivateRecoveryOriginalFromRequest(r)
	if e != nil {
		t.Fatal(e)
	}
	o.DeadlineSeconds = seconds
	return steamapi.PrivateReceiptRecoveryRequest{Version: steamapi.PrivateRecoveryCapability, RecoveryID: "33333333-3333-3333-3333-333333333333", Original: o}
}
func TestPrivateRecoveryContextValidatedOriginalDeadline(t *testing.T) {
	for _, seconds := range []uint32{1, 30, 120, 7200, 0, 7201} {
		t.Run(fmt.Sprintf("%ds", seconds), func(t *testing.T) {
			v := privateRecoveryDeadlineRequest(t, seconds)
			before, _ := json.Marshal(v)
			scope := v.Original.Request().Scope()
			start := time.Now()
			ctx, cancel, e := PrivateRecoveryContext(context.Background(), v, time.Time{})
			end := time.Now()
			if seconds == 0 || seconds > 7200 {
				if e == nil || ctx != nil || cancel != nil {
					t.Fatal("invalid deadline admitted")
				}
				return
			}
			if e != nil {
				t.Fatal(e)
			}
			defer cancel()
			deadline, ok := ctx.Deadline()
			if !ok || deadline.Before(start.Add(time.Duration(seconds)*time.Second)) || deadline.After(end.Add(time.Duration(seconds)*time.Second)) {
				t.Fatal("original bound changed", seconds, deadline.Sub(start))
			}
			after, _ := json.Marshal(v)
			if string(before) != string(after) || scope != v.Original.Request().Scope() {
				t.Fatal("serialized original/scope changed")
			}
		})
	}
}
func TestPrivateRecoveryContextCallerAuthorityAndCancellation(t *testing.T) {
	v := privateRecoveryDeadlineRequest(t, 7200)
	now := time.Now()
	for _, pair := range []struct {
		name                   string
		caller, approval, want time.Time
	}{{"caller", now.Add(time.Second), now.Add(time.Minute), now.Add(time.Second)}, {"authority", now.Add(time.Minute), now.Add(time.Second), now.Add(time.Second)}, {"past-approval", now.Add(time.Minute), now.Add(-time.Second), now.Add(-time.Second)}} {
		t.Run(pair.name, func(t *testing.T) {
			parent, stop := context.WithDeadline(context.Background(), pair.caller)
			defer stop()
			ctx, cancel, e := PrivateRecoveryContext(parent, v, pair.approval)
			if e != nil {
				t.Fatal(e)
			}
			defer cancel()
			got, _ := ctx.Deadline()
			if !got.Equal(pair.want) {
				t.Fatal("shorter bound not preserved", got, pair.want)
			}
			if pair.name == "past-approval" && ctx.Err() != context.DeadlineExceeded {
				t.Fatal("expired approval not immediately canceled")
			}
		})
	}
	parent, stop := context.WithCancel(context.Background())
	stop()
	ctx, cancel, e := PrivateRecoveryContext(parent, v, time.Time{})
	if e != nil {
		t.Fatal(e)
	}
	defer cancel()
	if ctx.Err() != context.Canceled {
		t.Fatal("caller cancellation lost")
	}
}
