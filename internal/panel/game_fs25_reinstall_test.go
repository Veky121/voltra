package panel

import (
	"context"
	"net/http"
	"sync/atomic"
	"testing"
)

func TestFS25ReinstallAutoStartGuards(t *testing.T) {
	for _, kind := range []string{"completed", "newer_cycle", "suspended", "already_running", "maintenance"} {
		t.Run(kind, func(t *testing.T) {
			f := operationsFixtureNew(t)
			cycle := "complete:reinstall:test"
			changes := M{"installation_id": cycle, "status": nil}
			if kind == "newer_cycle" {
				changes["installation_id"] = "pending:reinstall:new"
			}
			if kind == "suspended" {
				changes["status"] = "suspended"
			}
			if _, err := f.a.update(context.Background(), "servers", num(f.server["id"]), changes); err != nil {
				t.Fatal(err)
			}
			if kind == "maintenance" {
				if _, err := f.a.update(context.Background(), "nodes", num(f.node["id"]), M{"maintenance_mode": true}); err != nil {
					t.Fatal(err)
				}
			}
			var starts atomic.Int32
			f.daemon.Config.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method == "POST" {
					if r.URL.Path != "/api/servers/"+str(f.server["uuid"])+"/power" {
						t.Errorf("unexpected mutation %s", r.URL.Path)
					}
					starts.Add(1)
					w.WriteHeader(202)
					return
				}
				state := "offline"
				if kind == "already_running" {
					state = "running"
				}
				writeJSON(w, 200, M{"state": state})
			})
			f.a.startFS25AfterReinstall(num(f.server["id"]), cycle)
			want := int32(0)
			if kind == "completed" {
				want = 1
			}
			if starts.Load() != want {
				t.Fatalf("starts=%d want=%d", starts.Load(), want)
			}
		})
	}
}
