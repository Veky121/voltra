package panel

import (
	"bytes"
	"context"
	"github.com/jackc/pgx/v5/pgxpool"
	"net/http"
	"strings"
	"testing"
)

func TestWave95RedMHostnameNoWrite(t *testing.T) {
	a, mux, admin, server, fixture := wave95Fixture(t)
	egg := batchSettingsRecipeFixture(t, redMSettingsRecipe)
	if _, e := a.update(context.Background(), "eggs", num(server["egg_id"]), egg); e != nil {
		t.Fatal(e)
	}
	if _, e := a.update(context.Background(), "servers", num(server["id"]), M{"startup": egg["startup"]}); e != nil {
		t.Fatal(e)
	}
	raw := []byte("sv_hostname old\r\nset sv_lan true\r\nsv_maxclients 32\r\n")
	fixture.mu.Lock()
	delete(fixture.Files, "/server.properties")
	fixture.Files[redMSettingsPath] = raw
	fixture.State = "offline"
	fixture.mu.Unlock()
	route := "/api/client/servers/" + str(server["uuid_short"]) + "/game-settings?file=/server.cfg"
	view := asMap(infraExpect(t, mux, admin, "GET", route, nil, 200)["attributes"])
	infraExpect(t, mux, admin, "PUT", route, M{"revision": view["revision"], "settings": M{"sv_hostname": strings.Repeat("\u00e9", 65)}}, 422)
	fixture.mu.Lock()
	same := bytes.Equal(raw, fixture.Files[redMSettingsPath])
	fixture.mu.Unlock()
	if !same {
		t.Fatal("invalid PUT wrote cfg")
	}
	next := asMap(infraExpect(t, mux, admin, "GET", route, nil, 200)["attributes"])
	if next["revision"] != view["revision"] {
		t.Fatal("invalid PUT changed revision")
	}
	infraExpect(t, mux, admin, "PUT", route, M{"revision": view["revision"], "settings": M{"sv_hostname": strings.Repeat("\u00e9", 64)}}, 200)
}

func TestWave95AuthorityAPI(t *testing.T) {
	for _, tc := range []struct{ recipe, file, data, key, value string }{
		{"arma/arma3/egg-arma3.json", "/server.cfg", "hostname = \"old\";\npassword = \"private\";\n// retained\n", "hostname", "changed"},
		{"arma/arma3/egg-arma3.json", "/basic.cfg", "MaxMsgSend = 128;\n// retained\n", "MaxMsgSend", "256"},
		{reforgerSettingsRecipe, "/config.json", `{"a2s":{"port":0},"bindPort":28000,"game":{"maxPlayers":32,"passwordAdmin":"private"},"unknown":{"keep":true}}`, "/game/maxPlayers", "256"},
		{fiveMRecipe, "/server.cfg", "sv_hostname old\r\nset sv_lan true\r\nsv_maxclients 48\r\n# retained\r\n", "sv_hostname", "changed"},
	} {
		t.Run(tc.recipe+tc.file, func(t *testing.T) {
			a, mux, admin, server, f := wave95Fixture(t)
			ctx := context.Background()
			egg := batchSettingsRecipeFixture(t, tc.recipe)
			egg["java_config"] = M{}
			if _, e := a.update(ctx, "eggs", num(server["egg_id"]), egg); e != nil {
				t.Fatal(e)
			}
			if _, e := a.update(ctx, "servers", num(server["id"]), M{"startup": egg["startup"]}); e != nil {
				t.Fatal(e)
			}
			entry, _ := gameSettingsProfile(egg)
			for _, v := range asSlice(entry.Egg["variables"]) {
				row := asMap(v)
				_, e := a.insert(ctx, "egg_variables", M{"egg_id": server["egg_id"], "name": row["name"], "env_variable": row["env_variable"], "default_value": row["default_value"], "rules": row["rules"], "user_viewable": true, "user_editable": true})
				if e != nil {
					t.Fatal(e)
				}
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
			allocation, e := a.insert(ctx, "allocations", M{"node_id": server["node_id"], "server_id": server["id"], "ip": "127.0.0.1", "port": 28000})
			if e != nil {
				t.Fatal(e)
			}
			if _, e = a.update(ctx, "servers", num(server["id"]), M{"allocation_id": allocation["id"]}); e != nil {
				t.Fatal(e)
			}
			f.Files[tc.file] = []byte(tc.data)
			f.State = "offline"
			route := "/api/client/servers/" + str(server["uuid_short"]) + "/game-settings?file=" + tc.file
			view := asMap(infraExpect(t, mux, admin, "GET", route, nil, 200)["attributes"])
			if tc.recipe == reforgerSettingsRecipe {
				for k, v := range map[string]string{"/game/maxPlayers": "0", "/game/passwordAdmin": "has space", "/a2s/port": "29000", "/bindPort": "123"} {
					w := f.Writes
					infraExpect(t, mux, admin, "PUT", route, M{"revision": view["revision"], "settings": M{k: v}}, 422)
					if f.Writes != w || string(f.Files[tc.file]) != tc.data {
						t.Fatal("invalid PUT wrote")
					}
				}
			}
			infraExpect(t, mux, admin, "PUT", route, M{"revision": "stale", "settings": M{tc.key: tc.value}}, 409)
			f.State = "running"
			infraExpect(t, mux, admin, "PUT", route, M{"revision": view["revision"], "settings": M{tc.key: tc.value}}, 409)
			f.State = "offline"
			infraExpect(t, mux, admin, "PUT", route, M{"revision": view["revision"], "settings": M{tc.key: tc.value}}, 200)
			if tc.recipe == reforgerSettingsRecipe && !strings.Contains(string(f.Files[tc.file]), `"keep": true`) {
				t.Fatal("unknown data lost")
			}

			// Helper bytes are exact installed LF bodies, never sibling source files.
			if tc.recipe != "" {
				for name, body := range f.Files {
					if strings.HasPrefix(name, "/.voltra/") {
						w := f.Writes
						f.Files[name] = append(append([]byte{}, body...), byte('\n'))
						infraExpect(t, mux, admin, "PUT", route, M{"revision": view["revision"], "settings": M{tc.key: tc.value}}, 404)
						if f.Writes != w {
							t.Fatal("changed helper wrote")
						}
						f.Files[name] = body
						delete(f.Files, name)
						infraExpect(t, mux, admin, "PUT", route, M{"revision": view["revision"], "settings": M{tc.key: tc.value}}, 404)
						if f.Writes != w {
							t.Fatal("missing helper wrote")
						}
						f.Files[name] = body
						break
					}
				}
			}

			if tc.recipe == fiveMRecipe {
				w := f.Writes
				if e := a.exec(ctx, "UPDATE egg_variables SET default_value='1' WHERE egg_id=$1 AND env_variable='TXADMIN_ENABLE'", server["egg_id"]); e != nil {
					t.Fatal(e)
				}
				infraExpect(t, mux, admin, "PUT", route, M{"revision": view["revision"], "settings": M{tc.key: tc.value}}, 404)
				if f.Writes != w {
					t.Fatal("txAdmin wrote")
				}
				if e := a.exec(ctx, "UPDATE egg_variables SET default_value='0' WHERE egg_id=$1 AND env_variable='TXADMIN_ENABLE'", server["egg_id"]); e != nil {
					t.Fatal(e)
				}
				f.Files["/server-data/server.cfg"] = []byte("sv_hostname inactive\n")
				infraExpect(t, mux, admin, "GET", "/api/client/servers/"+str(server["uuid_short"])+"/game-settings?file=/server-data/server.cfg", nil, 404)
			}
			reader, e := a.insert(ctx, "users", M{"uuid": newUUID(), "username": "settings-reader", "email": "reader@example.invalid"})
			if e != nil {
				t.Fatal(e)
			}
			if _, e = a.insert(ctx, "subusers", M{"user_id": reader["id"], "server_id": server["id"], "permissions": []string{"file.read-content"}}); e != nil {
				t.Fatal(e)
			}
			infraExpect(t, mux, num(reader["id"]), "PUT", route, M{"revision": view["revision"], "settings": M{tc.key: tc.value}}, 403)
			for _, mutation := range []string{"startup", "helper", "allocation"} {
				if mutation == "allocation" && tc.recipe != reforgerSettingsRecipe {
					continue
				}
				currentView := asMap(infraExpect(t, mux, admin, "GET", route, nil, 200)["attributes"])
				baseClient := a.HTTP
				baseTransport := baseClient.Transport
				if baseTransport == nil {
					baseTransport = http.DefaultTransport
				}
				stateReads := 0
				helper := ""
				var saved []byte
				for name, body := range f.Files {
					if strings.HasPrefix(name, "/.voltra/") {
						helper = name
						saved = append([]byte{}, body...)
						break
					}
				}
				a.HTTP = &http.Client{Transport: gameLibraryTransport(func(req *http.Request) (*http.Response, error) {
					res, err := baseTransport.RoundTrip(req)
					if err == nil && req.Method == "GET" && req.URL.Path == "/api/servers/"+str(server["uuid"]) {
						stateReads++
						if stateReads == 2 {
							switch mutation {
							case "startup":
								if err := a.exec(ctx, "UPDATE servers SET startup='custom-launcher' WHERE id=$1", server["id"]); err != nil {
									t.Error(err)
								}
							case "helper":
								f.mu.Lock()
								f.Files[helper] = append(append([]byte{}, saved...), byte('x'))
								f.mu.Unlock()
							case "allocation":
								if _, err := a.insert(ctx, "allocations", M{"node_id": server["node_id"], "server_id": server["id"], "ip": "127.0.0.1", "port": 28001}); err != nil {
									t.Error(err)
								}
							}
						}
					}
					return res, err
				}), Timeout: baseClient.Timeout}
				writesBefore := f.Writes
				want := 404
				if mutation == "allocation" {
					want = 409
				}
				infraExpect(t, mux, admin, "PUT", route, M{"revision": currentView["revision"], "settings": M{tc.key: tc.value}}, want)
				a.HTTP = baseClient
				if stateReads != 2 || f.Writes != writesBefore {
					t.Fatal("late revocation wrote or hook missed", mutation)
				}
				f.Files[helper] = saved
				if _, e = a.update(ctx, "servers", num(server["id"]), M{"startup": egg["startup"]}); e != nil {
					t.Fatal(e)
				}
			}

			w := f.Writes
			if _, e = a.update(ctx, "servers", num(server["id"]), M{"startup": str(egg["startup"]) + " extra"}); e != nil {
				t.Fatal(e)
			}
			// Actual startup authority must revoke a document before any write.
			infraExpect(t, mux, admin, "PUT", route, M{"revision": view["revision"], "settings": M{tc.key: tc.value}}, 404)
			if f.Writes != w {
				t.Fatal("startup refusal wrote")
			}
		})
	}
}

func wave95InstallReviewed(t *testing.T, a *App, server M, f *steamGamesWings, egg M) {
	t.Helper()
	ctx := context.Background()
	if _, e := a.update(ctx, "eggs", num(server["egg_id"]), M{"java_config": M{}}); e != nil {
		t.Fatal(e)
	}
	allocation, e := a.insert(ctx, "allocations", M{"node_id": server["node_id"], "server_id": server["id"], "ip": "127.0.0.1", "port": 28000})
	if e != nil {
		t.Fatal(e)
	}
	if _, e = a.update(ctx, "servers", num(server["id"]), M{"allocation_id": allocation["id"]}); e != nil {
		t.Fatal(e)
	}

	entry, _ := gameSettingsProfile(egg)
	for _, v := range asSlice(entry.Egg["variables"]) {
		row := asMap(v)
		if _, e := a.insert(ctx, "egg_variables", M{"egg_id": server["egg_id"], "name": row["name"], "env_variable": row["env_variable"], "default_value": row["default_value"], "rules": row["rules"], "user_viewable": true, "user_editable": true}); e != nil {
			t.Fatal(e)
		}
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
}

func wave95Fixture(t *testing.T) (*App, *http.ServeMux, int64, M, *steamGamesWings) {
	var cfg *pgxpool.Config
	var name string
	t.Cleanup(func() {
		if cfg == nil {
			return
		}
		db, e := pgxpool.NewWithConfig(context.Background(), cfg)
		if e != nil {
			t.Error("cleanup connection failed")
			return
		}
		defer db.Close()
		var exists bool
		if e = db.QueryRow(context.Background(), "SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname=$1)", name).Scan(&exists); e != nil || exists {
			t.Error("fixture cleanup not verified")
		} else {
			t.Log("fixture schema removal verified")
		}
	})
	a, m, u, s, f := quickSetupMinecraftFixture(t)
	cfg = a.DB.Config().Copy()
	if e := a.DB.QueryRow(context.Background(), "SELECT current_schema()").Scan(&name); e != nil {
		t.Fatal(e)
	}
	return a, m, u, s, f
}
