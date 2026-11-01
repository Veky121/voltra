package panel

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func batchSettingsRecipeFixture(t *testing.T, recipe string) M {
	t.Helper()
	for _, entry := range gameTemplates().Entries {
		if entry.Path == recipe {
			return M{"uuid": gameTemplateEggUUID(entry), "startup": entry.Egg["startup"], "config_files": M{}}
		}
	}
	t.Fatal("Missing reviewed recipe", recipe)
	return nil
}

func TestEmpyrionScopedSecretManagedOverlay(t *testing.T) {
	egg := batchSettingsRecipeFixture(t, empyrionSettingsRecipe)
	input := []byte("ServerConfig:\n  Tel_Pwd: fixture-private-admin\n  Srv_Port: 30000\n  Tel_Port: 39000\n  Tel_Enabled: true\n  Srv_Password: fixture-private-player\nGameConfig:\n  Seed: 123\n")
	parsed, err := parseGameSettingsForEgg(egg, empyrionSettingsPath, input)
	if err != nil {
		t.Fatal(err)
	}
	for _, field := range parsed.fields {
		if field.key == "/ServerConfig/Tel_Pwd" && !field.secret {
			t.Fatal("Private console credential unclassified")
		}
	}
	for _, key := range []string{"/ServerConfig/Tel_Pwd", "/ServerConfig/Srv_Port", "/ServerConfig/Tel_Port", "/ServerConfig/Tel_Enabled", "/serverconfig/tel_pwd"} {
		if !empyrionSettingsManaged(egg, empyrionSettingsPath, key) {
			t.Fatal("Managed transport key editable", key)
		}
		if _, err := parsed.patch(map[string]string{key: "1"}); err == nil {
			t.Fatal("Direct patch bypassed runtime authority", key)
		}
	}
	if empyrionSettingsManaged(egg, empyrionSettingsPath, "/ServerConfig/Srv_Password") {
		t.Fatal("Operator gameplay password became runtime-owned")
	}
	for _, scope := range []struct {
		egg  M
		file string
	}{{M{"name": "Empyrion"}, empyrionSettingsPath}, {egg, "/other.yaml"}} {
		plain, err := parseGameSettings(scope.file, input)
		if err != nil {
			t.Fatal(err)
		}
		out := empyrionSettingsFields(scope.egg, scope.file, plain)
		for _, field := range out.fields {
			if field.key == "/ServerConfig/Tel_Pwd" && field.secret {
				t.Fatal("Secret overlay escaped exact scope")
			}
		}
	}
	for _, malformed := range []string{"ServerConfig: [{Tel_Pwd: fixture-private-admin}]", "ServerConfig: fixture-private-admin", "[{ServerConfig: {Tel_Pwd: fixture-private-admin}}]"} {
		p, err := parseGameSettingsForEgg(egg, empyrionSettingsPath, []byte(malformed))
		if err != nil {
			t.Fatal(err)
		}
		if len(p.fields) != 1 || !p.fields[0].secret || p.fields[0].kind != "readonly" {
			t.Fatal("Malformed parent exposed private or managed children")
		}
	}
}

func TestEmpyrionActualSettingsAPIPrivacy(t *testing.T) {
	a, mux, admin, server, fixture := quickSetupMinecraftFixture(t)
	egg := batchSettingsRecipeFixture(t, empyrionSettingsRecipe)
	if _, err := a.update(context.Background(), "eggs", num(server["egg_id"]), egg); err != nil {
		t.Fatal(err)
	}
	original := "# operator comment\nServerConfig:\n  Srv_Name: Operator\n  Srv_Port: 30000\n  Tel_Port: 39000\n  Tel_Enabled: true\n  Tel_Pwd: fixture-private-admin\n  Srv_Password: fixture-private-player\nGameConfig:\n  Seed: 123\nUnknown:\n  keep: retained\n"
	fixture.mu.Lock()
	delete(fixture.Files, "/server.properties")
	fixture.Files[empyrionSettingsPath], fixture.State = []byte(original), "offline"
	fixture.mu.Unlock()
	route := "/api/client/servers/" + str(server["uuid_short"]) + "/game-settings"
	view := asMap(infraExpect(t, mux, admin, "GET", route, nil, 200)["attributes"])
	if view["file"] != empyrionSettingsPath {
		t.Fatal("Native document declaration missing")
	}
	encoded, _ := json.Marshal(view)
	if strings.Contains(string(encoded), "fixture-private-") {
		t.Fatal("Native credential leaked through getter")
	}
	tel := laneGameSettingsField(view, "/ServerConfig/Tel_Pwd")
	if !boolean(tel["secret"]) || !boolean(tel["configured"]) || !boolean(tel["readonly"]) || tel["value"] != nil {
		t.Fatal("Private console metadata incorrect")
	}
	for _, key := range []string{"/ServerConfig/Tel_Pwd", "/ServerConfig/Srv_Port", "/ServerConfig/Tel_Port", "/ServerConfig/Tel_Enabled"} {
		value := any("1")
		if key == "/ServerConfig/Tel_Enabled" {
			value = false
		}
		infraExpect(t, mux, admin, "PUT", route, M{"revision": view["revision"], "settings": M{key: value}}, 422)
	}
	infraExpect(t, mux, admin, "PUT", route, M{"revision": view["revision"], "settings": M{"/GameConfig/Seed": "456", "/ServerConfig/Srv_Name": "Updated"}}, 200)
	fixture.mu.Lock()
	updated := string(fixture.Files[empyrionSettingsPath])
	fixture.mu.Unlock()
	for _, keep := range []string{"# operator comment", "fixture-private-admin", "fixture-private-player", "keep: retained"} {
		if !strings.Contains(updated, keep) {
			t.Fatal("Unrelated native YAML content lost", keep)
		}
	}
	if !strings.Contains(updated, "Seed: 456") || !strings.Contains(updated, "Srv_Name: Updated") {
		t.Fatal("Gameplay edit did not roundtrip")
	}
}
