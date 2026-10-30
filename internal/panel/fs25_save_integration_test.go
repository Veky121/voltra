package panel

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestFS25SaveRoutesAndPowerGuard(t *testing.T) {
	for _, mode := range []string{"save", "stop", "restart", "unavailable", "stale", "stop-unconfirmed", "kill", "denied"} {
		t.Run(mode, func(t *testing.T) {
			f := operationsFixtureNew(t)
			ctx := context.Background()
			if _, err := f.a.update(ctx, "eggs", num(f.server["egg_id"]), M{"features": []any{"voltra_fs25"}}); err != nil {
				t.Fatal(err)
			}
			v, err := f.a.insert(ctx, "egg_variables", M{"egg_id": f.server["egg_id"], "name": "Save bridge", "env_variable": "VOLTRA_FS25_SAVE", "default_value": "false", "rules": "required|in:true,false"})
			if err != nil {
				t.Fatal(err)
			}
			if _, err = f.a.insert(ctx, "server_variables", M{"server_id": f.server["id"], "variable_id": v["id"], "variable_value": "true"}); err != nil {
				t.Fatal(err)
			}
			var mu sync.Mutex
			var request M
			powerCalls, reads := 0, 0
			f.daemon.Config.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				mu.Lock()
				defer mu.Unlock()
				switch {
				case strings.HasSuffix(r.URL.Path, "/files/contents"):
					reads++
					if strings.HasSuffix(r.URL.Query().Get("file"), "state.json") {
						if mode == "unavailable" {
							w.WriteHeader(404)
							return
						}
						updated := time.Now().UnixMilli()
						if mode == "stale" {
							updated -= 20000
						}
						writeJSON(w, 200, M{"protocol": 1, "session": "boot", "updated_at": updated, "busy": false})
					} else {
						writeJSON(w, 200, M{"id": request["id"], "session": "boot", "success": true, "stopped": mode != "stop-unconfirmed"})
					}
				case strings.HasSuffix(r.URL.Path, "/files/write"):
					if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
						t.Error(err)
					}
					w.WriteHeader(204)
				case strings.HasSuffix(r.URL.Path, "/power"):
					powerCalls++
					w.WriteHeader(204)
				default:
					t.Errorf("unexpected daemon path %s", r.URL.Path)
					w.WriteHeader(500)
				}
			})
			path := "/power"
			body := M{"signal": "stop"}
			user := f.owner
			if mode == "save" || mode == "denied" {
				path = "/fs25/save"
				body = M{}
			}
			if mode == "restart" || mode == "kill" {
				body["signal"] = mode
			}
			if mode == "denied" {
				user = f.sub
			}
			response := f.request("POST", f.serverPath(path), body, user)
			expected := 204
			if mode == "unavailable" || mode == "stale" || mode == "stop-unconfirmed" {
				expected = 422
			}
			if mode == "denied" {
				expected = 403
			}
			operationsExpect(t, response, expected)
			mu.Lock()
			defer mu.Unlock()
			if mode == "stop" || mode == "restart" || mode == "kill" {
				if powerCalls != 1 {
					t.Fatalf("power calls %d", powerCalls)
				}
			} else if powerCalls != 0 {
				t.Fatal("unconfirmed or unauthorized request sent power")
			}
			if mode == "kill" || mode == "denied" {
				if reads != 0 || request != nil {
					t.Fatal("kill/denied request entered save protocol")
				}
			}
			if mode == "stop" || mode == "restart" {
				if request["action"] != "save-and-stop" {
					t.Fatal(request)
				}
			}
		})
	}
}
