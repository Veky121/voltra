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
)

func TestWave105ConanAPI(t *testing.T) {
	for _, tc := range []struct{ recipe, file, data, key string }{
		{conanAuthorityRecipe, conanAuthorityDirectory + "ServerSettings.ini", "; retain\r\n[ServerSettings]\r\nPVPEnabled=True\r\nServerPassword=private-fixture-secret\r\n; unknown retained\r\n", "ServerSettings/PVPEnabled"},
	} {
		t.Run(tc.recipe, func(t *testing.T) {
			a, mux, admin, server, f := quickSetupMinecraftFixture(t)
			ctx := context.Background()
			var entry gameTemplate
			for _, e := range gameTemplates().Entries {
				if e.Path == tc.recipe {
					entry = e
				}
			}
			startup := str(entry.Egg["startup"])
			allocation, err := a.insert(ctx, "allocations", M{"node_id": server["node_id"], "server_id": server["id"], "ip": "127.0.0.1", "port": func() int {
				if tc.recipe == starboundAuthorityRecipe {
					return 21025
				}
				return 29371
			}()})
			if err != nil {
				t.Fatal(err)
			}
			if _, err = a.update(ctx, "servers", num(server["id"]), M{"allocation_id": allocation["id"]}); err != nil {
				t.Fatal(err)
			}
			if _, err := a.update(ctx, "eggs", num(server["egg_id"]), M{"name": entry.Egg["name"], "uuid": gameTemplateEggUUID(entry), "startup": startup, "config_files": M{}, "java_config": M{}}); err != nil {
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
			delete(f.Files, "/server.properties")
			f.Files[tc.file] = []byte(tc.data)
			wrapper := "/game/csgo/cfg/voltra-server.cfg"
			if tc.recipe == gmodSettingsRecipe {
				wrapper = "/garrysmod/cfg/voltra-server.cfg"
			}
			f.Files[wrapper] = []byte("exec server.cfg\nexec voltra-managed.cfg\nexec voltra-native.cfg\n")
			f.Files[strings.Replace(wrapper, "voltra-server.cfg", "voltra-managed.cfg", 1)] = []byte("hostname stock\n")
			f.Files["/sbinit.config"] = []byte(`{"storageDirectory":"storage"}`)
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
			if strings.Contains(string(raw), "private-fixture-secret") {
				t.Fatal("secret leak")
			}
			if len(asSlice(view["fields"])) != 2 {
				t.Fatalf("existing-only fields: %v", view)
			}
			for _, leaf := range []string{"Engine.ini", "Game.ini"} {
				p := conanAuthorityDirectory + leaf
				original := "; keep\r\n[Custom]\r\nEnabled=True\r\n"
				f.Files[p] = []byte(original)
				v := asMap(infraExpect(t, mux, admin, "GET", endpoint+"?file="+p, nil, 200)["attributes"])
				infraExpect(t, mux, admin, "PUT", endpoint+"?file="+p, M{"revision": v["revision"], "settings": M{"Custom/Enabled": false}}, 200)
				if string(f.Files[p]) != strings.Replace(original, "Enabled=True", "Enabled=False", 1) {
					t.Fatal("secondary INI bytes changed")
				}
			}
			infraExpect(t, mux, admin, "PUT", endpoint, M{"revision": view["revision"], "settings": M{"ServerSettings/ServerPassword": "overwrite"}}, 422)
			before := f.Writes
			infraExpect(t, mux, admin, "PUT", endpoint, M{"revision": view["revision"], "settings": M{tc.key: false}}, 200)
			if string(f.Files[tc.file]) != strings.Replace(tc.data, "PVPEnabled=True", "PVPEnabled=False", 1) {
				t.Fatal("unrelated bytes changed")
			}
			if f.Writes != before+1 {
				t.Fatal("safe stock document did not write")
			}
			if !strings.Contains(string(f.Files[tc.file]), "PVPEnabled=False") {
				t.Fatal("reread did not contain changed native value")
			}
			view = asMap(infraExpect(t, mux, admin, "GET", endpoint, nil, 200)["attributes"])
			change := M{tc.key: false}
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
			for _, table := range []string{"servers", "eggs"} {
				row := server["id"]
				if table == "eggs" {
					row = server["egg_id"]
				}
				if _, e := a.update(ctx, table, num(row), M{"startup": "custom-launcher"}); e != nil {
					t.Fatal(e)
				}
				infraExpect(t, mux, admin, "GET", endpoint, nil, 404)
				if _, e := a.update(ctx, table, num(row), M{"startup": startup}); e != nil {
					t.Fatal(e)
				}
			}
			helper := "/.voltra/conan_legacy.py"
			saved := f.Files[helper]
			delete(f.Files, helper)
			infraExpect(t, mux, admin, "GET", endpoint, nil, 404)
			f.Files[helper] = append(append([]byte{}, saved...), 'x')
			infraExpect(t, mux, admin, "GET", endpoint, nil, 404)
			f.Files[helper] = saved
			for _, mutation := range []string{"startup", "helper", "native", "permission"} {
				currentView := asMap(infraExpect(t, mux, admin, "GET", endpoint, nil, 200)["attributes"])
				baseClient := a.HTTP
				baseTransport := baseClient.Transport
				if baseTransport == nil {
					baseTransport = http.DefaultTransport
				}
				states := 0
				native := append([]byte{}, f.Files[tc.file]...)
				a.HTTP = &http.Client{Transport: gameLibraryTransport(func(req *http.Request) (*http.Response, error) {
					res, e := baseTransport.RoundTrip(req)
					if e == nil && req.Method == "GET" && req.URL.Path == "/api/servers/"+str(server["uuid"]) {
						states++
						if states == 2 {
							switch mutation {
							case "startup":
								if _, e := a.update(ctx, "servers", num(server["id"]), M{"startup": "late-custom"}); e != nil {
									t.Error(e)
								}
							case "helper":
								f.mu.Lock()
								f.Files[helper] = append(append([]byte{}, saved...), 'x')
								f.mu.Unlock()
							case "native":
								f.mu.Lock()
								f.Files[tc.file] = append(append([]byte{}, native...), []byte("// external change\n")...)
								f.mu.Unlock()
							case "permission":
								if e := a.exec(ctx, "UPDATE users SET disabled=true WHERE id=$1", admin); e != nil {
									t.Error(e)
								}
							}
						}
					}
					return res, e
				}), Timeout: baseClient.Timeout}
				before := f.Writes
				want := 404
				if mutation == "native" {
					want = 409
				}
				if mutation == "permission" {
					want = 403
				}
				infraExpect(t, mux, admin, "PUT", endpoint, M{"revision": currentView["revision"], "settings": change}, want)
				a.HTTP = baseClient
				if states != 2 || f.Writes != before {
					t.Fatal("late revocation wrote or hook missed", mutation)
				}
				f.Files[helper] = saved
				f.Files[tc.file] = native
				if _, e := a.update(ctx, "servers", num(server["id"]), M{"startup": startup}); e != nil {
					t.Fatal(e)
				}
				if e := a.exec(ctx, "UPDATE users SET disabled=false WHERE id=$1", admin); e != nil {
					t.Fatal(e)
				}
			}
			// Inactive document must not become selectable by query.
			f.Files["/ConanSandbox/Saved/Config/LinuxServer/ServerSettings.ini"] = []byte("mp_limitteams 20\n")
			infraExpect(t, mux, admin, "PUT", endpoint+"?file=/game/csgo/cfg/inactive.cfg", input, 404)
			// Deterministic DB lock contention: observe the actual waiter before
			// revoking its startup authority. No delay stands in for admission.
			current := asMap(infraExpect(t, mux, admin, "GET", endpoint, nil, 200)["attributes"])
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
			if _, e = a.update(ctx, "servers", num(server["id"]), M{"startup": "custom-launcher"}); e != nil {
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
			if _, e = a.update(ctx, "servers", num(server["id"]), M{"startup": startup}); e != nil {
				t.Fatal(e)
			}
			// Competing saves share the same revision: exactly one may publish.
			delete(f.Files, "/server.properties")
			f.Files[tc.file] = []byte(tc.data)
			current = asMap(infraExpect(t, mux, admin, "GET", endpoint, nil, 200)["attributes"])
			payload, _ := json.Marshal(M{"revision": current["revision"], "settings": change})
			results := make(chan int, 2)
			writes = f.Writes
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
