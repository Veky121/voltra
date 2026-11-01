package panel

import (
	"context"
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

func TestFactorioActualSettingsDiscoveryPrivacyAndPreservation(t *testing.T) {
	a, mux, admin, server, fixture := quickSetupMinecraftFixture(t)
	egg := batchSettingsRecipeFixture(t, "factorio/factorio/egg-factorio.json")
	if _, err := a.update(context.Background(), "eggs", num(server["egg_id"]), egg); err != nil {
		t.Fatal(err)
	}
	if _, err := a.update(context.Background(), "servers", num(server["id"]), M{"startup": factorioNativeStartup}); err != nil {
		t.Fatal(err)
	}
	file := "/data/server-settings.json"
	original := "{\r\n  \"name\": \"Operator\",\r\n  \"visibility\": {\"public\": false, \"lan\": true},\r\n  \"autosave_interval\": 10,\r\n  \"game_password\": \"fixture-private-join\",\r\n  \"token\": \"fixture-private-token\",\r\n  \"password\": \"fixture-private-account\",\r\n  \"future\": 900719925474099312345,\r\n  \"_comment\": \"operator text\"\r\n}\r\n"
	fixture.mu.Lock()
	delete(fixture.Files, "/server.properties")
	fixture.Files[file], fixture.State = []byte(original), "offline"
	fixture.Files["/data/map-gen-settings.json"] = []byte(`{"peaceful_mode":false,"seed":123}`)
	fixture.Files["/data/map-settings.json"] = []byte(`{"pollution":{"enabled":true}}`)
	fixture.mu.Unlock()
	route := "/api/client/servers/" + str(server["uuid_short"]) + "/game-settings"
	view := asMap(infraExpect(t, mux, admin, "GET", route, nil, 200)["attributes"])
	if view["file"] != file || len(asSlice(view["documents"])) != 3 {
		t.Fatal("General native server settings must precede map-creation documents", view["file"])
	}
	encoded, _ := json.Marshal(view)
	if strings.Contains(string(encoded), "fixture-private-") {
		t.Fatal("Native join or account credentials exposed through settings GET")
	}
	if laneGameSettingsField(view, "/visibility/lan")["type"] != "boolean" || laneGameSettingsField(view, "/autosave_interval")["type"] != "number" {
		t.Fatal("Native controls lost their types")
	}
	infraExpect(t, mux, admin, "PUT", route, M{"revision": view["revision"], "settings": M{"/visibility/lan": "invalid"}}, 422)
	infraExpect(t, mux, admin, "PUT", route, M{"revision": view["revision"], "settings": M{"/name": "Updated", "/visibility/lan": false, "/autosave_interval": "7"}}, 200)
	fixture.mu.Lock()
	after := string(fixture.Files[file])
	fixture.mu.Unlock()
	decode := func(data string) map[string]any {
		t.Helper()
		decoder := json.NewDecoder(strings.NewReader(data))
		decoder.UseNumber()
		var value map[string]any
		if err := decoder.Decode(&value); err != nil {
			t.Fatal(err)
		}
		return value
	}
	want := decode(original)
	want["name"], want["autosave_interval"] = "Updated", json.Number("7")
	want["visibility"].(map[string]any)["lan"] = false
	// The shared JSON editor formats explicit edits. Native values and numeric
	// precision must still survive unchanged outside the requested fields.
	if !reflect.DeepEqual(decode(after), want) {
		t.Fatal("Typed edit changed native credentials, numeric precision or unknown values")
	}
	infraExpect(t, mux, admin, "PUT", route, M{"revision": view["revision"], "settings": M{"/name": "Stale"}}, 409)
	for _, path := range []string{"/data/map-gen-settings.json", "/data/map-settings.json"} {
		other := asMap(infraExpect(t, mux, admin, "GET", route+"?file="+path, nil, 200)["attributes"])
		if other["file"] != path || len(asSlice(other["fields"])) == 0 {
			t.Fatal("Declared native map configuration is unavailable", path)
		}
	}
	if _, err := a.update(context.Background(), "eggs", num(server["egg_id"]), M{"startup": "exec bash .voltra/factorio-start.sh"}); err != nil {
		t.Fatal(err)
	}
	fixture.mu.Lock()
	writes := fixture.Writes
	fixture.mu.Unlock()
	infraExpect(t, mux, admin, "GET", route+"?file="+file, nil, 404)
	infraExpect(t, mux, admin, "GET", route, nil, 404)
	fixture.mu.Lock()
	defer fixture.mu.Unlock()
	if fixture.Writes != writes {
		t.Fatal("Old overwriting launcher discovery changed native bytes")
	}
}

func TestCraftopiaDefaultDocumentIsActiveNativeFile(t *testing.T) {
	a, mux, admin, server, fixture := quickSetupMinecraftFixture(t)
	egg := batchSettingsRecipeFixture(t, "craftopia/egg-craftopia.json")
	if _, err := a.update(context.Background(), "eggs", num(server["egg_id"]), egg); err != nil {
		t.Fatal(err)
	}
	fixture.mu.Lock()
	delete(fixture.Files, "/server.properties")
	fixture.Files["/DefaultServerSetting.ini"] = []byte("[World]\nName=Publisher example\n")
	fixture.Files["/ServerSetting.ini"], fixture.State = []byte("[World]\r\nName=Operator world\r\n"), "offline"
	fixture.mu.Unlock()
	route := "/api/client/servers/" + str(server["uuid_short"]) + "/game-settings"
	view := asMap(infraExpect(t, mux, admin, "GET", route, nil, 200)["attributes"])
	if view["file"] != "/ServerSetting.ini" || len(asSlice(view["documents"])) != 1 {
		t.Fatal("Publisher defaults shadowed the active native configuration", view["file"])
	}
	infraExpect(t, mux, admin, "GET", route+"?file=/DefaultServerSetting.ini", nil, 404)
	infraExpect(t, mux, admin, "PUT", route+"?file=/DefaultServerSetting.ini", M{"revision": view["revision"], "settings": M{"World/Name": "Wrong file"}}, 404)
	fixture.mu.Lock()
	delete(fixture.Files, "/ServerSetting.ini")
	fixture.mu.Unlock()
	missing := asMap(infraExpect(t, mux, admin, "GET", route, nil, 200)["attributes"])
	if missing["file"] != "" || len(asSlice(missing["fields"])) != 0 {
		t.Fatal("Missing native file fell back to editable publisher defaults")
	}
}
