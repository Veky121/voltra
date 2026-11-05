package panel

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestWave37SettingsPublicationAPI(t *testing.T) {
	_, err := pgxpool.ParseConfig(isolatedTestDatabaseURL(t))
	if err != nil {
		t.Fatal("invalid isolated test database")
	}

	for _, tc := range []struct {
		recipe, file, data, key string
		value                   any
	}{
		{risingUnityRecipe, "/server.properties", "Server_Name=Original\r\nServer_Password=fixture-secret\r\nUnknown=keep\r\n", "Server_Name", "Changed"},
		{bedrockVanillaRecipe, "/server.properties", "# operator\r\nmax-players=7\r\nallow-list=true\r\nserver-name=Managed\r\npassword=fixture-secret\r\nUnknown=keep\r\n", "max-players", "8"},
		{stationeersVanillaRecipe, "/setting.xml", "<?xml version=\"1.0\"?><SettingData><ServerName>Original</ServerName><ServerMaxPlayers>10</ServerMaxPlayers><AutoSave>true</AutoSave><Password>fixture-secret</Password><Unknown>keep</Unknown></SettingData>", "ServerMaxPlayers", "12"},
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
			if _, err := a.insert(ctx, "allocations", M{"node_id": server["node_id"], "server_id": server["id"], "ip": "127.0.0.1", "port": 29373}); err != nil {
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
			if tc.recipe == "renown/egg-renown.json" {
				f.Files[renownSettingsDirectory+"Game.ini"] = []byte(tc.data)
				f.Files[renownSettingsDirectory+"Engine.ini"] = []byte(tc.data)
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
					if str(v["env_variable"]) == "SERVER_CONFIG_PATH" {
						return "serverconfig_default.txt"
					}
					if str(v["env_variable"]) == "SERVER_COMM_PORT" {
						return "29373"
					}
					if str(v["env_variable"]) == "SERVER_QUERY_PORT" || str(v["env_variable"]) == "QUERY_PORT" {
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

			endpoint := "/api/client/servers/" + str(server["uuid_short"]) + "/game-settings?file=" + tc.file

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
			infraExpect(t, mux, admin, "PUT", endpoint, M{"file": tc.file, "revision": view["revision"], "settings": M{tc.key: tc.value}}, 200)
			if f.Writes != before+1 {
				t.Fatal("safe stock document did not write")
			}
			if strings.Contains(tc.data, "fixture-secret") && !bytes.Contains(f.Files[tc.file], []byte("fixture-secret")) {
				t.Fatal("credentials changed")
			}
			if strings.Contains(tc.data, "Unknown=keep") && !bytes.Contains(f.Files[tc.file], []byte("Unknown=keep\r\n")) {
				t.Fatal("unknown bytes changed")
			}
			if bytes.Equal(f.Files[tc.file], []byte(tc.data)) {
				t.Fatal("reread did not contain changed native value")
			}
			// The patch must preserve every byte outside the selected scalar.
			expected := strings.Replace(tc.data, "bDefaultHardcoreMode=false", "bDefaultHardcoreMode=true", 1)
			expected = strings.Replace(expected, "bKillFeed=False", "bKillFeed=True", 1)
			expected = strings.Replace(expected, "PVP=false", "PVP=true", 1)
			expected = strings.Replace(expected, "friendly_fire false", "friendly_fire true", 1)
			expected = strings.Replace(expected, "creativemode 0", "creativemode 1", 1)
			expected = strings.Replace(expected, "bFreePVP=False", "bFreePVP=True", 1)
			expected = strings.Replace(expected, "mp_timelimit_warmup 5", "mp_timelimit_warmup 10", 1)
			expected = strings.Replace(expected, "CleanLogsOnStart=false", "CleanLogsOnStart=true", 1)
			expected = strings.Replace(expected, "MaxPlayers=32", "MaxPlayers=48", 1)
			expected = strings.Replace(expected, "\"voice\":false", "\"voice\":true", 1)
			expected = strings.Replace(expected, "Server_Name=Original", "Server_Name=Changed", 1)
			expected = strings.Replace(expected, "max-players=7", "max-players=8", 1)
			expected = strings.Replace(expected, "<ServerMaxPlayers>10</ServerMaxPlayers>", "<ServerMaxPlayers>12</ServerMaxPlayers>", 1)
			if string(f.Files[tc.file]) != expected {
				t.Fatal("unexpected byte change")
			}
			f.Files["/Mods/arbitrary-plugin.cfg"] = []byte("plugin may override effective settings")
			infraExpect(t, mux, admin, "GET", endpoint, nil, 200)
			view = asMap(infraExpect(t, mux, admin, "GET", endpoint, nil, 200)["attributes"])
			found := false
			for _, raw := range asSlice(view["fields"]) {
				field := asMap(raw)
				if str(field["key"]) == tc.key {
					found = true
					if field["value"] != tc.value {
						t.Fatalf("reread value %v, expected %v", field["value"], tc.value)
					}
				}
			}
			if !found {
				t.Fatal("reread lost edited field")
			}
			change := M{tc.key: tc.value}
			input := M{"file": tc.file, "revision": view["revision"], "settings": change}
			noWrite := f.Writes
			f.State = "running"
			infraExpect(t, mux, admin, "PUT", endpoint, input, 409)
			f.State = "offline"
			infraExpect(t, mux, admin, "PUT", endpoint, M{"file": tc.file, "revision": "stale", "settings": change}, 409)
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
			// Imported Wings config overrides cannot inherit catalog authority.
			if _, e := a.update(ctx, "eggs", num(server["egg_id"]), M{"config_files": M{tc.file: M{"parser": "file", "find": M{}}}}); e != nil {
				t.Fatal(e)
			}
			infraExpect(t, mux, admin, "GET", endpoint, nil, 404)
			if _, e := a.update(ctx, "eggs", num(server["egg_id"]), M{"config_files": M{}}); e != nil {
				t.Fatal(e)
			}
			if tc.recipe == hurtworldSettingsRecipe {
				f.Files["/autoexec.cfg"] = []byte("exec other.cfg\n")
				infraExpect(t, mux, admin, "GET", endpoint, nil, 404)
				delete(f.Files, "/autoexec.cfg")
			}
			// Revoke startup while the second stopped-state read is in flight,
			// after the post-lock database check but before publication.
			currentView := asMap(infraExpect(t, mux, admin, "GET", endpoint, nil, 200)["attributes"])
			baseClient := a.HTTP
			baseTransport := baseClient.Transport
			if baseTransport == nil {
				baseTransport = http.DefaultTransport
			}
			stateReads := 0
			a.HTTP = &http.Client{Transport: gameLibraryTransport(func(req *http.Request) (*http.Response, error) {
				res, err := baseTransport.RoundTrip(req)
				if err == nil && req.Method == "GET" && req.URL.Path == "/api/servers/"+str(server["uuid"]) {
					stateReads++
					if stateReads == 2 {
						if err := a.exec(ctx, "UPDATE servers SET startup='custom-launcher' WHERE id=$1", server["id"]); err != nil {
							t.Error(err)
						}
					}
				}
				return res, err
			}), Timeout: baseClient.Timeout}
			writesBeforeRevoke := f.Writes
			infraExpect(t, mux, admin, "PUT", endpoint, M{"file": tc.file, "revision": currentView["revision"], "settings": change}, 404)
			a.HTTP = baseClient
			if stateReads != 2 || f.Writes != writesBeforeRevoke {
				t.Fatal("late startup revocation did not refuse without writing")
			}
			if err := a.exec(ctx, "UPDATE servers SET startup=$1 WHERE id=$2", startup, server["id"]); err != nil {
				t.Fatal(err)
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
				body, _ := json.Marshal(M{"file": tc.file, "revision": current["revision"], "settings": change})
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
			if tc.recipe == "renown/egg-renown.json" {
				f.Files[renownSettingsDirectory+"Game.ini"] = []byte(tc.data)
				f.Files[renownSettingsDirectory+"Engine.ini"] = []byte(tc.data)
			}
			f.Files[tc.file] = []byte(tc.data)
			if strings.HasPrefix(tc.file, "/HumanitZServer/") {
				f.Files["/HumanitZServer/Binaries/Linux/HumanitZServer-Linux-Shipping"] = []byte("fixture binary, metadata only")
			}
			if strings.HasPrefix(tc.file, "/TSSGame/") {
				f.Files["/TSSGame/Binaries/Linux/TSSGameServer-Linux-Shipping"] = []byte("fixture binary, metadata only")
			}
			current = asMap(infraExpect(t, mux, admin, "GET", endpoint, nil, 200)["attributes"])
			payload, _ := json.Marshal(M{"file": tc.file, "revision": current["revision"], "settings": change})
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

func TestWave37ManagedAndScalarRefusal(t *testing.T) {
	var egg M
	for _, e := range gameTemplates().Entries {
		if e.Path == bedrockVanillaRecipe {
			egg = e.Egg
		}
	}
	keys := []string{"server-name", "gamemode", "difficulty", "allow-cheats", "online-mode", "server-ip", "server-port", "server-portv6", "enable-lan-visibility", "emit-server-telemetry", "transport", "server-udp-ports"}
	data := "max-players=7\nallow-list=true\n"
	for _, k := range keys {
		data += k + "=original\n"
	}
	p, e := parseGameSettings("/server.properties", []byte(data))
	if e != nil {
		t.Fatal(e)
	}
	for _, k := range keys {
		if !gameSettingsRecipeManaged(egg, "/server.properties", k) {
			t.Fatal(k)
		}
		if _, e := gameSettingsChanges(p.fields, M{k: "changed"}, egg, "/server.properties"); e == nil {
			t.Fatalf("managed key accepted: %s", k)
		}
	}
	changes, e := gameSettingsChanges(p.fields, M{"max-players": "8", "allow-list": false}, egg, "/server.properties")
	if e != nil {
		t.Fatal(e)
	}
	result, e := p.patch(changes)
	if e != nil || !bytes.Contains(result, []byte("allow-list=false")) {
		t.Fatal("ordinary settings lost")
	}
	for _, data := range []string{"Server_Name=x\nServer_Name=y\n", "server_name=x\n", "World_GameMode=invalid\n", "World_Name=../other\n"} {
		if _, e := parseRisingUnitySettings([]byte(data)); e == nil {
			t.Fatal("ambiguous/invalid Unity properties accepted")
		}
	}
}
