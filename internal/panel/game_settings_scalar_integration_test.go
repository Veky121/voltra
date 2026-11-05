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
func TestIntegratedScalarStartupChangedWhileSaveLocked(t *testing.T) {
	for _, recipe := range []string{towerSettingsRecipe, "windrose/egg-windrose.json", "terratech_worlds/egg-terra-tech-worlds.json"} {
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
			file, key, original := "/data/Config/options.json", "upnp", "{\"upnp\":false,\"passwordSalt\":\"private\"}\r\n"
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
			file, key, original = scalarSettingsTestInput(recipe)
			fixture.mu.Lock()
			delete(fixture.Files, "/server.properties")
			fixture.Files[file] = []byte(original)
			fixture.State = "offline"
			fixture.mu.Unlock()
			route := "/api/client/servers/" + str(server["uuid_short"]) + "/game-settings?file=" + file
			outsider, err := a.insert(context.Background(), "users", M{"uuid": newUUID(), "username": "scalar_outsider", "email": "scalar-outside@example.invalid"})
			if err != nil {
				t.Fatal(err)
			}
			infraExpect(t, mux, num(outsider["id"]), "GET", route, nil, 404)
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
			body, err := json.Marshal(M{"revision": view["revision"], "settings": M{key: scalarSettingsTestValue(file)}})
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

func scalarSettingsTestInput(recipe string) (string, string, string) {
	switch recipe {
	case towerSettingsRecipe:
		return towerSettingsPath, "DedicatedCondoOptions/CondoAutoSave", "[/Script/TowerNetworking.DedicatedServerOptions]\r\nServerTitle=Operator\r\n[DedicatedCondoOptions]\r\nCondoAutoSave=False\r\nCondoBackupsEnabled=True\r\n"
	case "windrose/egg-windrose.json":
		return windroseSettingsPath, windroseSettingsPrefix + "UseDirectConnection", `{"ServerDescription_Persistent":{"PersistentServerId":"id","WorldIslandId":"world","ServerName":"Operator","Password":"private","UseDirectConnection":false,"IsPasswordProtected":true}}`
	default:
		return terraTechSettingsPath, "SlotCount", `{"Password":"private","SlotCount":2,"Port":7777}`
	}
}
func TestIntegratedScalarAPI(t *testing.T) {
	for _, recipe := range []string{towerSettingsRecipe, "windrose/egg-windrose.json", "terratech_worlds/egg-terra-tech-worlds.json"} {
		t.Run(recipe, func(t *testing.T) {
			a, mux, admin, server, fixture := quickSetupMinecraftFixture(t)
			egg := batchSettingsRecipeFixture(t, recipe)
			if _, err := a.update(context.Background(), "eggs", num(server["egg_id"]), egg); err != nil {
				t.Fatal(err)
			}
			if _, err := a.update(context.Background(), "servers", num(server["id"]), M{"startup": egg["startup"]}); err != nil {
				t.Fatal(err)
			}
			file, key, original := scalarSettingsTestInput(recipe)
			fixture.mu.Lock()
			delete(fixture.Files, "/server.properties")
			fixture.Files[file] = []byte(original)
			fixture.State = "offline"
			fixture.mu.Unlock()
			route := "/api/client/servers/" + str(server["uuid_short"]) + "/game-settings?file=" + file
			outsider, err := a.insert(context.Background(), "users", M{"uuid": newUUID(), "username": "scalar_outsider", "email": "scalar-outside@example.invalid"})
			if err != nil {
				t.Fatal(err)
			}
			infraExpect(t, mux, num(outsider["id"]), "GET", route, nil, 404)
			view := asMap(infraExpect(t, mux, admin, "GET", route, nil, 200)["attributes"])
			for _, raw := range asSlice(view["fields"]) {
				f := asMap(raw)
				if boolean(f["secret"]) && f["value"] != nil {
					t.Fatal("secret exposed")
				}
				if str(f["key"]) == windroseSettingsPrefix+"IsPasswordProtected" && (boolean(f["secret"]) || str(f["type"]) != "boolean") {
					t.Fatal("boolean masked")
				}
			}
			value := any(true)
			if file == terraTechSettingsPath {
				value = "3"
			}
			infraExpect(t, mux, admin, "PUT", route, M{"revision": view["revision"], "settings": M{key: value}}, 200)
			infraExpect(t, mux, admin, "PUT", route, M{"revision": view["revision"], "settings": M{key: value}}, 409)
			fixture.mu.Lock()
			fixture.State = "running"
			fixture.mu.Unlock()
			fresh := asMap(infraExpect(t, mux, admin, "GET", route, nil, 200)["attributes"])
			code, _, _ := infraRequest(t, mux, admin, "PUT", route, M{"revision": fresh["revision"], "settings": M{key: value}})
			if code < 400 {
				t.Fatal("running save accepted")
			}
		})
	}
}

func scalarSettingsTestValue(file string) any {
	if file == terraTechSettingsPath {
		return "3"
	}
	return true
}
