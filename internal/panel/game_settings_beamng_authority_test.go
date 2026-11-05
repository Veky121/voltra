package panel

import (
	"context"
	"net/http"
	"net/url"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestWave160Beamng(t *testing.T) {
	for _, recipe := range []string{"beamng/beammp/egg-beam-m-p-server.json", "beamng/kissmp/egg-kissmp.json"} {
		t.Run(recipe, func(t *testing.T) {
			a, mux, admin, server, f := quickSetupMinecraftFixture(t)
			ctx := context.Background()
			al, e := a.insert(ctx, "allocations", M{"node_id": server["node_id"], "server_id": server["id"], "ip": "127.0.0.1", "port": 30814})
			if e != nil {
				t.Fatal(e)
			}
			if _, e = a.update(ctx, "servers", num(server["id"]), M{"allocation_id": al["id"]}); e != nil {
				t.Fatal(e)
			}
			var egg M
			for _, entry := range gameTemplates().Entries {
				if entry.Path == recipe {
					egg = M{"uuid": gameTemplateEggUUID(entry), "startup": entry.Egg["startup"], "config_files": entry.Egg["config_files"]}
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
						expected, _, ok := strings.Cut(body, "\n"+strings.TrimSuffix(marker, "'")+"\n")
						if ok {
							f.Files["/"+name] = []byte(expected + "\n")
						}
					}
				}
			}
			// PTDL import stores an empty object; the template may declare null.
			egg["config_files"] = M{}
			egg["features"] = []any{}
			egg["java_config"] = M{}
			if egg == nil {
				t.Fatal("missing recipe")
			}
			if _, e := a.update(ctx, "eggs", num(server["egg_id"]), egg); e != nil {
				t.Fatal(e)
			}
			if _, e := a.update(ctx, "servers", num(server["id"]), M{"startup": egg["startup"]}); e != nil {
				t.Fatal(e)
			}
			file, key, port, original := "/ServerConfig.toml", "General/Name", "General/Port", "[General]\nName=\"Before\"\nAuthKey=\"fixture-secret\"\nPort=30814\n"
			if strings.Contains(recipe, "kissmp") {
				file, key, port, original = "/config.json", "/server_name", "/port", `{"server_name":"Before","port":3698,"unknown":9007199254740993}`
			}
			f.Files[file] = []byte(original)
			f.State = "offline"
			endpoint := "/api/client/servers/" + str(server["uuid_short"]) + "/game-settings?file=" + url.QueryEscape(file)
			view := asMap(infraExpect(t, mux, admin, "GET", endpoint, nil, 200)["attributes"])
			infraExpect(t, mux, admin, "PUT", endpoint, M{"revision": view["revision"], "settings": M{key: "After"}}, 200)
			view = asMap(infraExpect(t, mux, admin, "GET", endpoint, nil, 200)["attributes"])
			// A nonempty startup mapping changes configuration authority.
			writesBeforeMapping := f.Writes
			if _, err := a.update(ctx, "eggs", num(server["egg_id"]), M{"config_files": M{"config.json": M{"parser": "json"}}}); err != nil {
				t.Fatal(err)
			}
			infraExpect(t, mux, admin, "GET", endpoint, nil, 404)
			infraExpect(t, mux, admin, "PUT", endpoint, M{"revision": view["revision"], "settings": M{key: "mapped"}}, 404)
			if f.Writes != writesBeforeMapping {
				t.Fatal("nonempty mapping refusal wrote")
			}
			if _, err := a.update(ctx, "eggs", num(server["egg_id"]), M{"config_files": M{}}); err != nil {
				t.Fatal(err)
			}
			before := string(f.Files[file])
			infraExpect(t, mux, admin, "PUT", endpoint, M{"revision": view["revision"], "settings": M{port: "31000"}}, 422)
			if string(f.Files[file]) != before {
				t.Fatal("port refusal wrote")
			}
			infraExpect(t, mux, admin, "PUT", endpoint, M{"revision": "stale", "settings": M{key: "stale"}}, 409)

			reader, e := a.insert(ctx, "users", M{"uuid": newUUID(), "username": "beam-reader", "email": "beam-reader@example.test", "name_first": "Reader", "name_last": "Fixture"})
			if e != nil {
				t.Fatal(e)
			}
			if _, e = a.insert(ctx, "subusers", M{"user_id": reader["id"], "server_id": server["id"], "permissions": []string{"file.read-content"}}); e != nil {
				t.Fatal(e)
			}
			writes := f.Writes
			infraExpect(t, mux, num(reader["id"]), "PUT", endpoint, M{"revision": view["revision"], "settings": M{key: "no"}}, 403)
			if e = a.exec(ctx, "UPDATE users SET disabled=true WHERE id=$1", admin); e != nil {
				t.Fatal(e)
			}
			status, _, _ := infraRequest(t, mux, admin, "PUT", endpoint, M{"revision": view["revision"], "settings": M{key: "no"}})
			if status < 400 {
				t.Fatal("disabled accepted")
			}
			if e = a.exec(ctx, "UPDATE users SET disabled=false WHERE id=$1", admin); e != nil {
				t.Fatal(e)
			}
			if f.Writes != writes {
				t.Fatal("permission refusal wrote")
			}

			f.Files["/root.ini"] = []byte("[Server]\nName=unrelated\n")
			unrelated := "/api/client/servers/" + str(server["uuid_short"]) + "/game-settings?file=/root.ini"
			w0 := f.Writes
			infraExpect(t, mux, admin, "GET", unrelated, nil, 404)
			infraExpect(t, mux, admin, "PUT", unrelated, M{"revision": view["revision"], "settings": M{"Server/Name": "no"}}, 404)
			if f.Writes != w0 {
				t.Fatal("unrelated root wrote")
			}
			if _, e = a.insert(ctx, "subusers", M{"user_id": admin, "server_id": server["id"], "permissions": []string{"file.read-content"}}); e != nil {
				t.Fatal(e)
			}
			for _, mode := range []string{"startup", "helper", "disabled", "readonly"} {
				t.Run("final-"+mode, func(t *testing.T) {
					current := asMap(infraExpect(t, mux, admin, "GET", endpoint, nil, 200)["attributes"])
					transport := a.HTTP.Transport
					calls := 0
					fired := false
					var hp string
					var saved []byte
					for name := range f.Files {
						if strings.HasPrefix(name, "/.voltra/") {
							hp = name
							saved = append([]byte(nil), f.Files[name]...)
							break
						}
					}
					a.HTTP.Transport = wave154Transport{transport, func(req *http.Request) {
						if strings.Contains(req.URL.Path, "files/contents") && req.URL.Query().Get("file") == file {
							calls++
							if calls == 2 {
								fired = true
								switch mode {
								case "startup":
									if _, e := a.update(ctx, "servers", num(server["id"]), M{"startup": "exec revoked late"}); e != nil {
										t.Fatal(e)
									}
								case "helper":
									f.Files[hp] = append(f.Files[hp], byte(' '))
								case "disabled":
									if e := a.exec(ctx, "UPDATE users SET disabled=true WHERE id=$1", admin); e != nil {
										t.Fatal(e)
									}
								case "readonly":
									if e := a.exec(ctx, "UPDATE users SET root_admin=false WHERE id=$1", admin); e != nil {
										t.Fatal(e)
									}
									if _, e := a.update(ctx, "servers", num(server["id"]), M{"owner_id": reader["id"]}); e != nil {
										t.Fatal(e)
									}
								}
							}
						}
					}}
					writes := f.Writes
					status, _, _ := infraRequest(t, mux, admin, "PUT", endpoint, M{"revision": current["revision"], "settings": M{key: "late refused"}})
					a.HTTP.Transport = transport
					if !fired || status < 400 || f.Writes != writes {
						t.Fatalf("late %s fired=%v status=%d writes=%d reads=%d", mode, fired, status, f.Writes-writes, calls)
					}
					f.Files[hp] = saved
					if _, e := a.update(ctx, "servers", num(server["id"]), M{"startup": egg["startup"], "owner_id": admin}); e != nil {
						t.Fatal(e)
					}
					if e := a.exec(ctx, "UPDATE users SET disabled=false,root_admin=true WHERE id=$1", admin); e != nil {
						t.Fatal(e)
					}
				})
			}
			// Exact helper drift must lose both read and write authority.
			var helper string
			for name := range f.Files {
				if strings.HasPrefix(name, "/.voltra/") {
					helper = name
					break
				}
			}
			saved := append([]byte(nil), f.Files[helper]...)
			f.Files[helper] = append(f.Files[helper], byte(' '))
			infraExpect(t, mux, admin, "GET", endpoint, nil, 404)
			infraExpect(t, mux, admin, "PUT", endpoint, M{"revision": view["revision"], "settings": M{key: "helper denied"}}, 404)
			f.Files[helper] = saved
			f.State = "running"
			status, _, _ = infraRequest(t, mux, admin, "PUT", endpoint, M{"revision": view["revision"], "settings": M{key: "running denied"}})
			if status < 400 {
				t.Fatal("running accepted")
			}
			f.State = "offline"
			// Prove the handler actually waits on the shared mutation lock, then
			// revoke startup while it is waiting. No daemon write may follow.
			tx, e := a.DB.Begin(ctx)
			if e != nil {
				t.Fatal(e)
			}
			if _, e = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "voltra:server-mutation:"+str(server["uuid"])); e != nil {
				t.Fatal(e)
			}
			done := make(chan int, 1)
			go func() {
				status, _, _ := infraRequest(t, mux, admin, "PUT", endpoint, M{"revision": view["revision"], "settings": M{key: "locked denied"}})
				done <- status
			}()
			waiting := false
			deadline := time.Now().Add(5 * time.Second)
			for time.Now().Before(deadline) {
				if e = a.DB.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND NOT granted AND database=(SELECT oid FROM pg_database WHERE datname=current_database()))").Scan(&waiting); e != nil {
					t.Fatal(e)
				}
				if waiting {
					break
				}
				runtime.Gosched()
			}
			if !waiting {
				tx.Rollback(ctx)
				t.Fatal("no contended lock observed")
			}
			if _, e = a.update(ctx, "servers", num(server["id"]), M{"startup": "exec revoked under lock"}); e != nil {
				t.Fatal(e)
			}
			if e = tx.Commit(ctx); e != nil {
				t.Fatal(e)
			}
			if status := <-done; status < 400 {
				t.Fatal("contended revocation accepted")
			}
			if _, e = a.update(ctx, "servers", num(server["id"]), M{"startup": egg["startup"]}); e != nil {
				t.Fatal(e)
			}
			// Allocation membership participates in the revision, including its port.
			if _, e := a.update(ctx, "allocations", num(al["id"]), M{"port": 30815}); e != nil {
				t.Fatal(e)
			}
			infraExpect(t, mux, admin, "PUT", endpoint, M{"revision": view["revision"], "settings": M{key: "allocation denied"}}, 409)
			if string(f.Files[file]) != before {
				t.Fatal("negative matrix wrote")
			}
			if _, e := a.update(ctx, "servers", num(server["id"]), M{"startup": "exec inactive"}); e != nil {
				t.Fatal(e)
			}
			// Both GET and PUT must lose admission when the active launcher changes.
			infraExpect(t, mux, admin, "GET", endpoint, nil, 404)
			infraExpect(t, mux, admin, "PUT", endpoint, M{"revision": view["revision"], "settings": M{key: "denied"}}, 404)
			if string(f.Files[file]) != before {
				t.Fatal("authority refusal wrote")
			}
			if a.DB.Stat().AcquiredConns() != 0 {
				t.Fatal("acquired connections")
			}
		})
	}
}
