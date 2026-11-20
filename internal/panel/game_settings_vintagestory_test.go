package panel

import (
	"encoding/json"
	"strings"
	"testing"
	"voltra/internal/gamesettings"
)

func vintageStoryTestEgg(t *testing.T) M {
	t.Helper()
	for _, entry := range gameTemplates().Entries {
		if entry.Path == gamesettings.VintageStorySettingsRecipe {
			return M{"uuid": gameTemplateEggUUID(entry)}
		}
	}
	t.Fatal("missing Vintage Story recipe")
	return nil
}

func vintageStoryTestField(t *testing.T, parsed gamesettings.Parsed, key string) gamesettings.Setting {
	t.Helper()
	for _, field := range parsed.Fields {
		if field.Key == key {
			return field
		}
	}
	t.Fatalf("missing field %s", key)
	return gamesettings.Setting{}
}

func TestVintageNullableTextPresentationAndPatch(t *testing.T) {
	data := []byte(`{"Password":null,"ServerDescription":null,"ServerUrl":null,"UnknownNull":null,"Large":9007199254740993,"Opaque":{"value":"retain"}}`)
	parsed, err := gamesettings.Parse(gamesettings.VintageStorySettingsPath, data)
	if err != nil {
		t.Fatal(err)
	}
	parsed = gamesettings.VintageStoryNullableSettings(vintageStoryTestEgg(t), gamesettings.VintageStorySettingsPath, parsed)
	for _, key := range []string{"/Password", "/ServerDescription", "/ServerUrl"} {
		field := vintageStoryTestField(t, parsed, key)
		if field.Value != "" || field.Kind != "text" || field.Node.Tag != "!!null" {
			t.Fatal("true nullable string not normalized without changing node")
		}
	}
	password := vintageStoryTestField(t, parsed, "/Password")
	if !password.Secret || password.Value != "" {
		t.Fatal("unset password must remain masked and unconfigured")
	}
	if vintageStoryTestField(t, parsed, "/UnknownNull").Value != "null" {
		t.Fatal("unknown null changed")
	}
	changes, err := gamesettings.Changes(parsed.Fields, M{"/Password": "fixture-secret", "/ServerDescription": "Literal $name", "/ServerUrl": "https://example.invalid/"}, vintageStoryTestEgg(t), gamesettings.VintageStorySettingsPath)
	if err != nil {
		t.Fatal(err)
	}
	updated, err := parsed.Patch(changes)
	if err != nil {
		t.Fatal(err)
	}
	var result map[string]json.RawMessage
	if err := json.Unmarshal(updated, &result); err != nil {
		t.Fatal(err)
	}
	if string(result["Password"]) != `"fixture-secret"` || string(result["Large"]) != "9007199254740993" || string(result["UnknownNull"]) != "null" || !strings.Contains(string(result["Opaque"]), "retain") {
		t.Fatal("shared patch lost string/unknown/precision semantics")
	}
	parsed, err = gamesettings.Parse(gamesettings.VintageStorySettingsPath, updated)
	if err != nil {
		t.Fatal(err)
	}
	parsed = gamesettings.VintageStoryNullableSettings(vintageStoryTestEgg(t), gamesettings.VintageStorySettingsPath, parsed)
	password = vintageStoryTestField(t, parsed, "/Password")
	if !(password.Secret || gamesettings.SettingSecret.MatchString(password.Key)) || password.Value == "" {
		t.Fatal("configured password masking state lost")
	}
	cleared, err := parsed.Patch(map[string]string{"/Password": ""})
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(cleared, &result); err != nil || string(result["Password"]) != `""` {
		t.Fatal("explicit password clear did not delegate string patch")
	}
}

func TestVintageNullableKeepsNonNullAndNestedValues(t *testing.T) {
	data := []byte(`{"Password":"null","ServerDescription":123,"ServerUrl":false,"Nested":{"Password":null}}`)
	parsed, err := gamesettings.Parse(gamesettings.VintageStorySettingsPath, data)
	if err != nil {
		t.Fatal(err)
	}
	parsed = gamesettings.VintageStoryNullableSettings(vintageStoryTestEgg(t), gamesettings.VintageStorySettingsPath, parsed)
	for key, expected := range map[string]string{"/Password": "null", "/ServerDescription": "123", "/ServerUrl": "false", "/Nested/Password": "null"} {
		if vintageStoryTestField(t, parsed, key).Value != expected {
			t.Fatalf("non-null/unknown value changed: %s", key)
		}
	}
}

func TestVintageNullableExactRecipeAndPath(t *testing.T) {
	for _, tc := range []struct {
		egg  M
		file string
	}{{M{}, gamesettings.VintageStorySettingsPath}, {vintageStoryTestEgg(t), "/other/serverconfig.json"}, {vintageStoryTestEgg(t), "/data/ServerConfig.json"}} {
		parsed, err := gamesettings.Parse(gamesettings.VintageStorySettingsPath, []byte(`{"ServerDescription":null}`))
		if err != nil {
			t.Fatal(err)
		}
		parsed = gamesettings.VintageStoryNullableSettings(tc.egg, tc.file, parsed)
		if vintageStoryTestField(t, parsed, "/ServerDescription").Value != "null" {
			t.Fatal("nullable normalization leaked to another document/recipe")
		}
	}
}
