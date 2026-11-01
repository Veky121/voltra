package panel

import (
	"encoding/json"
	"strings"
	"testing"
)

func vintageStoryTestEgg(t *testing.T) M {
	t.Helper()
	for _, entry := range gameTemplates().Entries {
		if entry.Path == vintageStorySettingsRecipe {
			return M{"uuid": gameTemplateEggUUID(entry)}
		}
	}
	t.Fatal("missing Vintage Story recipe")
	return nil
}

func vintageStoryTestField(t *testing.T, parsed gameSettingsParsed, key string) gameSetting {
	t.Helper()
	for _, field := range parsed.fields {
		if field.key == key {
			return field
		}
	}
	t.Fatalf("missing field %s", key)
	return gameSetting{}
}

func TestVintageNullableTextPresentationAndPatch(t *testing.T) {
	data := []byte(`{"Password":null,"ServerDescription":null,"ServerUrl":null,"UnknownNull":null,"Large":9007199254740993,"Opaque":{"value":"retain"}}`)
	parsed, err := parseGameSettings(vintageStorySettingsPath, data)
	if err != nil {
		t.Fatal(err)
	}
	parsed = vintageStoryNullableSettings(vintageStoryTestEgg(t), vintageStorySettingsPath, parsed)
	for _, key := range []string{"/Password", "/ServerDescription", "/ServerUrl"} {
		field := vintageStoryTestField(t, parsed, key)
		if field.value != "" || field.kind != "text" || field.node.Tag != "!!null" {
			t.Fatal("true nullable string not normalized without changing node")
		}
	}
	password := vintageStoryTestField(t, parsed, "/Password")
	if !password.secret || password.value != "" {
		t.Fatal("unset password must remain masked and unconfigured")
	}
	if vintageStoryTestField(t, parsed, "/UnknownNull").value != "null" {
		t.Fatal("unknown null changed")
	}
	changes, err := gameSettingsChanges(parsed.fields, M{"/Password": "fixture-secret", "/ServerDescription": "Literal $name", "/ServerUrl": "https://example.invalid/"}, vintageStoryTestEgg(t), vintageStorySettingsPath)
	if err != nil {
		t.Fatal(err)
	}
	updated, err := parsed.patch(changes)
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
	parsed, err = parseGameSettings(vintageStorySettingsPath, updated)
	if err != nil {
		t.Fatal(err)
	}
	parsed = vintageStoryNullableSettings(vintageStoryTestEgg(t), vintageStorySettingsPath, parsed)
	password = vintageStoryTestField(t, parsed, "/Password")
	if !(password.secret || gameSettingSecret.MatchString(password.key)) || password.value == "" {
		t.Fatal("configured password masking state lost")
	}
	cleared, err := parsed.patch(map[string]string{"/Password": ""})
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(cleared, &result); err != nil || string(result["Password"]) != `""` {
		t.Fatal("explicit password clear did not delegate string patch")
	}
}

func TestVintageNullableKeepsNonNullAndNestedValues(t *testing.T) {
	data := []byte(`{"Password":"null","ServerDescription":123,"ServerUrl":false,"Nested":{"Password":null}}`)
	parsed, err := parseGameSettings(vintageStorySettingsPath, data)
	if err != nil {
		t.Fatal(err)
	}
	parsed = vintageStoryNullableSettings(vintageStoryTestEgg(t), vintageStorySettingsPath, parsed)
	for key, expected := range map[string]string{"/Password": "null", "/ServerDescription": "123", "/ServerUrl": "false", "/Nested/Password": "null"} {
		if vintageStoryTestField(t, parsed, key).value != expected {
			t.Fatalf("non-null/unknown value changed: %s", key)
		}
	}
}

func TestVintageNullableExactRecipeAndPath(t *testing.T) {
	for _, tc := range []struct {
		egg  M
		file string
	}{{M{}, vintageStorySettingsPath}, {vintageStoryTestEgg(t), "/other/serverconfig.json"}, {vintageStoryTestEgg(t), "/data/ServerConfig.json"}} {
		parsed, err := parseGameSettings(vintageStorySettingsPath, []byte(`{"ServerDescription":null}`))
		if err != nil {
			t.Fatal(err)
		}
		parsed = vintageStoryNullableSettings(tc.egg, tc.file, parsed)
		if vintageStoryTestField(t, parsed, "/ServerDescription").value != "null" {
			t.Fatal("nullable normalization leaked to another document/recipe")
		}
	}
}
