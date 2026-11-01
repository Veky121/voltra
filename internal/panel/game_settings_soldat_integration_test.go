package panel

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func TestSoldatIntegratedActualStartupAPI(t *testing.T) {
	for _, recipe := range []string{soldatClassicRecipe, soldat2Recipe} {
		t.Run(recipe, func(t *testing.T) {
			a, mux, admin, server, fixture := quickSetupMinecraftFixture(t)
			egg := batchSettingsRecipeFixture(t, recipe)
			if _, e := a.update(context.Background(), "eggs", num(server["egg_id"]), egg); e != nil {
				t.Fatal(e)
			}
			if _, e := a.update(context.Background(), "servers", num(server["id"]), M{"startup": egg["startup"]}); e != nil {
				t.Fatal(e)
			}
			file, key, body := "/soldat.ini", "NETWORK/Lobby_Register", "[NETWORK]\nLobby_Register=0\nPort=29120\nServer_Name=Before\nAdmin_Password=fixture-secret\n"
			if recipe == soldat2Recipe {
				file, key, body = "/autoconfig.ini", "GameServerConfig/AllowSpectators", "[GameServerConfig]\nAllowSpectators=False\nName=Before\nServerPassword=fixture-secret\n"
			}
			fixture.mu.Lock()
			delete(fixture.Files, "/server.properties")
			fixture.Files[file] = []byte(body)
			fixture.State = "offline"
			fixture.mu.Unlock()
			route := "/api/client/servers/" + str(server["uuid_short"]) + "/game-settings?file=" + file
			view := asMap(infraExpect(t, mux, admin, "GET", route, nil, 200)["attributes"])
			encoded, _ := json.Marshal(view)
			if strings.Contains(string(encoded), "fixture-secret") {
				t.Fatal("secret exposed")
			}
			managed := "NETWORK/Port"
			if recipe == soldat2Recipe {
				managed = "GameServerConfig/Name"
			}
			infraExpect(t, mux, admin, "PUT", route, M{"revision": view["revision"], "settings": M{managed: "changed"}}, 422)
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
			fixture.mu.Lock()
			before := string(fixture.Files[file])
			fixture.mu.Unlock()
			if _, e := a.update(context.Background(), "servers", num(server["id"]), M{"startup": "old launcher"}); e != nil {
				t.Fatal(e)
			}
			infraExpect(t, mux, admin, "GET", route, nil, 404)
			infraExpect(t, mux, admin, "PUT", route, M{"revision": view["revision"], "settings": M{key: false}}, 404)
			fixture.mu.Lock()
			after := string(fixture.Files[file])
			fixture.mu.Unlock()
			if before != after {
				t.Fatal("old launcher wrote native file")
			}
		})
	}
}
