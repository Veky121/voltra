package panel

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestUrbanTerrorSettingsAPI(t *testing.T) {
	control, err := pgxpool.New(context.Background(), isolatedTestDatabaseURL(t))
	if err != nil {
		t.Fatal("isolated database unavailable")
	}
	defer control.Close()
	schemas := func() string {
		var names string
		if e := control.QueryRow(context.Background(), "SELECT coalesce(string_agg(nspname, ',' ORDER BY nspname),'') FROM pg_namespace").Scan(&names); e != nil {
			t.Fatal("schema inventory failed")
		}
		return names
	}
	baseline := schemas()
	var fixturePools []*pgxpool.Pool
	defer func() {
		for _, pool := range fixturePools {
			if pool.Stat().TotalConns() != 0 {
				t.Error("fixture connection cleanup mismatch")
			}
		}
		t.Log("fixture connection cleanup verified")
	}()
	defer func() {
		if schemas() != baseline {
			t.Error("fixture schema cleanup mismatch")
		} else {
			t.Log("fixture schema cleanup verified")
		}
	}()

	stock, err := os.ReadFile("testdata/game-settings/game-parity-20261029/wave340-urbanterror-typed-settings/stock-server.cfg")
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct{ recipe, file, data, key string }{
		{urbanTerrorSettingsRecipe, urbanTerrorSettingsPath, "\ufeff" + string(stock), "fraglimit"},
	} {
		t.Run(tc.recipe, func(t *testing.T) {
			a, mux, admin, server, f := quickSetupMinecraftFixture(t)
			fixturePools = append(fixturePools, a.DB)
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
			wrapper := "/tf/cfg/voltra-server.cfg"
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

			endpoint := "/api/client/servers/" + str(server["uuid_short"]) + "/game-settings"

			view := asMap(infraExpect(t, mux, admin, "GET", endpoint, nil, 200)["attributes"])
			if str(view["file"]) != tc.file {
				t.Fatalf("wrong document %v", view)
			}
			raw, _ := json.Marshal(view)
			if strings.Contains(string(raw), "private-fixture-secret") {
				t.Fatal("secret leak")
			}
			if laneGameSettingsField(view, "fraglimit")["type"] == "readonly" || len(asSlice(view["fields"])) < 4 {
				t.Fatalf("existing-only fields: %v", view)
			}
			infraExpect(t, mux, admin, "GET", endpoint+"?file=/urbanterror/userdata/q3ut4/server.cfg", nil, 404)
			f.Files["/urbanterror/userdata/q3ut4/server.cfg"] = []byte("set fraglimit 5\n")
			infraExpect(t, mux, admin, "GET", endpoint, nil, 404)
			delete(f.Files, "/urbanterror/userdata/q3ut4/server.cfg")
			before := f.Writes
			infraExpect(t, mux, admin, "PUT", endpoint, M{"revision": view["revision"], "settings": M{"sv_maxclients": "8"}}, 422)
			if f.Writes != before {
				t.Fatal("managed write")
			}

			infraExpect(t, mux, admin, "PUT", endpoint, M{"revision": view["revision"], "settings": M{tc.key: "7"}}, 200)
			if f.Writes != before+1 {
				t.Fatal("safe stock document did not write")
			}
			expected := strings.Replace(tc.data, `set  fraglimit                                          "0"`, `set  fraglimit                                          "7"`, 1)
			if expected == tc.data || string(f.Files[tc.file]) != expected {
				t.Fatal("stock bytes changed outside value span")
			}
			view = asMap(infraExpect(t, mux, admin, "GET", endpoint, nil, 200)["attributes"])
			change := M{tc.key: "7"}
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
			// Measure PUT reads, then revoke authority after its last prepublication file read.
			base := a.HTTP.Transport
			if base == nil {
				base = http.DefaultTransport
			}
			reads := 0
			a.HTTP.Transport = wave161Transport{base, func(r *http.Request) {
				if strings.HasSuffix(r.URL.Path, "/files/contents") && r.URL.Query().Get("file") == tc.file {
					reads++
				}
			}}
			probe := asMap(infraExpect(t, mux, admin, "GET", endpoint, nil, 200)["attributes"])
			reads = 0
			infraExpect(t, mux, admin, "PUT", endpoint, M{"revision": probe["revision"], "settings": M{tc.key: "8"}}, 200)
			finalRead := reads - 1
			a.HTTP.Transport = base
			if finalRead < 2 {
				t.Fatal("missing final reads")
			}
			for _, kind := range []string{"startup", "helper"} {
				view := asMap(infraExpect(t, mux, admin, "GET", endpoint, nil, 200)["attributes"])
				reads = 0
				fired := false
				writes := f.Writes
				originalHelper := append([]byte(nil), f.Files["/.voltra/quake_family_runtime.py"]...)
				a.HTTP.Transport = wave161Transport{base, func(r *http.Request) {
					if strings.HasSuffix(r.URL.Path, "/files/contents") && r.URL.Query().Get("file") == tc.file {
						reads++
						if reads == finalRead {
							fired = true
							if kind == "startup" {
								if _, e := a.update(ctx, "servers", num(server["id"]), M{"startup": "revoked"}); e != nil {
									t.Error(e)
								}
							} else {
								f.mu.Lock()
								f.Files["/.voltra/quake_family_runtime.py"] = []byte("revoked")
								f.mu.Unlock()
							}
						}
					}
				}}
				infraExpect(t, mux, admin, "PUT", endpoint, M{"revision": view["revision"], "settings": M{tc.key: "9"}}, 404)
				a.HTTP.Transport = base
				if !fired || f.Writes != writes {
					t.Fatal("late authority revocation wrote or did not fire")
				}
				if _, e := a.update(ctx, "servers", num(server["id"]), M{"startup": startup}); e != nil {
					t.Fatal(e)
				}
				f.Files["/.voltra/quake_family_runtime.py"] = originalHelper
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
			helper := "/.voltra/quake_family_runtime.py"
			original := f.Files[helper]
			f.Files[helper] = append(append([]byte{}, original...), '\n')
			infraExpect(t, mux, admin, "GET", endpoint, nil, 404)
			f.Files[helper] = original
			// Competing saves share the same revision: exactly one may publish.
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

func TestUrbanTerrorSettingsGrammar(t *testing.T) {
	raw := "\ufeff// operator\r\n\tSeTa\tfraglimit \"0\" // retained\r\nsets \" Admin\" \"owner\"\r\nset unknown \"opaque\"\r\nset rconpassword \"private-fixture-secret\"\r\nmap ut4_casa\r\n"
	p, e := parseUrbanTerrorSettings([]byte(raw))
	if e != nil {
		t.Fatal(e)
	}
	updated, e := p.patch(map[string]string{"fraglimit": "7"})
	if e != nil {
		t.Fatal(e)
	}
	if string(updated) != strings.Replace(raw, `fraglimit "0"`, `fraglimit "7"`, 1) {
		t.Fatal("opaque bytes changed")
	}
	for _, f := range p.fields {
		if f.key == "rconpassword" && (!f.secret || f.kind != "readonly") {
			t.Fatal("secret writable or unmasked")
		}
	}
	for _, tail := range []string{`set fraglimit 4`, `set "fraglimit" 4`, `exec other.cfg`, `vstr cycle`, `set fraglimit 0;quit`, `set fraglimit`, `/* block */`} {
		p, e := parseUrbanTerrorSettings([]byte(raw + tail + "\r\n"))
		if e != nil {
			continue
		}
		if _, e = p.patch(map[string]string{"fraglimit": "8"}); e == nil {
			t.Fatalf("unsafe grammar admitted %q", tail)
		}
	}
	for _, value := range []string{"-1", "1.5", "2147483648", "1;quit", ""} {
		if _, e = p.patch(map[string]string{"fraglimit": value}); e == nil {
			t.Fatal("invalid scalar accepted")
		}
	}
}
