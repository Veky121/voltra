package panel

import (
	"bytes"
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func TestBatch9XonoticActualSettingsAPI(t *testing.T) {
	a, mux, admin, server, fixture := quickSetupMinecraftFixture(t)
	egg := batchSettingsRecipeFixture(t, "xonotic/egg-xonotic.json")
	if _, err := a.update(context.Background(), "eggs", num(server["egg_id"]), egg); err != nil {
		t.Fatal(err)
	}
	original := "// operator\r\nseta sv_taunt 1\r\ng_friendlyfire 0.5\r\nrcon_password \"fixture-private-rcon\"\r\nunknown_literal retained\r\n"
	fixture.mu.Lock()
	delete(fixture.Files, "/server.properties")
	fixture.Files[xonoticSettingsPath], fixture.State = []byte(original), "offline"
	fixture.mu.Unlock()
	route := "/api/client/servers/" + str(server["uuid_short"]) + "/game-settings"
	view := asMap(infraExpect(t, mux, admin, "GET", route, nil, 200)["attributes"])
	if view["file"] != xonoticSettingsPath || laneGameSettingsField(view, "g_friendlyfire")["type"] != "number" || laneGameSettingsField(view, "sv_taunt")["type"] != "boolean" {
		t.Fatal("Xonotic declaration/dispatch or scalar type missing")
	}
	encoded, _ := json.Marshal(view)
	if strings.Contains(string(encoded), "fixture-private-rcon") {
		t.Fatal("Command document leaked unrelated credentials")
	}
	infraExpect(t, mux, admin, "PUT", route, M{"revision": view["revision"], "settings": M{"port": "29123"}}, 422)
	infraExpect(t, mux, admin, "PUT", route, M{"revision": view["revision"], "settings": M{"g_friendlyfire": "0.25", "sv_taunt": false}}, 200)
	fixture.mu.Lock()
	after := string(fixture.Files[xonoticSettingsPath])
	fixture.mu.Unlock()
	want := strings.Replace(strings.Replace(original, "g_friendlyfire 0.5", "g_friendlyfire 0.25", 1), "sv_taunt 1", "sv_taunt 0", 1)
	if after != want {
		t.Fatal("Xonotic editor changed prefix/comments/unknown credential bytes")
	}
}

func TestBatch9OpenArenaActiveModuleActualAPI(t *testing.T) {
	a, mux, admin, server, fixture := quickSetupMinecraftFixture(t)
	egg := batchSettingsRecipeFixture(t, openArenaSettingsRecipe)
	if _, err := a.update(context.Background(), "eggs", num(server["egg_id"]), egg); err != nil {
		t.Fatal(err)
	}
	variable, err := a.insert(context.Background(), "egg_variables", M{"egg_id": server["egg_id"], "name": "Game module", "env_variable": "GAME_MOD", "default_value": "missionpack", "user_viewable": true, "user_editable": true, "rules": "required|string|in:baseoa,missionpack", "field_type": "text"})
	if err != nil {
		t.Fatal(err)
	}
	fixture.mu.Lock()
	delete(fixture.Files, "/server.properties")
	fixture.Files[openArenaBaseSettingsPath] = []byte("set fraglimit 20\n")
	fixture.Files[openArenaMissionSettingsPath], fixture.State = []byte("// active\r\nseta fraglimit 30\r\nset g_allowVote 1\r\n"), "offline"
	fixture.mu.Unlock()
	route := "/api/client/servers/" + str(server["uuid_short"]) + "/game-settings"
	view := asMap(infraExpect(t, mux, admin, "GET", route, nil, 200)["attributes"])
	if view["file"] != openArenaMissionSettingsPath || len(asSlice(view["documents"])) != 1 || laneGameSettingsField(view, "fraglimit")["value"] != "30" {
		t.Fatal("Inactive baseoa document shadowed actual GAME_MOD")
	}
	infraExpect(t, mux, admin, "GET", route+"?file="+openArenaBaseSettingsPath, nil, 404)
	infraExpect(t, mux, admin, "PUT", route, M{"revision": view["revision"], "settings": M{"fraglimit": "40", "g_allowvote": false}}, 200)
	fixture.mu.Lock()
	inactive := string(fixture.Files[openArenaBaseSettingsPath])
	active := string(fixture.Files[openArenaMissionSettingsPath])
	fixture.mu.Unlock()
	if inactive != "set fraglimit 20\n" || active != "// active\r\nseta fraglimit 40\r\nset g_allowVote 0\r\n" {
		t.Fatal("Active module edit touched inactive bytes or lost setter prefix")
	}
	if _, err := a.insert(context.Background(), "server_variables", M{"server_id": server["id"], "variable_id": variable["id"], "variable_value": "baseoa"}); err != nil {
		t.Fatal(err)
	}
	selected := asMap(infraExpect(t, mux, admin, "GET", route, nil, 200)["attributes"])
	if selected["file"] != openArenaBaseSettingsPath || len(asSlice(selected["documents"])) != 1 {
		t.Fatal("Saved module override did not change settings selection")
	}
	infraExpect(t, mux, admin, "GET", route+"?file="+openArenaMissionSettingsPath, nil, 404)
}

func TestBatch9MindustryActualBinaryAPIAndGuard(t *testing.T) {
	a, mux, admin, server, fixture := quickSetupMinecraftFixture(t)
	egg := batchSettingsRecipeFixture(t, "mindustry/egg-mindustry.json")
	if egg["startup"] != "exec bash .voltra/mindustry-native-start.sh" {
		t.Fatal("Catalog has not received reviewed native-authority launcher")
	}
	if _, err := a.update(context.Background(), "eggs", num(server["egg_id"]), egg); err != nil {
		t.Fatal(err)
	}
	data := mindustryTestData(mindustryTestRow(t, "servername", 4, mindustryTestUTF(t, "Operator")), mindustryTestRow(t, "playerlimit", 1, mindustryTestInt(20)), mindustryTestRow(t, "port", 1, mindustryTestInt(6567)), mindustryTestRow(t, "autoUpdate", 0, []byte{0}), mindustryTestRow(t, "socket", 0, []byte{0}), mindustryTestRow(t, "startCommands", 4, mindustryTestUTF(t, "fixture-private-plugin")), mindustryTestRow(t, "admin-data", 5, append(mindustryTestInt(21), []byte("fixture-private-admin")...)))
	fixture.mu.Lock()
	delete(fixture.Files, "/server.properties")
	fixture.Files[mindustrySettingsPath], fixture.State = data, "offline"
	fixture.mu.Unlock()
	route := "/api/client/servers/" + str(server["uuid_short"]) + "/game-settings"
	view := asMap(infraExpect(t, mux, admin, "GET", route, nil, 200)["attributes"])
	if view["file"] != mindustrySettingsPath {
		t.Fatal("Reviewed binary document declaration missing")
	}
	encoded, _ := json.Marshal(view)
	if strings.Contains(string(encoded), "fixture-private-") {
		t.Fatal("Opaque admins or startup-command credential exposed")
	}
	for _, key := range []string{"port", "autoUpdate"} {
		f := laneGameSettingsField(view, key)
		if !boolean(f["readonly"]) || f["type"] == "readonly" {
			t.Fatal("Managed binary field lost native control type", key)
		}
	}
	for _, key := range []string{"port", "autoUpdate", "socket", "startCommands", "admin-data"} {
		value := any("1")
		if key == "autoUpdate" || key == "socket" {
			value = true
		}
		infraExpect(t, mux, admin, "PUT", route, M{"revision": view["revision"], "settings": M{key: value}}, 422)
	}
	infraExpect(t, mux, admin, "PUT", route, M{"revision": view["revision"], "settings": M{"servername": "Updated", "playerlimit": "12"}}, 200)
	want := bytes.Replace(data, mindustryTestUTF(t, "Operator"), mindustryTestUTF(t, "Updated"), 1)
	want = bytes.Replace(want, mindustryTestRow(t, "playerlimit", 1, mindustryTestInt(20)), mindustryTestRow(t, "playerlimit", 1, mindustryTestInt(12)), 1)
	fixture.mu.Lock()
	actual := append([]byte(nil), fixture.Files[mindustrySettingsPath]...)
	fixture.mu.Unlock()
	if !bytes.Equal(actual, want) {
		t.Fatal("Binary API edit changed unknown/admin byte spans")
	}
	if _, err := a.update(context.Background(), "eggs", num(server["egg_id"]), M{"startup": "java -jar legacy-overwriting-launcher.jar"}); err != nil {
		t.Fatal(err)
	}
	infraExpect(t, mux, admin, "GET", route+"?file="+mindustrySettingsPath, nil, 404)
}
