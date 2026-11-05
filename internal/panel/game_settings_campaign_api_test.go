package panel

import (
	"context"
	"testing"
)

func TestCampaignActualStartupAPI(t *testing.T) {
	for _, recipe := range []string{hl2dmSettingsRecipe, quakeLiveSettingsRecipe, openraSettingsRecipe} {
		t.Run(recipe, func(t *testing.T) {
			a, mux, admin, server, fixture := quickSetupMinecraftFixture(t)
			egg := batchSettingsRecipeFixture(t, recipe)
			if recipe == hl2dmSettingsRecipe {
				egg["java_config"] = M{}
			}
			if _, e := a.update(context.Background(), "eggs", num(server["egg_id"]), egg); e != nil {
				t.Fatal(e)
			}
			if _, e := a.update(context.Background(), "servers", num(server["id"]), M{"startup": egg["startup"]}); e != nil {
				t.Fatal(e)
			}
			if recipe == hl2dmSettingsRecipe {
				hl2dmFixtureAllocation(t, a, server)
			}
			file, key, body := hl2dmSettingsPath, "mp_teamplay", "mp_teamplay 0\n"
			if recipe == quakeLiveSettingsRecipe {
				file, key, body = quakeLiveBaseSettingsPath, "g_allowvote", "set g_allowvote 0\n"
			}
			if recipe == openraSettingsRecipe {
				file, key, body = openraSettingsPath, "Server.EnableVoteKick", "Server:\n\tEnableVoteKick: false\n"
			}
			fixture.mu.Lock()
			delete(fixture.Files, "/server.properties")
			if recipe == hl2dmSettingsRecipe {
				hl2dmFixtureHelpers(t, fixture)
			}
			fixture.Files[file] = []byte(body)
			fixture.State = "offline"
			fixture.mu.Unlock()
			route := "/api/client/servers/" + str(server["uuid_short"]) + "/game-settings?file=" + file
			view := asMap(infraExpect(t, mux, admin, "GET", route, nil, 200)["attributes"])
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
			if recipe == quakeLiveSettingsRecipe {
				fixture.mu.Lock()
				fixture.Files[quakeLiveHomeSettingsPath] = []byte(body)
				fixture.mu.Unlock()
				infraExpect(t, mux, admin, "GET", route, nil, 404)
				infraExpect(t, mux, admin, "PUT", route, M{"revision": view["revision"], "settings": M{key: false}}, 404)
				route = "/api/client/servers/" + str(server["uuid_short"]) + "/game-settings?file=" + quakeLiveHomeSettingsPath
			}
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
