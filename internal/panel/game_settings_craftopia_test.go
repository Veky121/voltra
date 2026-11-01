package panel

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"strings"
	"testing"
)

func TestCraftopiaIntegratedSettingsAPI(t *testing.T) {
	a, mux, admin, server, f := quickSetupMinecraftFixture(t)
	ctx := context.Background()
	egg := craftopiaSettingsFixtureEgg(t)
	if _, err := a.update(ctx, "eggs", num(server["egg_id"]), M{"uuid": egg["uuid"], "startup": egg["startup"], "config_files": M{}}); err != nil {
		t.Fatal(err)
	}
	original := ";keep\r\n[GameWorld]\r\nname=Startup world\r\ndifficulty=2\r\n[Host]\r\nport=29140\r\nusePassword=1 ;switch\r\nserverPassword=01234567\r\n[Save]\r\nsavePath=DedicatedServerSave/\r\n[Unknown]\r\nRows=one\r\nRows=two\r\n"
	f.mu.Lock()
	delete(f.Files, "/server.properties")
	f.Files[craftopiaSettingsPath], f.State = []byte(original), "offline"
	f.mu.Unlock()
	endpoint := "/api/client/servers/" + str(server["uuid_short"]) + "/game-settings?file=%2FServerSetting.ini"
	view := asMap(infraExpect(t, mux, admin, "GET", endpoint, nil, 200)["attributes"])
	flag := laneGameSettingsField(view, "Host/usePassword")
	if flag["type"] != "boolean" || flag["value"] != true || boolean(flag["secret"]) || boolean(flag["readonly"]) {
		t.Fatal("public native switch was masked or mistyped")
	}
	encoded, _ := json.Marshal(view)
	if strings.Contains(string(encoded), "01234567") || !boolean(laneGameSettingsField(view, "Host/serverPassword")["secret"]) {
		t.Fatal("native server PIN was exposed")
	}
	for _, key := range []string{"GameWorld/name", "Host/port", "Save/savePath"} {
		if !boolean(laneGameSettingsField(view, key)["readonly"]) {
			t.Fatalf("runtime-managed native key is writable: %s", key)
		}
		infraExpect(t, mux, admin, "PUT", endpoint, M{"revision": view["revision"], "settings": M{key: "unsafe"}}, 422)
	}
	f.mu.Lock()
	f.State = "running"
	f.mu.Unlock()
	infraExpect(t, mux, admin, "PUT", endpoint, M{"revision": view["revision"], "settings": M{"Host/usePassword": false}}, 409)
	f.mu.Lock()
	f.State = "offline"
	f.Files[craftopiaSettingsPath] = []byte(original + ";external\r\n")
	f.mu.Unlock()
	infraExpect(t, mux, admin, "PUT", endpoint, M{"revision": view["revision"], "settings": M{"Host/usePassword": false}}, 409)
	view = asMap(infraExpect(t, mux, admin, "GET", endpoint, nil, 200)["attributes"])
	infraExpect(t, mux, admin, "PUT", endpoint, M{"revision": view["revision"], "settings": M{"Host/usePassword": false}}, 200)
	f.mu.Lock()
	updated := string(f.Files[craftopiaSettingsPath])
	f.mu.Unlock()
	if updated != strings.Replace(original+";external\r\n", "usePassword=1", "usePassword=0", 1) {
		t.Fatal("typed switch edit changed unrelated INI bytes")
	}
	reader, err := a.insert(ctx, "users", M{"uuid": newUUID(), "username": "craftopia-settings-reader", "email": "craftopia-reader@example.invalid"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = a.insert(ctx, "subusers", M{"user_id": reader["id"], "server_id": server["id"], "permissions": []string{"file.read-content"}}); err != nil {
		t.Fatal(err)
	}
	readOnly := asMap(infraExpect(t, mux, num(reader["id"]), "GET", endpoint, nil, 200)["attributes"])
	infraExpect(t, mux, num(reader["id"]), "PUT", endpoint, M{"revision": readOnly["revision"], "settings": M{"Host/usePassword": true}}, 403)
}

func craftopiaSettingsFixtureEgg(t *testing.T) M {
	t.Helper()
	for _, entry := range gameTemplates().Entries {
		if entry.Path == "craftopia/egg-craftopia.json" {
			return M{"uuid": gameTemplateEggUUID(entry), "startup": entry.Egg["startup"]}
		}
	}
	t.Fatal("Craftopia recipe missing")
	return nil
}

func TestCraftopiaTypedBitsShippedDocument(t *testing.T) {
	data, err := os.ReadFile("game_library/scripts/craftopia-original-server.ini")
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := parseGameSettings(craftopiaSettingsPath, data)
	if err != nil {
		t.Fatal(err)
	}
	parsed = craftopiaSettingsFields(craftopiaSettingsFixtureEgg(t), craftopiaSettingsPath, data, parsed)
	bits := 0
	for _, field := range parsed.fields {
		if craftopiaSettingBits[field.key] {
			bits++
			if field.kind != "boolean" || field.on != "1" || field.off != "0" {
				t.Fatalf("publisher bit remains untyped: %+v", field)
			}
		}
		if field.key == "Host/serverPassword" && (field.kind != "text" || field.value != "00000000") {
			t.Fatal("native PIN leading zeros were changed")
		}
		if field.key == "GameWorld/difficulty" && field.kind != "number" {
			t.Fatal("numeric game mode became a switch")
		}
	}
	if bits != len(craftopiaSettingBits) {
		t.Fatal("source-backed publisher bit schema drift")
	}
}

func TestCraftopiaBitRoundTripPreservesNativeBytes(t *testing.T) {
	egg := craftopiaSettingsFixtureEgg(t)
	data := []byte("\ufeff;keep\r\n[Host]\r\n  usePassword = 1 ;retain\r\nserverPassword=01234567\r\n[CreativeModeSetting]\r\nnoDamage=0\r\n[Unknown]\r\nRows=one\r\nRows=two\r\n")
	parsed, err := parseGameSettings(craftopiaSettingsPath, data)
	if err != nil {
		t.Fatal(err)
	}
	parsed = craftopiaSettingsFields(egg, craftopiaSettingsPath, data, parsed)
	changes, err := gameSettingsChanges(parsed.fields, M{"Host/usePassword": false, "CreativeModeSetting/noDamage": true}, egg, craftopiaSettingsPath)
	if err != nil || changes["Host/usePassword"] != "0" || changes["CreativeModeSetting/noDamage"] != "1" {
		t.Fatalf("typed switch serialization failed: %v %v", changes, err)
	}
	updated, err := parsed.patch(changes)
	if err != nil {
		t.Fatal(err)
	}
	want := bytes.Replace(data, []byte("usePassword = 1"), []byte("usePassword = 0"), 1)
	want = bytes.Replace(want, []byte("noDamage=0"), []byte("noDamage=1"), 1)
	if !bytes.Equal(updated, want) {
		t.Fatalf("unrelated INI bytes changed: %q", updated)
	}
	if _, err = parsed.patch(map[string]string{"Host/usePassword": "true"}); err == nil {
		t.Fatal("non-bit direct patch accepted")
	}
	if _, err = parsed.patch(map[string]string{"Host/UsePassword": "0"}); err == nil {
		t.Fatal("unlisted bit case alias accepted a direct patch")
	}
}

func TestCraftopiaUnsupportedBitsRemainReadonly(t *testing.T) {
	for _, value := range []string{"2", "00", "01", "-1", "true", "True", `"1"`, "'0'", "unexpected"} {
		t.Run(value, func(t *testing.T) {
			data := []byte("[Host]\nusePassword=" + value + "\n")
			parsed, err := parseGameSettings(craftopiaSettingsPath, data)
			if err != nil {
				t.Fatal(err)
			}
			parsed = craftopiaSettingsFields(craftopiaSettingsFixtureEgg(t), craftopiaSettingsPath, data, parsed)
			if len(parsed.fields) != 1 || parsed.fields[0].kind != "readonly" {
				t.Fatal("unsupported native bit was silently coerced")
			}
			if _, err = parsed.patch(map[string]string{"Host/usePassword": "0"}); err == nil {
				t.Fatal("unsupported native bit accepted a direct edit")
			}
		})
	}
	for _, content := range []string{"usePassword=0\nusePassword=1", "usePassword=0\nUsePassword=1", "UsePassword=1", "usePassword=0\n[host]\nusePassword=1"} {
		data := []byte("[Host]\n" + content + "\n")
		parsed, err := parseGameSettings(craftopiaSettingsPath, data)
		if err != nil {
			t.Fatal(err)
		}
		parsed = craftopiaSettingsFields(craftopiaSettingsFixtureEgg(t), craftopiaSettingsPath, data, parsed)
		for _, field := range parsed.fields {
			if field.kind != "readonly" {
				t.Fatal("ambiguous native bit became writable")
			}
			if _, err = parsed.patch(map[string]string{field.key: "0"}); err == nil {
				t.Fatal("ambiguous native bit accepted a direct edit")
			}
		}
	}
}

func TestCraftopiaCredentialNameBoundary(t *testing.T) {
	egg := craftopiaSettingsFixtureEgg(t)
	if !craftopiaSettingsBit(egg, craftopiaSettingsPath, "Host/usePassword") {
		t.Fatal("known public boolean is missing its secret-name exemption")
	}
	for _, key := range []string{"Host/serverPassword", "Host/ServerPassword", "Unrelated/usePassword", "Host/UsePassword"} {
		if craftopiaSettingsBit(egg, craftopiaSettingsPath, key) {
			t.Fatal("credential or unproven alias gained public-flag authority")
		}
	}
	if craftopiaSettingsBit(M{"name": "Craftopia"}, craftopiaSettingsPath, "Host/usePassword") || craftopiaSettingsBit(egg, "/Other.ini", "Host/usePassword") {
		t.Fatal("public flag exemption escaped the recipe/document boundary")
	}
}

func TestCraftopiaBitsStayRecipeAndPathScoped(t *testing.T) {
	for _, test := range []struct {
		egg  M
		file string
	}{{M{"name": "Craftopia"}, craftopiaSettingsPath}, {craftopiaSettingsFixtureEgg(t), "/Other.ini"}} {
		data := []byte("[Host]\nusePassword=0\n")
		parsed, err := parseGameSettings(test.file, data)
		if err != nil {
			t.Fatal(err)
		}
		kind := parsed.fields[0].kind
		parsed = craftopiaSettingsFields(test.egg, test.file, data, parsed)
		if parsed.fields[0].kind != kind {
			t.Fatal("display name or unrelated document gained native type authority")
		}
		out, err := parsed.patch(map[string]string{"Host/usePassword": "2"})
		if err != nil || !strings.Contains(string(out), "usePassword=2") {
			t.Fatal("recipe-specific patch rule escaped scope")
		}
	}
}
