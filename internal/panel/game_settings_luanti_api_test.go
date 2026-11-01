package panel

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func TestLuantiNativeFolderLinks(t *testing.T) {
	a, mux, admin, server, fixture := quickSetupMinecraftFixture(t)
	egg := batchSettingsRecipeFixture(t, "minetest/egg-minetest.json")
	if _, err := a.update(context.Background(), "eggs", num(server["egg_id"]), egg); err != nil {
		t.Fatal(err)
	}
	fixture.mu.Lock()
	delete(fixture.Files, "/server.properties")
	fixture.Files[luantiSettingsPath] = []byte("server_name=Folder fixture\n")
	for _, file := range []string{"/.minetest/mods/example/init.lua", "/.minetest/games/minetest/game.conf", "/.minetest/worlds/world/world.mt"} {
		fixture.Files[file] = []byte("fixture-private-folder-contents")
	}
	fixture.State = "offline"
	fixture.mu.Unlock()
	route := "/api/client/servers/" + str(server["uuid_short"]) + "/game-settings"
	view := asMap(infraExpect(t, mux, admin, "GET", route, nil, 200)["attributes"])
	folders := []M{}
	for _, raw := range asSlice(view["folders"]) {
		folder := asMap(raw)
		if strings.HasPrefix(str(folder["path"]), "/.minetest/") {
			folders = append(folders, folder)
		}
	}
	if len(folders) != 3 {
		t.Fatal("Existing Luanti native folders must be available", folders)
	}
	for i, name := range []string{"mods", "games", "worlds"} {
		if asMap(folders[i])["path"] != "/.minetest/"+name {
			t.Fatal("Wrong native folder link", folders[i])
		}
	}
	encoded, _ := json.Marshal(view)
	if strings.Contains(string(encoded), "fixture-private-folder-contents") {
		t.Fatal("Folder discovery read private contents")
	}
	fixture.mu.Lock()
	delete(fixture.Files, "/.minetest/mods/example/init.lua")
	fixture.mu.Unlock()
	missing := asMap(infraExpect(t, mux, admin, "GET", route, nil, 200)["attributes"])
	remaining := 0
	for _, raw := range asSlice(missing["folders"]) {
		if strings.HasPrefix(str(asMap(raw)["path"]), "/.minetest/") {
			remaining++
		}
	}
	if remaining != 2 {
		t.Fatal("Missing native folder should not be invented")
	}
}

func TestBatch9LuantiActualSettingsAPI(t *testing.T) {
	a, mux, admin, server, fixture := quickSetupMinecraftFixture(t)
	egg := batchSettingsRecipeFixture(t, "minetest/egg-minetest.json")
	if _, err := a.update(context.Background(), "eggs", num(server["egg_id"]), egg); err != nil {
		t.Fatal(err)
	}
	original := "# operator\r\nserver_name = Operator\r\ncreative_mode = yes\r\nenable_damage = 1\r\nenable_pvp = on\r\nmax_users = 12\r\nport = 30000\r\nbind_address = 0.0.0.0\r\ndefault_game = minetest\r\ndefault_password = fixture-private-admin\r\nfuture = literal#tail=retained\r\nmod_settings = {\r\n default_password = fixture-private-nested\r\n creative_mode = no\r\n}\r\n"
	fixture.mu.Lock()
	delete(fixture.Files, "/server.properties")
	fixture.Files[luantiSettingsPath], fixture.State = []byte(original), "offline"
	fixture.mu.Unlock()
	route := "/api/client/servers/" + str(server["uuid_short"]) + "/game-settings"
	view := asMap(infraExpect(t, mux, admin, "GET", route, nil, 200)["attributes"])
	if view["file"] != luantiSettingsPath || len(asSlice(view["documents"])) != 1 {
		t.Fatal("Custom Luanti declaration or dispatch missing")
	}
	encoded, _ := json.Marshal(view)
	if strings.Contains(string(encoded), "fixture-private-") {
		t.Fatal("Native secret or opaque body leaked")
	}
	if laneGameSettingsField(view, "creative_mode")["value"] != true || laneGameSettingsField(view, "enable_damage")["value"] != true {
		t.Fatal("Native yes/1 boolean pairs not rendered as switches")
	}
	if laneGameSettingsField(view, "enable_pvp")["type"] != "readonly" {
		t.Fatal("Native false-valued on spelling mislabeled as boolean")
	}
	if laneGameSettingsField(view, "future")["value"] != "literal#tail=retained" {
		t.Fatal("Generic INI/comment/equals parsing altered native literal")
	}
	if laneGameSettingsField(view, "mod_settings")["type"] != "readonly" {
		t.Fatal("Native group flattened into editable children")
	}
	for _, key := range []string{"port", "bind_address", "default_game"} {
		if !boolean(laneGameSettingsField(view, key)["readonly"]) {
			t.Fatal("Runtime-owned native key editable", key)
		}
		infraExpect(t, mux, admin, "PUT", route, M{"revision": view["revision"], "settings": M{key: "changed"}}, 422)
	}
	for _, settings := range []M{{"max_users": "0"}, {"max_users": "65536"}, {"missing": "inserted"}, {"future": "injected\nport=1"}, {"enable_pvp": true}} {
		infraExpect(t, mux, admin, "PUT", route, M{"revision": view["revision"], "settings": settings}, 422)
	}
	infraExpect(t, mux, admin, "PUT", route, M{"revision": view["revision"], "settings": M{"server_name": "Updated", "creative_mode": false, "enable_damage": false, "future": `"literal#value=kept\path"`}}, 200)
	want := strings.Replace(original, "server_name = Operator", "server_name = Updated", 1)
	want = strings.Replace(want, "creative_mode = yes", "creative_mode = no", 1)
	want = strings.Replace(want, "enable_damage = 1", "enable_damage = 0", 1)
	want = strings.Replace(want, "future = literal#tail=retained", `future = "literal#value=kept\path"`, 1)
	fixture.mu.Lock()
	after := string(fixture.Files[luantiSettingsPath])
	fixture.mu.Unlock()
	if after != want {
		t.Fatal("Native byte-span editor changed CRLF, literal quotes/hash, credentials or opaque body")
	}
}

func TestBatch9LuantiMissingOpaqueAndDuplicateAPI(t *testing.T) {
	a, mux, admin, server, fixture := quickSetupMinecraftFixture(t)
	egg := batchSettingsRecipeFixture(t, "minetest/egg-minetest.json")
	if _, err := a.update(context.Background(), "eggs", num(server["egg_id"]), egg); err != nil {
		t.Fatal(err)
	}
	fixture.mu.Lock()
	delete(fixture.Files, "/server.properties")
	fixture.State = "offline"
	fixture.mu.Unlock()
	route := "/api/client/servers/" + str(server["uuid_short"]) + "/game-settings"
	missing := asMap(infraExpect(t, mux, admin, "GET", route, nil, 200)["attributes"])
	if len(asSlice(missing["fields"])) != 0 || missing["file"] != "" {
		t.Fatal("Missing native file invented settings defaults")
	}
	infraExpect(t, mux, admin, "GET", route+"?file="+luantiSettingsPath, nil, 404)
	data := "server_name=First\nserver_name=Second\nmod_settings={\n password=fixture-private-group\n}\nmessage=\"\"\"\nfixture-private-multiline\n\"\"\"\n"
	fixture.mu.Lock()
	fixture.Files[luantiSettingsPath] = []byte(data)
	fixture.mu.Unlock()
	view := asMap(infraExpect(t, mux, admin, "GET", route, nil, 200)["attributes"])
	encoded, _ := json.Marshal(view)
	if strings.Contains(string(encoded), "fixture-private-") || strings.Contains(string(encoded), "First") || strings.Contains(string(encoded), "Second") {
		t.Fatal("Opaque body or ambiguous duplicate exposed")
	}
	for _, key := range []string{"server_name", "mod_settings", "message"} {
		if laneGameSettingsField(view, key)["type"] != "readonly" {
			t.Fatal("Opaque/duplicate field writable", key)
		}
	}
	infraExpect(t, mux, admin, "PUT", route, M{"revision": view["revision"], "settings": M{"server_name": "Third"}}, 422)
	fixture.mu.Lock()
	unchanged := string(fixture.Files[luantiSettingsPath])
	fixture.mu.Unlock()
	if unchanged != data {
		t.Fatal("Refused duplicate patch modified original bytes")
	}
}
