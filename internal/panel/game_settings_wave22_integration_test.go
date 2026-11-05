package panel

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

func TestWave22SettingsAPI(t *testing.T) {
	for _, tc := range []struct{ recipe, file, data, key, value string }{
		{ss14SettingsRecipe, ss14SettingsPath, "[game]\nhostname=\"Before\"\ndesc=\"Existing\"\nsoft_max_players=10\n", "game/hostname", "After"},
		{stationeersBepinexRecipe, stationeersBepinexSettingsPath, "<SettingData><ServerName>Before</ServerName><ServerPassword>private-fixture-secret</ServerPassword></SettingData>", "ServerName", "After"},
		{"the_isle/evrima/egg-the-isle.json", isleEvrimaSettingsPath, "[" + isleEvrimaSection + "]\nServerName=Before\nMaxPlayerCount=20\n", isleEvrimaSection + "/ServerName", "After"},
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
			change := M{tc.key: tc.value}
			input := M{"revision": view["revision"], "settings": change}
			// An undeclared path cannot inherit the selected document's authority.
			infraExpect(t, mux, admin, "GET", endpoint+"?file="+url.QueryEscape("/inactive/server.cfg"), nil, 404)
			if tc.file == isleEvrimaSettingsPath {
				infraExpect(t, mux, admin, "PUT", endpoint, M{"revision": view["revision"], "settings": M{isleEvrimaSection + "/MaxPlayerCount": "25"}}, 422)
			}
			beforeInvalid := f.Writes
			infraExpect(t, mux, admin, "PUT", endpoint, M{"revision": view["revision"], "settings": M{"unreviewed/field": "value"}}, 422)
			if f.Writes != beforeInvalid {
				t.Fatal("invalid field wrote")
			}
			f.State = "running"
			infraExpect(t, mux, admin, "PUT", endpoint, input, 409)
			f.State = "offline"
			infraExpect(t, mux, admin, "PUT", endpoint, input, 200)
			infraExpect(t, mux, admin, "PUT", endpoint, input, 409)
			// Valid non-path environment drift must invalidate a content-identical revision.
			old := asMap(infraExpect(t, mux, admin, "GET", endpoint, nil, 200)["attributes"])
			if _, e := a.insert(ctx, "egg_variables", M{"egg_id": server["egg_id"], "name": "Revision fixture", "env_variable": "CAMPAIGN_REVISION_FIXTURE", "default_value": "changed", "rules": "nullable"}); e != nil {
				t.Fatal(e)
			}
			beforeDrift := f.Writes
			infraExpect(t, mux, admin, "PUT", endpoint, M{"revision": old["revision"], "settings": change}, 409)
			if f.Writes != beforeDrift {
				t.Fatal("environment drift wrote")
			}
			if tc.recipe == starboundAuthorityRecipe {
				old = asMap(infraExpect(t, mux, admin, "GET", endpoint, nil, 200)["attributes"])
				f.Files["/sbinit.config"] = []byte(`{"storageDirectory":"storage","unknown":true}`)
				infraExpect(t, mux, admin, "PUT", endpoint, M{"revision": old["revision"], "settings": change}, 409)
			}

			if tc.recipe == "subnautica_nitrox_mod/egg-subnautica.json" {
				old = asMap(infraExpect(t, mux, admin, "GET", endpoint, nil, 200)["attributes"])
				f.Files["/NitroxData/nitrox.cfg"] = []byte(`{"Unrelated":"binding drift"}`)
				infraExpect(t, mux, admin, "PUT", endpoint, M{"revision": old["revision"], "settings": change}, 409)
				if e := a.exec(ctx, "UPDATE egg_variables SET default_value='changed_world' WHERE egg_id=$1 AND env_variable='SAVE_NAME'", server["egg_id"]); e != nil {
					t.Fatal(e)
				}
				infraExpect(t, mux, admin, "PUT", endpoint+"?file="+url.QueryEscape(tc.file), M{"revision": old["revision"], "settings": change}, 404)
				if e := a.exec(ctx, "UPDATE egg_variables SET default_value='nitrox_world' WHERE egg_id=$1 AND env_variable='SAVE_NAME'", server["egg_id"]); e != nil {
					t.Fatal(e)
				}
				if f.Writes != beforeDrift {
					t.Fatal("Nitrox path drift wrote")
				}
			}

			reader, err := a.insert(ctx, "users", M{"uuid": newUUID(), "username": "campaign-reader", "email": "campaign-reader@example.invalid"})
			if err != nil {
				t.Fatal(err)
			}
			if _, err = a.insert(ctx, "subusers", M{"user_id": reader["id"], "server_id": server["id"], "permissions": []string{"file.read-content"}}); err != nil {
				t.Fatal(err)
			}
			infraExpect(t, mux, num(reader["id"]), "GET", endpoint, nil, 200)
			infraExpect(t, mux, num(reader["id"]), "PUT", endpoint, input, 403)
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

			before := f.Writes
			for name := range f.Files {
				if strings.HasPrefix(name, "/.voltra/") && strings.HasSuffix(name, ".py") {
					f.Files[name] = []byte("drift")
					break
				}
			}
			infraExpect(t, mux, admin, "PUT", endpoint, input, 404)
			if f.Writes != before {
				t.Fatal("boot drift wrote")
			}
		})
	}
}
