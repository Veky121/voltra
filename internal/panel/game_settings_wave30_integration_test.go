package panel

import (
	"bytes"
	"context"
	"encoding/json"
	"github.com/jackc/pgx/v5/pgxpool"
	"net/http/httptest"
	"os"
	"regexp"
	"strings"
	"testing"
	"time"
)

func TestWave30SettingsAPI(t *testing.T) {
	for _, tc := range []struct {
		recipe, file, data, key string
		value                   any
	}{
		{aapgSettingsRecipe, aapgSettingsPath, "[AAGame.AAGameReplicationInfo]\r\nbDefaultHardcoreMode=false\r\nUnknown=keep\r\n[Engine.AccessControl]\r\nAdminPassword=fixture-secret\r\n", "AAGame.AAGameReplicationInfo/bDefaultHardcoreMode", true},
		{sandstormSettingsRecipe, sandstormSettingsPath, "[/Script/Insurgency.INSGameMode]\r\nbKillFeed=False\r\nPassword=fixture-secret\r\nUnknown=keep\r\n", "/Script/Insurgency.INSGameMode/bKillFeed", true},
		{"humanitz/egg-humanit-z.json", "/HumanitZServer/GameServerSettings.ini", "[Host Settings]\r\nPassword=fixture-secret\r\n[World Settings]\r\nPVP=0\r\nUnknown=keep\r\n", "World Settings/PVP", true},
		{"humanitz/egg-humanit-z.json", "/TSSGame/GameServerSettings.ini", "[Host Settings]\r\nPassword=fixture-secret\r\n[World Settings]\r\nPVP=0\r\nUnknown=keep\r\n", "World Settings/PVP", true},
	} {
		t.Run(tc.recipe, func(t *testing.T) {
			a, mux, admin, server, f := quickSetupMinecraftFixture(t)
			ctx := context.Background()
			var fixtureSchema string
			if e := a.DB.QueryRow(ctx, "SELECT current_schema()").Scan(&fixtureSchema); e != nil {
				t.Fatal(e)
			}
			t.Logf("unique schema %s; infraTestApp cleanup drops it", fixtureSchema)
			var entry gameTemplate
			for _, e := range gameTemplates().Entries {
				if e.Path == tc.recipe {
					entry = e
				}
			}
			startup := str(entry.Egg["startup"])
			if _, err := a.insert(ctx, "allocations", M{"node_id": server["node_id"], "server_id": server["id"], "ip": "127.0.0.1", "port": 29372}); err != nil {
				t.Fatal(err)
			}
			allocation, err := a.insert(ctx, "allocations", M{"node_id": server["node_id"], "server_id": server["id"], "ip": "127.0.0.1", "port": 29371})
			if err != nil {
				t.Fatal(err)
			}
			if _, err = a.update(ctx, "servers", num(server["id"]), M{"allocation_id": allocation["id"]}); err != nil {
				t.Fatal(err)
			}
			if _, err := a.update(ctx, "eggs", num(server["egg_id"]), M{"uuid": gameTemplateEggUUID(entry), "startup": startup, "config_files": M{}, "java_config": M{}}); err != nil {
				t.Fatal(err)
			}
			if _, err := a.update(ctx, "servers", num(server["id"]), M{"startup": startup}); err != nil {
				t.Fatal(err)
			}
			script := str(asMap(asMap(entry.Egg["scripts"])["installation"])["script"])
			for _, chunk := range strings.Split(script, "cat > ")[1:] {
				head, body, ok := strings.Cut(chunk, "\n")
				if !ok {
					continue
				}
				name, marker, ok := strings.Cut(head, " <<'")
				if !ok || !strings.HasPrefix(name, ".voltra/") {
					continue
				}
				marker = strings.TrimSuffix(marker, "'")
				expected, _, ok := strings.Cut(body, "\n"+marker+"\n")
				if !ok {
					t.Fatal(name)
				}
				f.Files["/"+name] = []byte(expected + "\n")
			}
			f.Files[tc.file] = []byte(tc.data)
			if strings.HasPrefix(tc.file, "/HumanitZServer/") {
				f.Files["/HumanitZServer/Binaries/Linux/HumanitZServer-Linux-Shipping"] = []byte("fixture binary, metadata only")
			}
			if strings.HasPrefix(tc.file, "/TSSGame/") {
				f.Files["/TSSGame/Binaries/Linux/TSSGameServer-Linux-Shipping"] = []byte("fixture binary, metadata only")
			}
			// Replace only this isolated fixture egg's variables with canonical declarations.
			if err := a.exec(ctx, "DELETE FROM egg_variables WHERE egg_id=$1", server["egg_id"]); err != nil {
				t.Fatal(err)
			}
			for _, raw := range asSlice(entry.Egg["variables"]) {
				v := asMap(raw)
				if _, err := a.insert(ctx, "egg_variables", M{"egg_id": server["egg_id"], "name": v["name"], "env_variable": v["env_variable"], "default_value": func() any {
					if str(v["env_variable"]) == "INSTALL_MODE" {
						return "operator_files"
					}
					if str(v["env_variable"]) == "SERVER_QUERY_PORT" {
						return "29372"
					}
					if str(v["env_variable"]) == "SERVER_PORT" {
						return "29371"
					}
					if str(v["env_variable"]) == "VOLTRA_STEAM_AUTO_UPDATE" {
						return "0"
					}
					return v["default_value"]
				}(), "user_viewable": true, "user_editable": true, "rules": "nullable"}); err != nil {
					t.Fatal(err)
				}
			}

			endpoint := "/api/client/servers/" + str(server["uuid_short"]) + "/game-settings"

			view := asMap(infraExpect(t, mux, admin, "GET", endpoint, nil, 200)["attributes"])
			if str(view["file"]) != tc.file {
				t.Fatalf("wrong document %v", view)
			}
			raw, _ := json.Marshal(view)
			if strings.Contains(string(raw), "fixture-secret") {
				t.Fatal("secret leak")
			}
			if len(asSlice(view["fields"])) < 1 {
				t.Fatalf("existing-only fields: %v", view)
			}
			// Both public parser entrypoints retain the shared dispatch contract.
			boundEgg, e := a.one(ctx, "SELECT * FROM eggs WHERE id=$1", server["egg_id"])
			if e != nil {
				t.Fatal(e)
			}
			boundEgg["_campaign_parser_path"] = tc.file
			direct, e := parseGameSettingsForEgg(boundEgg, tc.file, []byte(tc.data))
			if e != nil {
				t.Fatal(e)
			}
			discovered, e := parseDiscoveredGameSettings(boundEgg, tc.file, []byte(tc.data))
			if e != nil || len(direct.fields) != len(discovered.fields) {
				t.Fatal("entrypoint mismatch")
			}
			if _, e = parseGameSettingsForEgg(boundEgg, "/wrong.ini", []byte(tc.data)); e == nil {
				t.Fatal("unbound direct parser accepted")
			}
			before := f.Writes
			infraExpect(t, mux, admin, "PUT", endpoint, M{"revision": view["revision"], "settings": M{tc.key: tc.value}}, 200)
			if f.Writes != before+1 {
				t.Fatal("safe stock document did not write")
			}
			if strings.Contains(tc.data, "fixture-secret") && !bytes.Contains(f.Files[tc.file], []byte("fixture-secret")) {
				t.Fatal("credentials changed")
			}
			if !bytes.Contains(f.Files[tc.file], []byte("Unknown=keep\r\n")) {
				t.Fatal("unknown bytes changed")
			}
			if bytes.Equal(f.Files[tc.file], []byte(tc.data)) {
				t.Fatal("reread did not contain changed native value")
			}
			// The patch must preserve every byte outside the selected scalar.
			expected := strings.Replace(tc.data, "bDefaultHardcoreMode=false", "bDefaultHardcoreMode=true", 1)
			expected = strings.Replace(expected, "bKillFeed=False", "bKillFeed=True", 1)
			expected = strings.Replace(expected, "PVP=0", "PVP=1", 1)
			if string(f.Files[tc.file]) != expected {
				t.Fatal("unexpected byte change")
			}
			f.Files["/Mods/arbitrary-plugin.cfg"] = []byte("plugin may override effective settings")
			infraExpect(t, mux, admin, "GET", endpoint, nil, 200)
			view = asMap(infraExpect(t, mux, admin, "GET", endpoint, nil, 200)["attributes"])
			change := M{tc.key: tc.value}
			input := M{"revision": view["revision"], "settings": change}
			noWrite := f.Writes
			f.State = "running"
			infraExpect(t, mux, admin, "PUT", endpoint, input, 409)
			f.State = "offline"
			infraExpect(t, mux, admin, "PUT", endpoint, M{"revision": "stale", "settings": change}, 409)
			reader, err := a.insert(ctx, "users", M{"uuid": newUUID(), "username": "campaign-reader", "email": "campaign-reader@example.invalid"})
			if err != nil {
				t.Fatal(err)
			}
			if _, err = a.insert(ctx, "subusers", M{"user_id": reader["id"], "server_id": server["id"], "permissions": []string{"file.read-content"}}); err != nil {
				t.Fatal(err)
			}
			infraExpect(t, mux, num(reader["id"]), "GET", endpoint, nil, 200)
			infraExpect(t, mux, num(reader["id"]), "PUT", endpoint, input, 403)
			if f.Writes != noWrite {
				t.Fatal("running/stale/RBAC denial wrote")
			}
			var current M
			for _, mutation := range []string{"startup", "helper"} {
				// Deterministic DB lock contention: observe the actual waiter before
				// revoking its startup authority. No delay stands in for admission.
				current = asMap(infraExpect(t, mux, admin, "GET", endpoint, nil, 200)["attributes"])
				lockCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
				defer cancel()
				tx, e := a.DB.Begin(lockCtx)
				if e != nil {
					t.Fatal(e)
				}
				defer tx.Rollback(ctx)
				var pid int
				if e = tx.QueryRow(lockCtx, "SELECT pg_backend_pid()").Scan(&pid); e != nil {
					t.Fatal(e)
				}
				if _, e = tx.Exec(lockCtx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "voltra:server-mutation:"+str(server["uuid"])); e != nil {
					t.Fatal(e)
				}
				body, _ := json.Marshal(M{"revision": current["revision"], "settings": change})
				req := WithUser(httptest.NewRequest("PUT", endpoint, bytes.NewReader(body)).WithContext(lockCtx), admin)
				req.Header.Set("Content-Type", "application/json")
				rec := httptest.NewRecorder()
				done := make(chan struct{})
				go func() { defer close(done); mux.ServeHTTP(rec, req) }()
				ticker := time.NewTicker(10 * time.Millisecond)
				defer ticker.Stop()
				for {
					var blocked bool
					if e = a.DB.QueryRow(lockCtx, "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1::int=ANY(pg_blocking_pids(pid)))", pid).Scan(&blocked); e != nil {
						t.Fatal(e)
					}
					if blocked {
						break
					}
					select {
					case <-done:
						t.Fatal("save did not wait")
					case <-lockCtx.Done():
						t.Fatal("waiter deadline")
					case <-ticker.C:
					}
				}
				writes := f.Writes
				var helper string
				var saved []byte
				if mutation == "helper" {
					for name, data := range f.Files {
						if strings.HasPrefix(name, "/.voltra/") {
							helper, saved = name, data
							break
						}
					}
					if helper == "" {
						t.Fatal("no emitted helper")
					}
					f.Files[helper] = []byte("changed helper")
				} else if _, e = a.update(ctx, "servers", num(server["id"]), M{"startup": "custom-launcher"}); e != nil {
					t.Fatal(e)
				}
				if e = tx.Commit(lockCtx); e != nil {
					t.Fatal(e)
				}
				select {
				case <-done:
				case <-lockCtx.Done():
					t.Fatal("save deadline")
				}
				if rec.Code != 404 || f.Writes != writes {
					t.Fatalf("contended startup revocation status=%d writes=%d", rec.Code, f.Writes-writes)
				}
				if helper != "" {
					f.Files[helper] = saved
				}
				if _, e = a.update(ctx, "servers", num(server["id"]), M{"startup": startup}); e != nil {
					t.Fatal(e)
				}

			}

			// Competing saves share the same revision: exactly one may publish.
			f.Files[tc.file] = []byte(tc.data)
			if strings.HasPrefix(tc.file, "/HumanitZServer/") {
				f.Files["/HumanitZServer/Binaries/Linux/HumanitZServer-Linux-Shipping"] = []byte("fixture binary, metadata only")
			}
			if strings.HasPrefix(tc.file, "/TSSGame/") {
				f.Files["/TSSGame/Binaries/Linux/TSSGameServer-Linux-Shipping"] = []byte("fixture binary, metadata only")
			}
			current = asMap(infraExpect(t, mux, admin, "GET", endpoint, nil, 200)["attributes"])
			payload, _ := json.Marshal(M{"revision": current["revision"], "settings": change})
			results := make(chan int, 2)
			writes := f.Writes
			for range 2 {
				go func() {
					r := WithUser(httptest.NewRequest("PUT", endpoint, bytes.NewReader(payload)), admin)
					r.Header.Set("Content-Type", "application/json")
					w := httptest.NewRecorder()
					mux.ServeHTTP(w, r)
					results <- w.Code
				}()
			}
			c1, c2 := <-results, <-results
			if !((c1 == 200 && c2 == 409) || (c1 == 409 && c2 == 200)) || f.Writes != writes+1 {
				t.Fatalf("concurrent saves %d/%d writes %d", c1, c2, f.Writes-writes)
			}
			if _, err := a.update(ctx, "servers", num(server["id"]), M{"startup": "custom startup"}); err != nil {
				t.Fatal(err)
			}
			infraExpect(t, mux, admin, "GET", endpoint, nil, 404)
		})
	}
}

// Read-only verification of cleanup for this wave's recorded isolated fixtures.
func TestWave30FixtureCleanup(t *testing.T) {
	cfg, err := pgxpool.ParseConfig(os.Getenv("TEST_DATABASE_URL"))
	if err != nil {
		t.Fatal("invalid test database")
	}
	if cfg.ConnConfig.Port != 55439 || cfg.ConnConfig.Host != "127.0.0.1" {
		t.Fatal("expected isolated local55439")
	}
	pool, err := pgxpool.NewWithConfig(context.Background(), cfg)
	if err != nil {
		t.Fatal("database unavailable")
	}
	defer pool.Close()
	logs, err := os.ReadDir("../../artifacts/game-parity-20261029/wave30-settings-integration")
	if err != nil {
		t.Fatal(err)
	}
	count := 0
	for _, entry := range logs {
		if !strings.HasSuffix(entry.Name(), ".log") {
			continue
		}
		data, err := os.ReadFile("../../artifacts/game-parity-20261029/wave30-settings-integration/" + entry.Name())
		if err != nil {
			t.Fatal(err)
		}
		for _, name := range regexp.MustCompile(`infra_[a-f0-9]{32}`).FindAllString(strings.ReplaceAll(string(data), "\x00", ""), -1) {
			var exists bool
			if err := pool.QueryRow(context.Background(), "SELECT EXISTS(SELECT 1 FROM information_schema.schemata WHERE schema_name=$1)", name).Scan(&exists); err != nil {
				t.Fatal("cleanup query failed")
			}
			if exists {
				t.Fatalf("fixture schema remains: %s", name)
			}
			count++
		}
	}
	t.Logf("verified %d recorded schema references absent", count)
}
