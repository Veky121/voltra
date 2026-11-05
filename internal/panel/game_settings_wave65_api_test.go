package panel

import (
	"bytes"
	"context"
	"encoding/json"
	"github.com/jackc/pgx/v5/pgxpool"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path"

	"strings"
	"testing"
	"time"
)

func TestWave65FinalFiveSettingsPublicationAPI(t *testing.T) {
	if os.Getenv("TEST_DATABASE_URL") == "" {
		t.Skip("TEST_DATABASE_URL is required for isolated PostgreSQL protocol tests")
	}
	cfg, err := pgxpool.ParseConfig(os.Getenv("TEST_DATABASE_URL"))
	if err != nil || cfg.ConnConfig.Host != "127.0.0.1" || cfg.ConnConfig.Port != 55439 {
		t.Fatal("expected private isolated local55439 test database")
	}

	for _, tc := range []struct {
		recipe, file, data, key string
		value                   any
	}{

		{"gta/openmp/egg-open-m-p.json", "/openmp/config.json", `{"name":"Original","password":"fixture-secret","max_players":20,"network":{"port":29371,"bind":"0.0.0.0"},"x":1.234567890123456789}`, "/name", "Changed"},
		{"gta/mtasa/egg-multi-theft-auto.json", "/mtasa/mods/deathmatch/mtaserver.conf", `<config><servername>Original</servername><password>fixture-secret</password><serverip>auto</serverip><serverport>29371</serverport><httpport>42154</httpport><ase>0</ase></config>`, "servername", "Changed"},
		{"rimworld/open_world/egg-rimworld-open-world.json", "/Data/Config.json", `{"LocalAddress":"0.0.0.0","ServerPort":29371,"MaxPlayers":20,"Password":"fixture-secret","x":1.234567890123456789}`, "/MaxPlayers", "24"},
		{"rimworld/together/egg-rimworld-together.json", "/Configs/ServerConfig.json", `{"IP":"0.0.0.0","Port":29371,"Name":"Original","Password":"fixture-secret","x":1.234567890123456789}`, "/Name", "Changed"},
		{kspLMPRecipe, "/LMPServer/Config/GeneralSettings.xml", `<GeneralSettingsDefinition><ServerName>Original</ServerName><Password>fixture-secret</Password></GeneralSettingsDefinition>`, "ServerName", "Changed"},
	} {
		t.Run(tc.recipe, func(t *testing.T) {
			var fixtureSchema string
			// Runs after the fixture's own cleanup because it is registered first.
			t.Cleanup(func() {
				if fixtureSchema == "" {
					return
				}
				control, e := pgxpool.NewWithConfig(context.Background(), cfg)
				if e != nil {
					t.Error("cannot verify current fixture cleanup")
					return
				}
				defer control.Close()
				var exists bool
				if e := control.QueryRow(context.Background(), "SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname=$1)", fixtureSchema).Scan(&exists); e != nil || exists {
					t.Error("current fixture schema cleanup not verified")
				}
			})
			a, mux, admin, server, f := quickSetupMinecraftFixture(t)
			ctx := context.Background()
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
			for _, port := range []int{29374, 29375} {
				if _, e := a.insert(ctx, "allocations", M{"node_id": server["node_id"], "server_id": server["id"], "ip": "127.0.0.1", "port": port}); e != nil {
					t.Fatal(e)
				}
			}

			if _, err := a.insert(ctx, "allocations", M{"node_id": server["node_id"], "server_id": server["id"], "ip": "127.0.0.1", "port": 29372}); err != nil {
				t.Fatal(err)
			}
			if _, err := a.insert(ctx, "allocations", M{"node_id": server["node_id"], "server_id": server["id"], "ip": "127.0.0.1", "port": 29373}); err != nil {
				t.Fatal(err)
			}
			if _, err := a.insert(ctx, "allocations", M{"node_id": server["node_id"], "server_id": server["id"], "ip": "127.0.0.1", "port": 42154}); err != nil {
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
			if tc.recipe == kspLMPRecipe {
				f.Files["/LMPServer/Config/ConnectionSettings.xml"] = []byte(`<ConnectionSettingsDefinition><ListenAddress>0.0.0.0</ListenAddress><Port>29371</Port><Upnp>false</Upnp></ConnectionSettingsDefinition>`)
				f.Files["/LMPServer/Config/WebsiteSettings.xml"] = []byte(`<WebsiteSettingsDefinition><ListenAddress>0.0.0.0</ListenAddress><Port>29371</Port></WebsiteSettingsDefinition>`)
			}

			f.Files[tc.file] = []byte(tc.data)
			if tc.recipe == clusterioSettingsRecipe {
				f.Files["/.voltra/clusterio-mode"] = []byte("controller\n")
			}
			if tc.recipe == kspDMPRecipe {
				f.Files["/.voltra/ksp/dmp-release.json"] = []byte(`{"game":"dmp","version":"0.3.8.5","source_commit":"8253dc8e4f40e4519c085c3ee223abecd1a52954","runtime":"Microsoft.NETCore.App10","dependency_commits":{"External/SettingsParser":"0a1c1e1666bf94a9069acf1967e64d2679dc27a2"}}`)
			}

			if tc.recipe == kf2SettingsRecipe {
				f.Files[kf2SettingsWebPath] = []byte("[IpDrv.WebServer]\nbEnabled=false\nListenPort=29373\n")
			}
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
				if str(v["env_variable"]) == "QUERY_PORT" {
					v["default_value"] = "29372"
				}
				if str(v["env_variable"]) == "NZP_ENGINE" {
					v["default_value"] = "vril"
					if strings.Contains(tc.file, "/fte_legacy/") {
						v["default_value"] = "fte_legacy"
					}
				}

				if _, err := a.insert(ctx, "egg_variables", M{"egg_id": server["egg_id"], "name": v["name"], "env_variable": v["env_variable"], "default_value": func() any {
					if str(v["env_variable"]) == "CLUSTER_ID" {
						return "wave59_cluster"
					}
					if str(v["env_variable"]) == "SERVER_NAME" {
						return "Pterodactyl"
					}
					if str(v["env_variable"]) == "STEAM_PORT" {
						return "29373"
					}
					if str(v["env_variable"]) == "BEACON_PORT" || str(v["env_variable"]) == "WEB_ADMIN_PORT" {
						return "29373"
					}
					if str(v["env_variable"]) == "HTTP_PORT" {
						return "42154"
					}
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

			endpoint := "/api/client/servers/" + str(server["uuid_short"]) + "/game-settings?file=" + url.QueryEscape(tc.file)

			missing := f.Files[tc.file]
			delete(f.Files, tc.file)
			infraExpect(t, mux, admin, "GET", endpoint, nil, 404)
			if f.Writes != 0 {
				t.Fatal("GET seeded a missing file")
			}
			f.Files[tc.file] = missing
			savedRoot, hadRoot := f.Folders["/"]
			f.Folders["/"] = []M{{"name": ".voltra", "directory": true, "symlink": true}}
			wParent := httptest.NewRecorder()
			mux.ServeHTTP(wParent, WithUser(httptest.NewRequest("GET", endpoint, nil), admin))
			if wParent.Code == 200 {
				t.Fatal("symlink helper parent accepted")
			}
			if hadRoot {
				f.Folders["/"] = savedRoot
			} else {
				delete(f.Folders, "/")
			}
			// Confined Wings metadata must refuse nonregular and symlink leaves.
			folder := path.Dir(tc.file)
			savedFolder, hadFolder := f.Folders[folder]
			for _, metadata := range []M{{"name": path.Base(tc.file), "file": true, "symlink": true}, {"name": path.Base(tc.file), "file": false, "directory": true}} {
				f.Folders[folder] = []M{metadata}
				w := httptest.NewRecorder()
				mux.ServeHTTP(w, WithUser(httptest.NewRequest("GET", endpoint, nil), admin))
				if w.Code == 200 {
					t.Fatal("unsafe leaf accepted")
				}
			}
			if hadFolder {
				f.Folders[folder] = savedFolder
			} else {
				delete(f.Folders, folder)
			}
			savedNative := bytes.Clone(f.Files[tc.file])
			writesMalformed := f.Writes
			if tc.recipe != nzPortableSettingsRecipe {
				f.Files[tc.file] = []byte("[broken")
				if tc.recipe == kspDMPRecipe {
					f.Files[tc.file] = []byte("maxPlayers=invalid\n")
				}
				infraExpect(t, mux, admin, "GET", endpoint, nil, func() int {
					if finalFiveRecipe(tc.recipe) {
						return 404
					}
					return 422
				}())
				if f.Writes != writesMalformed {
					t.Fatal("malformed GET wrote")
				}
			}
			f.Files[tc.file] = savedNative
			// Fresh effective environment and path identity must revoke access.
			driftVar, driftErr := a.insert(ctx, "egg_variables", M{"egg_id": server["egg_id"], "name": "Authority drift", "env_variable": "BASH_ENV", "default_value": "/tmp/untrusted", "user_viewable": false, "user_editable": false, "rules": "nullable|string"})
			if driftErr != nil {
				t.Fatal(driftErr)
			}
			driftWrites := f.Writes
			infraExpect(t, mux, admin, "GET", endpoint, nil, 404)
			if err := a.exec(ctx, "DELETE FROM egg_variables WHERE id=$1", driftVar["id"]); err != nil {
				t.Fatal(err)
			}
			infraExpect(t, mux, admin, "GET", "/api/client/servers/"+str(server["uuid_short"])+"/game-settings?file=/wrong.ini", nil, 404)
			if f.Writes != driftWrites {
				t.Fatal("authority drift wrote")
			}
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
			if tc.recipe == dstSettingsRecipe {
				for _, shard := range []string{"Master", "Caves"} {
					shardFile := "/DoNotStarveTogether/config/wave59_cluster/" + shard + "/server.ini"
					f.Files[shardFile] = []byte("[NETWORK]\nserver_port=29371\n[SHARD]\nis_master=true\n")
					ep := "/api/client/servers/" + str(server["uuid_short"]) + "/game-settings?file=" + shardFile
					shardView := asMap(infraExpect(t, mux, admin, "GET", ep, nil, 200)["attributes"])
					writes := f.Writes
					infraExpect(t, mux, admin, "PUT", ep, M{"file": shardFile, "revision": shardView["revision"], "settings": M{"NETWORK/server_port": 29372}}, 422)
					if f.Writes != writes {
						t.Fatal("managed shard write")
					}
				}
				infraExpect(t, mux, admin, "GET", "/api/client/servers/"+str(server["uuid_short"])+"/game-settings?file=/DoNotStarveTogether/config/server/cluster.ini", nil, 404)
			}

			if tc.recipe == nzPortableSettingsRecipe {
				writes := f.Writes
				infraExpect(t, mux, admin, "PUT", endpoint, M{"file": tc.file, "revision": view["revision"], "settings": M{tc.key: tc.value}}, 422)
				if f.Writes != writes {
					t.Fatal("readonly write")
				}
			}
			if tc.recipe != nzPortableSettingsRecipe {

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
				expected := strings.Replace(strings.Replace(tc.data, "Original", "Changed", 1), "bDefaultHardcoreMode=false", "bDefaultHardcoreMode=true", 1)
				if tc.recipe == "rimworld/open_world/egg-rimworld-open-world.json" {
					expected = strings.Replace(expected, `"MaxPlayers":20`, `"MaxPlayers":24`, 1)
				}
				expected = strings.Replace(expected, "bKillFeed=False", "bKillFeed=True", 1)
				// Zomboid PVP is unchanged by the identity edit.
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
				if tc.recipe == romesteadSettingsRecipe {
					expected = strings.Replace(tc.data, `"EnableCheats":false`, `"EnableCheats":true`, 1)
				}
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
				if tc.recipe == kf2SettingsRecipe {
					webEndpoint := "/api/client/servers/" + str(server["uuid_short"]) + "/game-settings?file=" + kf2SettingsWebPath
					webView := asMap(infraExpect(t, mux, admin, "GET", webEndpoint, nil, 200)["attributes"])
					infraExpect(t, mux, admin, "PUT", webEndpoint, M{"file": kf2SettingsWebPath, "revision": webView["revision"], "settings": M{"IpDrv.WebServer/bEnabled": true}}, 200)
					if string(f.Files[kf2SettingsWebPath]) != "[IpDrv.WebServer]\nbEnabled=true\nListenPort=29373\n" {
						t.Fatal("WebAdmin byte precision")
					}
					// Removing the password from an enabled tuple must refuse before publication.
					gameView := asMap(infraExpect(t, mux, admin, "GET", endpoint, nil, 200)["attributes"])
					writes := f.Writes
					infraExpect(t, mux, admin, "PUT", endpoint, M{"file": tc.file, "revision": gameView["revision"], "settings": M{"Engine.AccessControl/AdminPassword": ""}}, 422)
					if f.Writes != writes {
						t.Fatal("unsafe coupled edit wrote")
					}
					// Companion bytes participate in the game document's revision.
					savedWeb := bytes.Clone(f.Files[kf2SettingsWebPath])
					f.Files[kf2SettingsWebPath] = append(bytes.Clone(savedWeb), []byte("; companion changed\n")...)
					infraExpect(t, mux, admin, "PUT", endpoint, M{"file": tc.file, "revision": gameView["revision"], "settings": M{tc.key: tc.value}}, 409)
					f.Files[kf2SettingsWebPath] = savedWeb
					savedGame := bytes.Clone(f.Files[tc.file])
					f.Files[tc.file] = append(bytes.Clone(savedGame), []byte("+AdminPassword=unsafe-array\n")...)
					infraExpect(t, mux, admin, "GET", endpoint, nil, 422)
					f.Files[tc.file] = savedGame
					if f.Writes != writes {
						t.Fatal("tuple revision/array refusal wrote")
					}
					view = gameView
				}
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
			if tc.recipe != nzPortableSettingsRecipe {

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
			}

			var current M
			for _, mutation := range []string{"startup", "helper", "allocation", "permission"} {
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
				if mutation == "permission" {
					if _, e = a.update(ctx, "servers", num(server["id"]), M{"owner_id": reader["id"]}); e != nil {
						t.Fatal(e)
					}
					if _, e = a.update(ctx, "users", admin, M{"root_admin": false}); e != nil {
						t.Fatal(e)
					}
				} else if mutation == "allocation" {
					if e = a.exec(ctx, "UPDATE allocations SET server_id=NULL WHERE id=$1", allocation["id"]); e != nil {
						t.Fatal(e)
					}
				} else if mutation == "helper" {
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
				wantStatus := 404
				if mutation == "allocation" {
					wantStatus = 422
				}
				if mutation == "permission" {
					wantStatus = 404
				}
				if rec.Code != wantStatus || f.Writes != writes {
					t.Fatalf("contended startup revocation status=%d writes=%d", rec.Code, f.Writes-writes)
				}
				if mutation == "permission" {
					if _, e = a.update(ctx, "users", admin, M{"root_admin": true}); e != nil {
						t.Fatal(e)
					}
					if _, e = a.update(ctx, "servers", num(server["id"]), M{"owner_id": admin}); e != nil {
						t.Fatal(e)
					}
				}
				if mutation == "allocation" {
					if e = a.exec(ctx, "UPDATE allocations SET server_id=$1 WHERE id=$2", server["id"], allocation["id"]); e != nil {
						t.Fatal(e)
					}
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
			if tc.recipe == kf2SettingsRecipe {
				f.Files[kf2SettingsWebPath] = []byte("[IpDrv.WebServer]\nbEnabled=false\nListenPort=29373\n")
			}
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
			if tc.recipe == nzPortableSettingsRecipe {
				if c1 != 422 || c2 != 422 || f.Writes != writes {
					t.Fatal("concurrent readonly writes")
				}
			} else if !((c1 == 200 && c2 == 409) || (c1 == 409 && c2 == 200)) || f.Writes != writes+1 {
				t.Fatalf("concurrent saves %d/%d writes %d", c1, c2, f.Writes-writes)
			}
			if _, err := a.update(ctx, "servers", num(server["id"]), M{"startup": "custom startup"}); err != nil {
				t.Fatal(err)
			}
			infraExpect(t, mux, admin, "GET", endpoint, nil, 404)
		})
	}
}
