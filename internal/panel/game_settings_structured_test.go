package panel

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestGameSettingsStructuredAPI(t *testing.T) {
	_, mux, admin, server, f := quickSetupMinecraftFixture(t)
	f.mu.Lock()
	f.Files["/server.ini"] = []byte("[World]\nOptions=(Name=\"Before\",Enabled=True,Password=\"private-structured-secret\",PublicPort=8211,Unknown=(A,B))\n")
	f.mu.Unlock()
	endpoint := "/api/client/servers/" + str(server["uuid_short"]) + "/game-settings?file=%2Fserver.ini"
	view := asMap(infraExpect(t, mux, admin, "GET", endpoint, nil, 200)["attributes"])
	raw, _ := json.Marshal(view)
	if strings.Contains(string(raw), "private-structured-secret") {
		t.Fatal("structured secret exposed")
	}
	fields := map[string]M{}
	for _, value := range asSlice(view["fields"]) {
		field := asMap(value)
		fields[str(field["key"])] = field
	}
	if len(fields) != 5 || str(fields["World/Options/Enabled"]["type"]) != "boolean" || !boolean(fields["World/Options/Password"]["configured"]) {
		t.Fatal("structured field metadata missing")
	}
	infraExpect(t, mux, admin, "PUT", endpoint, M{"revision": view["revision"], "settings": M{"World/Options/PublicPort": "9000"}}, 422)
	infraExpect(t, mux, admin, "PUT", endpoint, M{"revision": view["revision"], "settings": M{"World/Options/Enabled": false}}, 200)
	f.mu.Lock()
	content := string(f.Files["/server.ini"])
	f.mu.Unlock()
	if !strings.Contains(content, "Enabled=False") || !strings.Contains(content, "Password=\"private-structured-secret\"") || !strings.Contains(content, "Unknown=(A,B)") {
		t.Fatal("structured save changed untouched values")
	}
}

func TestGameSettingsStructuredINI(t *testing.T) {
	input := "; keep\r\n[World]\r\nOptions = ( Name = \"A, B; # C\",Enabled=True,Rate=0.5,Count=0,Password=\"private\",Unknown=(A,B)) ; trailing\r\nLiteral=\"(Name=plain)\"\r\n"
	parsed, err := parseGameSettings("/another-game.ini", []byte(input))
	if err != nil {
		t.Fatal(err)
	}
	fields := map[string]gameSetting{}
	for _, f := range parsed.fields {
		fields[f.key] = f
	}
	for key, kind := range map[string]string{"Name": "text", "Enabled": "boolean", "Rate": "number", "Count": "number", "Password": "text", "Unknown": "readonly"} {
		if fields["World/Options/"+key].kind != kind {
			t.Fatalf("%s: %#v", key, fields)
		}
	}
	if fields["World/Literal"].value != "(Name=plain)" {
		t.Fatal("expanded quoted literal")
	}
	changes, err := gameSettingsChanges(parsed.fields, M{"World/Options/Name": "New, \"quoted\"; # value", "World/Options/Enabled": false, "World/Options/Count": "2"}, M{}, "/another-game.ini")
	if err != nil {
		t.Fatal(err)
	}
	updated, err := parsed.patch(changes)
	if err != nil {
		t.Fatal(err)
	}
	for _, keep := range []string{"; keep\r\n", "Unknown=(A,B)", "Password=\"private\"", " ; trailing\r\n", "Rate=0.5", "Literal=\"(Name=plain)\""} {
		if !strings.Contains(string(updated), keep) {
			t.Fatalf("lost %q", keep)
		}
	}
	next, err := parseGameSettings("/another-game.ini", updated)
	if err != nil {
		t.Fatal(err)
	}
	for _, f := range next.fields {
		if f.key == "World/Options/Name" && f.value != "New, \"quoted\"; # value" {
			t.Fatalf("quoting: %q", f.value)
		}
		if f.key == "World/Options/Enabled" && f.value != "False" {
			t.Fatal("boolean representation changed")
		}
	}
	if _, err := gameSettingsChanges(parsed.fields, M{"World/Options/Unknown": "replace"}, M{}, "/another-game.ini"); err == nil {
		t.Fatal("complex value editable")
	}
	if !gameSettingManaged(M{}, "/another-game.ini", "World/Options/PublicPort") {
		t.Fatal("nested managed listener editable")
	}
	if _, err := parsed.patch(map[string]string{"World/Options/Rate": "1,Injected=True"}); err == nil {
		t.Fatal("tuple injection accepted")
	}
}

func TestGameSettingsPalworldDocumentNames(t *testing.T) {
	for _, file := range []string{"/PalWorldSettings.ini", "/palworldsettings.ini", "/DefaultPalWorldSettings.ini"} {
		parsed, err := parseGameSettings(file, []byte("[/Script/Pal.PalGameWorldSettings]\nOptionSettings=(ServerName=\"test\",ExpRate=1.0,bEnableFastTravel=True)\n"))
		if err != nil {
			t.Fatal(err)
		}
		if len(parsed.fields) != 3 || parsed.fields[0].key == "/Script/Pal.PalGameWorldSettings/OptionSettings" {
			t.Fatal("packed options were not expanded")
		}
	}
	for _, input := range []string{"[World]\nOptions=(A=1,A=2)\n", "[/Script/Pal.PalGameWorldSettings]\nOptionSettings=(A=1,A=2)\n"} {
		if _, err := parseGameSettings("/server.ini", []byte(input)); err == nil {
			t.Fatal("duplicate member accepted")
		}
	}
}
