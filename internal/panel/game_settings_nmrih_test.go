package panel

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

var testing421Baseline = os.Getenv("WAVE421_BASELINE") == "1"

func TestWave421NMRiHAPI(t *testing.T) {
	for _, tc := range []struct{ recipe, file, data, key string }{
		{nmrihSettingsRecipe, nmrihSettingsPath, "// operator\r\nmp_timelimit \"73\" // retain\r\nrcon_password private-fixture-secret\r\nhostname stock\r\n", "mp_timelimit"},
	} {
		t.Run(tc.recipe, func(t *testing.T) {
			a, mux, admin, server, f := quickSetupMinecraftFixture(t)
			ctx := context.Background()
			var ownedSchema string
			if e := a.DB.QueryRow(ctx, "SELECT current_schema()").Scan(&ownedSchema); e != nil {
				t.Fatal(e)
			}
			t.Log("wave421_owned_schema=" + ownedSchema)
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
			for _, port := range []int{29372, 29373} {
				if _, e := a.insert(ctx, "allocations", M{"node_id": server["node_id"], "server_id": server["id"], "ip": "127.0.0.1", "port": port}); e != nil {
					t.Fatal(e)
				}
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
			wrapper := "/nmrih/cfg/voltra-server.cfg"
			if tc.recipe == gmodSettingsRecipe {
				wrapper = "/garrysmod/cfg/voltra-server.cfg"
			}
			f.Files[wrapper] = []byte("exec server.cfg\nexec voltra-managed.cfg\n")
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

			endpoint := "/api/client/servers/" + str(server["uuid_short"]) + "/game-settings?file=" + tc.file

			if testing421Baseline {
				infraExpect(t, mux, admin, "GET", endpoint, nil, 404)
				return
			}
			view := asMap(infraExpect(t, mux, admin, "GET", endpoint, nil, 200)["attributes"])
			if str(view["file"]) != tc.file {
				t.Fatalf("wrong document %v", view)
			}
			raw, _ := json.Marshal(view)
			if strings.Contains(string(raw), "private-fixture-secret") {
				t.Fatal("secret leak")
			}
			if len(asSlice(view["fields"])) < 1 {
				t.Fatalf("existing-only fields: %v", view)
			}
			if testing421Baseline {
				return
			}
			noWrites := f.Writes
			infraExpect(t, mux, admin, "GET", strings.Replace(endpoint, tc.file, "/other/server.cfg", 1), nil, 404)
			for _, key := range []string{"rcon_password", "hostname", "tv_port"} {
				infraExpect(t, mux, admin, "PUT", endpoint, M{"revision": view["revision"], "settings": M{key: "1"}}, 422)
			}
			helper := "/.voltra/source_variants_wave58.py"
			original := bytes.Clone(f.Files[helper])
			f.Files[helper] = append(original, []byte("# drift\n")...)
			infraExpect(t, mux, admin, "PUT", endpoint, M{"revision": view["revision"], "settings": M{tc.key: "200"}}, 404)
			f.Files[helper] = original
			if f.Writes != noWrites {
				t.Fatal("refusal wrote")
			}
			before := f.Writes
			infraExpect(t, mux, admin, "PUT", endpoint, M{"revision": view["revision"], "settings": M{tc.key: "200"}}, 200)
			if f.Writes != before+1 {
				t.Fatal("safe stock document did not write")
			}
			if string(f.Files[tc.file]) != strings.Replace(tc.data, "mp_timelimit \"73\"", "mp_timelimit \"200\"", 1) {
				t.Fatal("reread did not contain changed native value")
			}
			view = asMap(infraExpect(t, mux, admin, "GET", endpoint, nil, 200)["attributes"])
			change := M{tc.key: "200"}
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
			f.Files[wrapper] = []byte("exec voltra-managed.cfg\nexec server.cfg\n")
			infraExpect(t, mux, admin, "GET", endpoint, nil, 404)
			f.Files[wrapper] = []byte("exec server.cfg\nexec voltra-managed.cfg\n")
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

func TestWave421NMRiHRefusal(t *testing.T) {
	for _, tail := range []string{"exec other.cfg", "mp_timelimit 9", "alias mp_timelimit quit", "unknown 1", "mp_timelimit 1;quit"} {
		input := []byte("mp_timelimit 73\n" + tail + "\n")
		p, e := parseNMRiHSettings(input)
		if e != nil {
			continue
		}
		if _, e = p.patch(map[string]string{"mp_timelimit": "200"}); e == nil {
			t.Fatal("executable CFG accepted")
		}
		got, e := p.patch(nil)
		if e != nil || !bytes.Equal(got, input) {
			t.Fatal("refusal altered bytes")
		}
	}
}
