package panel

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http/httptest"
	"testing"
	"time"
)

// Hold the real PostgreSQL mutation lock and observe the pending request's
// blocker before changing its launcher. Admission-time validation alone cannot
// protect a write which has already been admitted and is waiting for this lock.
func TestWave10StartupChangedWhileSaveLocked(t *testing.T) {
	for _, recipe := range []string{redMSettingsRecipe, portalKnightsRecipe} {
		t.Run(recipe, func(t *testing.T) {
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
			file, key, original := redMSettingsPath, "sv_lan", `sv_lan 0
sv_hostname "operator"
sv_licenseKey private
`
			if recipe == portalKnightsRecipe {
				file, key, original = "/dedicated_server/server_config.json", "/users/canLogin", `{"basicServerData":{"name":"operator"},"users":{"canLogin":false}}`
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
			if _, err = a.update(ctx, "servers", num(server["id"]), M{"startup": "./custom-launcher"}); err != nil {
				t.Fatal(err)
			}
			if err = tx.Commit(ctx); err != nil {
				t.Fatal(err)
			}
			select {
			case <-done:
			case <-ctx.Done():
				t.Fatal("save did not finish after lock release")
			}
			if recorder.Code != 404 {
				t.Fatalf("save with changed startup returned %d, want 404", recorder.Code)
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
