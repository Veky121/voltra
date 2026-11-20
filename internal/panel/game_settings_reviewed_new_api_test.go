package panel

import (
	"context"
	"testing"
	"voltra/internal/gamesettings"
)

func TestReviewedNewActualStartupAPI(t *testing.T) {
	for _, recipe := range []string{gamesettings.FoundryVTTRecipe, gamesettings.FiveMRecipe, gamesettings.SonsSettingsRecipe, gamesettings.ResoniteSettingsRecipe} {
		t.Run(recipe, func(t *testing.T) {
			a, mux, admin, server, fixture := quickSetupMinecraftFixture(t)
			egg := batchSettingsRecipeFixture(t, recipe)
			if _, e := a.update(context.Background(), "eggs", num(server["egg_id"]), egg); e != nil {
				t.Fatal(e)
			}
			if _, e := a.update(context.Background(), "servers", num(server["id"]), M{"startup": egg["startup"]}); e != nil {
				t.Fatal(e)
			}
			file, key, body := "/data/Config/options.json", "upnp", `{ "upnp": false, "passwordSalt": "private" }`
			if recipe == gamesettings.FiveMRecipe {
				wave95InstallReviewed(t, a, server, fixture, egg)
				file, key, body = "/server.cfg", "sv_lan", "sv_lan 0\nsv_hostname \"test\"\n"
			}
			if recipe == gamesettings.SonsSettingsRecipe {
				file, key, body = gamesettings.SonsSettingsPath, "/LanOnly", `{"LanOnly":false,"Password":"private","Unknown":123456789012345678901234567890}`
			}
			if recipe == gamesettings.ResoniteSettingsRecipe {
				file, _ = gamesettings.ReviewedNewSettings(egg)
				key, body = "/startWorlds/0/saveOnExit", `{"loginPassword":"private","startWorlds":[{"saveOnExit":false}]}`
			}
			if recipe == gamesettings.QuakeLiveSettingsRecipe {
				file, key, body = gamesettings.QuakeLiveBaseSettingsPath, "g_allowvote", "set g_allowvote 0\n"
			}
			if recipe == gamesettings.OpenraSettingsRecipe {
				file, key, body = gamesettings.OpenraSettingsPath, "Server.EnableVoteKick", "Server:\n\tEnableVoteKick: false\n"
			}
			fixture.mu.Lock()
			delete(fixture.Files, "/server.properties")
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
			if recipe == gamesettings.QuakeLiveSettingsRecipe {
				fixture.mu.Lock()
				fixture.Files[gamesettings.QuakeLiveHomeSettingsPath] = []byte(body)
				fixture.mu.Unlock()
				infraExpect(t, mux, admin, "GET", route, nil, 404)
				infraExpect(t, mux, admin, "PUT", route, M{"revision": view["revision"], "settings": M{key: false}}, 404)
				route = "/api/client/servers/" + str(server["uuid_short"]) + "/game-settings?file=" + gamesettings.QuakeLiveHomeSettingsPath
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
