package panel

import (
	"context"
	"testing"
)

func TestWave10ActualStartupAPI(t *testing.T) {
	for _, recipe := range []string{redMSettingsRecipe, portalKnightsRecipe} {
		t.Run(recipe, func(t *testing.T) {
			a, mux, admin, server, fixture := quickSetupMinecraftFixture(t)
			egg := batchSettingsRecipeFixture(t, recipe)
			if _, e := a.update(context.Background(), "eggs", num(server["egg_id"]), egg); e != nil {
				t.Fatal(e)
			}
			if _, e := a.update(context.Background(), "servers", num(server["id"]), M{"startup": egg["startup"]}); e != nil {
				t.Fatal(e)
			}
			file, key, body := redMSettingsPath, "sv_lan", `sv_lan 0
sv_hostname "test"
`
			if recipe == portalKnightsRecipe {
				file, key, body = "/dedicated_server/server_config.json", "/users/canLogin", `{"basicServerData":{"name":"test"},"universeSize":"Normal","users":{"canLogin":false}}`
			}

			fixture.mu.Lock()
			delete(fixture.Files, "/server.properties")
			fixture.Files[file] = []byte(body)
			fixture.State = "offline"
			fixture.mu.Unlock()
			route := "/api/client/servers/" + str(server["uuid_short"]) + "/game-settings?file=" + file
			view := asMap(infraExpect(t, mux, admin, "GET", route, nil, 200)["attributes"])
			found := false
			for _, raw := range asSlice(view["fields"]) {
				f := asMap(raw)
				if str(f["key"]) == key {
					found = true
					if str(f["type"]) != "boolean" || boolean(f["secret"]) || boolean(f["readonly"]) {
						t.Fatal("boolean is not an editable public switch")
					}
				}
			}
			if !found {
				t.Fatal("expected grouped boolean missing")
			}
			infraExpect(t, mux, admin, "PUT", route, M{"revision": view["revision"], "settings": M{key: "true"}}, 422)
			fixture.mu.Lock()
			unchanged := string(fixture.Files[file]) == body
			fixture.mu.Unlock()
			if !unchanged {
				t.Fatal("invalid boolean changed file bytes")
			}
			reader, err := a.insert(context.Background(), "users", M{"uuid": newUUID(), "username": "campaign-reader", "email": "campaign-reader@example.invalid"})
			if err != nil {
				t.Fatal(err)
			}
			if _, err = a.insert(context.Background(), "subusers", M{"user_id": reader["id"], "server_id": server["id"], "permissions": []string{"file.read-content"}}); err != nil {
				t.Fatal(err)
			}
			infraExpect(t, mux, num(reader["id"]), "GET", route, nil, 200)
			infraExpect(t, mux, num(reader["id"]), "PUT", route, M{"revision": view["revision"], "settings": M{key: true}}, 403)
			infraExpect(t, mux, admin, "PUT", route, M{"revision": view["revision"], "settings": M{key: true}}, 200)
			infraExpect(t, mux, admin, "PUT", route, M{"revision": view["revision"], "settings": M{key: false}}, 409)
			view = asMap(infraExpect(t, mux, admin, "GET", route, nil, 200)["attributes"])
			fixture.mu.Lock()
			fixture.State = "running"
			fixture.mu.Unlock()
			infraExpect(t, mux, admin, "PUT", route, M{"revision": view["revision"], "settings": M{key: false}}, 409)
			if _, e := a.update(context.Background(), "servers", num(server["id"]), M{"startup": "old launcher"}); e != nil {
				t.Fatal(e)
			}
			infraExpect(t, mux, admin, "GET", route, nil, 404)
			infraExpect(t, mux, admin, "PUT", route, M{"revision": view["revision"], "settings": M{key: false}}, 404)
		})
	}
}
