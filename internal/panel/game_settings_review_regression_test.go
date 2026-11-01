package panel

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestSettingsReviewManagedPaths(t *testing.T) {
	egg := M{"config_files": M{"Game/Saved/Config/LinuxServer/Game.ini": M{"find": M{"ServerSettings.ServerName": "{{server.build.name}}"}}}}
	for _, key := range []string{"ServerSettings/ServerName", "ServerSettings/servername", "serversettings/ServerName"} {
		if !gameSettingManaged(egg, "/Game/Saved/Config/LinuxServer/Game.ini", key) {
			t.Fatalf("managed key became editable: %s", key)
		}
	}
	caseSensitive := M{"config_files": M{"settings.toml": M{"find": M{"World.Name": "{{server.build.name}}"}}}}
	if gameSettingManaged(caseSensitive, "/settings.toml", "World/name") {
		t.Fatal("TOML must remain case sensitive")
	}
}

func TestSettingsReviewTupleCaseAliases(t *testing.T) {
	parsed, err := parseGameSettings("/Game/Saved/Config/LinuxServer/Game.ini", []byte("[/Script/Test.World]\nOptions=(Rate=1,rate=2)\n"))
	if err != nil {
		t.Fatal(err)
	}
	for _, field := range parsed.fields {
		if field.kind != "readonly" {
			t.Fatalf("case alias remains editable: %s", field.key)
		}
		if _, err = parsed.patch(map[string]string{field.key: "3"}); err == nil {
			t.Fatal("direct patch accepted alias")
		}
	}
	for _, data := range []string{
		"[/Script/Pal.PalGameWorldSettings]\nOptionSettings=(ExpRate=1,exprate=2)\n",
		"[/Script/Pal.PalGameWorldSettings]\nOptionSettings=(ExpRate=1)\noptionsettings=(ExpRate=2)\n",
		"[/Script/Pal.PalGameWorldSettings]\nOptionSettings=(ExpRate=1)\n[/script/pal.palgameworldsettings]\nOptionSettings=(ExpRate=2)\n",
	} {
		if _, err = parseGameSettings("/PalWorldSettings.ini", []byte(data)); err == nil {
			t.Fatal("ambiguous Palworld tuple accepted")
		}
	}
}

func TestSettingsReviewNestedSecretsAPI(t *testing.T) {
	_, mux, admin, server, f := quickSetupMinecraftFixture(t)
	f.mu.Lock()
	f.Files["/server.ini"] = []byte("[World]\nOptions=(Unknown=(Password=\"nested-secret-sentinel\"),Enabled=True)\n")
	f.Files["/server.json"] = []byte(`{"players":[{"password":"nested-secret-sentinel"}],"enabled":true}`)
	f.mu.Unlock()
	base := "/api/client/servers/" + str(server["uuid_short"]) + "/game-settings?file="
	for _, file := range []string{"%2Fserver.ini", "%2Fserver.json"} {
		view := infraExpect(t, mux, admin, "GET", base+file, nil, 200)
		encoded, _ := json.Marshal(view)
		if strings.Contains(string(encoded), "nested-secret-sentinel") {
			t.Fatalf("nested secret exposed in %s", file)
		}
	}
}
