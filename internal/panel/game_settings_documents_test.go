package panel

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func TestGameSettingsNativeRoundTrips(t *testing.T) {
	cases := []struct{ file, input, key, value, keep string }{
		{"/server.properties", "# keep\r\nmotd=Before\r\ncustom=unchanged\r\n", "motd", "Hello: world", "# keep\r\n"},
		{"/config/paper-global.yml", "# keep\nmisc:\n  enable-nether: true # keep bool\n  region-file-cache-size: 256\n", "/misc/enable-nether", "false", "# keep bool"},
		{"/server.json", "{\"server\":{\"enabled\":true,\"limit\":12},\"unknown\":\"keep\"}", "/server/enabled", "false", "keep"},
		{"/server.ini", "; keep\r\n[Server]\r\nEnabled = 1 ; boolean\r\nPlayers=1\r\n", "Server/Enabled", "0", "; boolean\r\n"},
		{"/config/neoforge-server.toml", "# keep\n[server]\nremoveErroringEntities = false # comment\nname = \"before\"\n", "server/removeErroringEntities", "true", "# comment"},
		{"/serverconfig.xml", "<ServerSettings><!-- keep --><property name=\"ServerName\" value=\"Before\"/></ServerSettings>", "ServerName", "After & friends", "<!-- keep -->"},
		{"/Pal/Saved/Config/LinuxServer/PalWorldSettings.ini", "[/Script/Pal.PalGameWorldSettings]\nOptionSettings=(ServerName=\"Before\",ServerPassword=\"hidden-value\",ExpRate=1.0,Unknown=(A,B))\n", "ServerName", "After, with punctuation", "Unknown=(A,B)"},
	}
	for _, tc := range cases {
		t.Run(tc.file, func(t *testing.T) {
			parsed, err := parseGameSettings(tc.file, []byte(tc.input))
			if err != nil {
				t.Fatal(err)
			}
			updated, err := parsed.patch(map[string]string{tc.key: tc.value})
			if err != nil {
				t.Fatal(err)
			}
			if !strings.Contains(string(updated), tc.keep) {
				t.Fatalf("lost untouched configuration: %s", updated)
			}
			next, err := parseGameSettings(tc.file, updated)
			if err != nil {
				t.Fatal(err)
			}
			found := false
			for _, f := range next.fields {
				if f.key == tc.key {
					found = true
					if f.value != tc.value {
						t.Fatalf("value did not round trip: %q", f.value)
					}
				}
			}
			if !found {
				t.Fatal("setting disappeared")
			}
		})
	}
}

func TestGameSettingsListsAndBooleanEncoding(t *testing.T) {
	parsed, err := parseGameSettings("/paper.yml", []byte("# keep\nallowed: []\nflags:\n  enabled: true\n"))
	if err != nil {
		t.Fatal(err)
	}
	updated, err := parsed.patch(map[string]string{"/allowed": "[\"minecraft:stone\",\"minecraft:dirt\"]"})
	if err != nil {
		t.Fatal(err)
	}
	next, err := parseGameSettings("/paper.yml", updated)
	if err != nil {
		t.Fatal(err)
	}
	if len(next.fields) != 2 {
		t.Fatal("list was split into unrelated fields")
	}
	for _, tc := range []struct{ key, value, kind string }{{"enabled", "1", "boolean"}, {"RCONEnabled", "0", "boolean"}, {"max-players", "1", "number"}, {"island", "1", "number"}, {"entity-broadcast-range-percentage", "1", "number"}, {"pvp", "false", "boolean"}, {"password", "true", "text"}} {
		f := gameSettingType(tc.key, tc.value)
		if f.kind != tc.kind {
			t.Errorf("%s: got %s want %s", tc.key, f.kind, tc.kind)
		}
	}
	fields := []gameSetting{gameSettingType("Enabled", "1")}
	patch, err := gameSettingsChanges(fields, M{"Enabled": false}, M{}, "/server.ini")
	if err != nil || patch["Enabled"] != "0" {
		t.Fatal("boolean lost its native numeric representation")
	}
	if _, err = gameSettingsChanges(fields, M{"Enabled": "false"}, M{}, "/server.ini"); err == nil {
		t.Fatal("invalid boolean accepted")
	}
}

func TestGameSettingsRejectAmbiguousDocuments(t *testing.T) {
	for _, tc := range []struct{ file, input string }{{"/paper.yml", "x: 1\nx: 2\n"}, {"/paper.yml", "x: &x {a: 1}\ny: *x\n"}, {"/server.ini", "x=1\nx=2\n"}, {"/server.json", "{invalid}"}} {
		if _, err := parseGameSettings(tc.file, []byte(tc.input)); err == nil {
			t.Errorf("ambiguous document accepted: %s", tc.input)
		}
	}
}

func TestGameSettingsPlatformDocumentsPermissionsAndRevision(t *testing.T) {
	a, mux, admin, server, f := quickSetupMinecraftFixture(t)
	f.mu.Lock()
	f.Files["/server.properties"] = append(f.Files["/server.properties"], []byte("rcon.password=private-native-secret\nenable-rcon=false\nserver-port=25565\n")...)
	f.Files["/config/paper-global.yml"] = []byte("# preserve\nmisc:\n  enable-nether: true\n  region-file-cache-size: 256\n")
	f.Files["/plugins/example/config.yml"] = []byte("private: true\n")
	f.mu.Unlock()
	endpoint := "/api/client/servers/" + str(server["uuid_short"]) + "/game-settings"
	view := asMap(infraExpect(t, mux, admin, "GET", endpoint, nil, 200)["attributes"])
	data, _ := json.Marshal(view)
	if strings.Contains(string(data), "private-native-secret") {
		t.Fatal("secret returned by editor")
	}
	if strings.Contains(string(data), "plugins/example") {
		t.Fatal("plugin configuration merged into server settings")
	}
	if str(view["file"]) != "/server.properties" || len(asSlice(view["fields"])) < 8 {
		t.Fatal("full native properties not exposed")
	}
	var secret, managed bool
	for _, v := range asSlice(view["fields"]) {
		field := asMap(v)
		if field["key"] == "rcon.password" {
			secret = field["value"] == nil && boolean(field["configured"])
		}
		if field["key"] == "server-port" {
			managed = boolean(field["readonly"])
		}
	}
	if !secret || !managed {
		t.Fatal("secret or managed listener metadata missing")
	}
	infraExpect(t, mux, admin, "GET", endpoint+"?file=%2Fplugins%2Fexample%2Fconfig.yml", nil, 404)
	revision := view["revision"]
	f.mu.Lock()
	f.State = "running"
	f.mu.Unlock()
	infraExpect(t, mux, admin, "PUT", endpoint, M{"revision": revision, "settings": M{"motd": "After"}}, 409)
	f.mu.Lock()
	f.State = "offline"
	f.Files["/server.properties"] = append(f.Files["/server.properties"], []byte("external=true\n")...)
	f.mu.Unlock()
	infraExpect(t, mux, admin, "PUT", endpoint, M{"revision": revision, "settings": M{"motd": "After"}}, 409)
	view = asMap(infraExpect(t, mux, admin, "GET", endpoint, nil, 200)["attributes"])
	infraExpect(t, mux, admin, "PUT", endpoint, M{"revision": view["revision"], "settings": M{"server-port": "1234"}}, 422)
	infraExpect(t, mux, admin, "PUT", endpoint, M{"revision": view["revision"], "settings": M{"motd": "After"}}, 200)
	paperURL := endpoint + "?file=%2Fconfig%2Fpaper-global.yml"
	paper := asMap(infraExpect(t, mux, admin, "GET", paperURL, nil, 200)["attributes"])
	infraExpect(t, mux, admin, "PUT", paperURL, M{"revision": paper["revision"], "settings": M{"/misc/enable-nether": false}}, 200)
	f.mu.Lock()
	content := string(f.Files["/config/paper-global.yml"])
	f.mu.Unlock()
	if !strings.Contains(content, "enable-nether: false") || !strings.Contains(content, "# preserve") {
		t.Fatal("Paper switch did not preserve the native document")
	}
	reader, err := a.insert(context.Background(), "users", M{"uuid": newUUID(), "username": "settings-reader", "email": "settings-reader@example.invalid"})
	if err != nil {
		t.Fatal(err)
	}
	_, err = a.insert(context.Background(), "subusers", M{"user_id": reader["id"], "server_id": server["id"], "permissions": []string{"file.read-content"}})
	if err != nil {
		t.Fatal(err)
	}
	readonly := asMap(infraExpect(t, mux, num(reader["id"]), "GET", endpoint, nil, 200)["attributes"])
	if len(asSlice(readonly["folders"])) != 0 {
		t.Fatal("folders disclosed without file.read")
	}
	infraExpect(t, mux, num(reader["id"]), "PUT", endpoint, M{"revision": readonly["revision"], "settings": M{"motd": "Denied"}}, 403)
}

func TestGameSettingsMainEditorDoesNotWaitForWorldLookups(t *testing.T) {
	_, mux, admin, server, f := quickSetupMinecraftFixture(t)
	f.mu.Lock()
	f.ListFailures = map[string]int{"/custom-world": 500}
	f.mu.Unlock()
	endpoint := "/api/client/servers/" + str(server["uuid_short"]) + "/game-settings"
	view := asMap(infraExpect(t, mux, admin, "GET", endpoint, nil, 200)["attributes"])
	if len(asSlice(view["fields"])) == 0 {
		t.Fatal("world lookup failure blocked server properties")
	}
	infraExpect(t, mux, admin, "GET", endpoint+"?inventory=all", nil, 502)
	infraExpect(t, mux, admin, "GET", endpoint+"/folders", nil, 200)
	infraExpect(t, mux, admin, "GET", endpoint, nil, 200)
}
