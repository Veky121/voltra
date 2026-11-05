package panel

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// Hold the real PostgreSQL mutation lock and observe the pending request's
// blocker before changing its launcher. Admission-time validation alone cannot
// protect a write which has already been admitted and is waiting for this lock.
func TestReviewedNewStartupChangedWhileSaveLocked(t *testing.T) {
	for _, recipe := range []string{"arma/arma3/egg-arma3.json", reforgerSettingsRecipe, foundryVTTRecipe, fiveMRecipe, sonsSettingsRecipe, resoniteSettingsRecipe, "ddnet/egg-d-d-net.json"} {
		for _, mutation := range []string{"startup", "helper", "allocation"} {
			if mutation == "allocation" && recipe != reforgerSettingsRecipe {
				continue
			}
			if mutation == "helper" && recipe != "arma/arma3/egg-arma3.json" && recipe != reforgerSettingsRecipe && recipe != fiveMRecipe {
				continue
			}
			t.Run(recipe+"/"+mutation, func(t *testing.T) {
				a, mux, admin, server, fixture := quickSetupMinecraftFixture(t)
				ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
				defer cancel()
				egg := batchSettingsRecipeFixture(t, recipe)
				if _, err := a.update(ctx, "eggs", num(server["egg_id"]), egg); err != nil {
					t.Fatal(err)
				}
				if _, err := a.update(ctx, "servers", num(server["id"]), M{"startup": egg["startup"]}); err != nil {
					t.Fatal(err)
				}
				file, key, original := "/data/Config/options.json", "upnp", "{\"upnp\":false,\"passwordSalt\":\"private\"}\r\n"
				if recipe == "arma/arma3/egg-arma3.json" || recipe == reforgerSettingsRecipe {
					wave95InstallReviewed(t, a, server, fixture, egg)
				}
				if recipe == fiveMRecipe {
					wave95InstallReviewed(t, a, server, fixture, egg)
					file, key, original = "/server.cfg", "sv_lan", "sv_lan 0\r\nsv_hostname \"operator\"\r\nsv_licenseKey private\r\n"
				}
				if recipe == sonsSettingsRecipe {
					file, key, original = sonsSettingsPath, "/LanOnly", "{\"LanOnly\":false,\"Password\":\"private\"}\r\n"
				}
				if recipe == resoniteSettingsRecipe {
					file, _ = reviewedNewSettings(egg)
					key, original = "/startWorlds/0/saveOnExit", "{\"loginPassword\":\"private\",\"startWorlds\":[{\"saveOnExit\":false}]}\r\n"
				}
				if recipe == "ddnet/egg-d-d-net.json" {
					file, key, original = ddnetSettingsPath, "sv_register", ddnetOriginalSeed
				}
				if recipe == "arma/arma3/egg-arma3.json" {
					file, key, original = "/server.cfg", "hostname", `hostname = "old";`
				}
				if recipe == reforgerSettingsRecipe {
					file, key, original = "/config.json", "/game/visible", `{"game":{"visible":false,"maxPlayers":32}}`
				}
				fixture.mu.Lock()
				delete(fixture.Files, "/server.properties")
				fixture.Files[file] = []byte(original)
				fixture.State = "offline"
				fixture.mu.Unlock()
				route := "/api/client/servers/" + str(server["uuid_short"]) + "/game-settings?file=" + file
				view := asMap(infraExpect(t, mux, admin, "GET", route, nil, 200)["attributes"])
				tx, err := a.DB.Begin(ctx)
				if err != nil {
					t.Fatal(err)
				}
				defer tx.Rollback(context.Background())
				var holderPID int
				if err = tx.QueryRow(ctx, "SELECT pg_backend_pid()").Scan(&holderPID); err != nil {
					t.Fatal(err)
				}
				if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "voltra:server-mutation:"+str(server["uuid"])); err != nil {
					t.Fatal(err)
				}
				body, err := json.Marshal(M{"revision": view["revision"], "settings": M{key: true}})
				if err != nil {
					t.Fatal(err)
				}
				req := WithUser(httptest.NewRequest("PUT", route, bytes.NewReader(body)).WithContext(ctx), admin)
				req.Header.Set("Content-Type", "application/json")
				recorder := httptest.NewRecorder()
				done := make(chan struct{})
				go func() { defer close(done); mux.ServeHTTP(recorder, req) }()
				// This queries the actual waiter, rather than assuming a delay means
				// the request has reached the lock.
				ticker := time.NewTicker(10 * time.Millisecond)
				defer ticker.Stop()
				for {
					var blocked bool
					if err = a.DB.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE $1::int = ANY(pg_blocking_pids(pid)))", holderPID).Scan(&blocked); err != nil {
						t.Fatal(err)
					}
					if blocked {
						break
					}
					select {
					case <-done:
						t.Fatal("save finished without waiting for the held mutation lock")
					case <-ctx.Done():
						t.Fatal("save never waited for the mutation lock")
					case <-ticker.C:
					}
				}
				switch mutation {
				case "startup":
					if _, err = a.update(ctx, "servers", num(server["id"]), M{"startup": "./custom-launcher"}); err != nil {
						t.Fatal(err)
					}
				case "helper":
					fixture.mu.Lock()
					for name, body := range fixture.Files {
						if strings.HasPrefix(name, "/.voltra/") {
							fixture.Files[name] = append(append([]byte{}, body...), byte('x'))
							break
						}
					}
					fixture.mu.Unlock()
				case "allocation":
					if _, err = a.insert(ctx, "allocations", M{"node_id": server["node_id"], "server_id": server["id"], "ip": "127.0.0.1", "port": 28001}); err != nil {
						t.Fatal(err)
					}
				}

				if err = tx.Commit(ctx); err != nil {
					t.Fatal(err)
				}
				select {
				case <-done:
				case <-ctx.Done():
					t.Fatal("save did not finish after lock release")
				}
				want := 404
				if mutation == "allocation" {
					want = 409
				}
				if recorder.Code != want {
					t.Fatalf("save with changed %s returned %d, want %d", mutation, recorder.Code, want)
				}
				fixture.mu.Lock()
				unchanged := bytes.Equal(fixture.Files[file], []byte(original))
				fixture.mu.Unlock()
				if !unchanged {
					t.Fatal("rejected save changed native config or secret bytes")
				}
			})
		}
	}
}
