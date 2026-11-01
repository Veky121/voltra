package panel

import (
	"bytes"
	"strings"
	"testing"
)

func cuberiteBooleanTestEgg(t *testing.T) M {
	t.Helper()
	for _, entry := range gameTemplates().Entries {
		if entry.Path == "minecraft/java/cuberite/egg-cuberite.json" {
			return M{"uuid": gameTemplateEggUUID(entry)}
		}
	}
	t.Fatal("missing Cuberite recipe")
	return nil
}

func TestCuberiteBooleanOverlayRoundTrip(t *testing.T) {
	egg := cuberiteBooleanTestEgg(t)
	data := []byte("; operator comment\r\n[Plugins]\r\nCore=1 ; retain\r\nChatLog=0\r\nUnknown=1\r\n[Server]\r\nPorts=29108\r\nAllowMultiLogin=0\r\n")
	base, err := parseGameSettings("/settings.ini", data)
	if err != nil {
		t.Fatal(err)
	}
	parsed := cuberiteGameSettingsBooleans(egg, "/settings.ini", base)
	for _, f := range base.fields {
		if f.key == "Plugins/Core" && f.kind != "number" {
			t.Fatal("mutated original fields")
		}
	}
	changes, err := gameSettingsChanges(parsed.fields, M{"Plugins/Core": false, "Plugins/ChatLog": true, "Server/AllowMultiLogin": true}, egg, "/settings.ini")
	if err != nil {
		t.Fatal(err)
	}
	updated, err := parsed.patch(changes)
	if err != nil {
		t.Fatal(err)
	}
	want := strings.ReplaceAll(string(data), "Core=1 ; retain", "Core=0 ; retain")
	want = strings.ReplaceAll(want, "ChatLog=0", "ChatLog=1")
	want = strings.ReplaceAll(want, "AllowMultiLogin=0", "AllowMultiLogin=1")
	if !bytes.Equal(updated, []byte(want)) {
		t.Fatalf("unrelated bytes changed: %q", updated)
	}
	for _, f := range parsed.fields {
		if f.key == "Plugins/Unknown" && f.kind != "number" {
			t.Fatal("unknown flag coerced")
		}
	}
	if _, err := parsed.patch(map[string]string{"Plugins/Core": "true"}); err == nil {
		t.Fatal("non-native write accepted")
	}
	if _, err := gameSettingsChanges(parsed.fields, M{"Plugins/Core": "1"}, egg, "/settings.ini"); err == nil {
		t.Fatal("text API value accepted")
	}
}

func TestCuberiteBooleanOverlayRefusalsAndScope(t *testing.T) {
	egg := cuberiteBooleanTestEgg(t)
	for _, value := range []string{"2", "true", "false", "\"1\"", "'0'", "(A=1)", "1\nCore=0"} {
		t.Run(value, func(t *testing.T) {
			parsed, err := parseGameSettings("/settings.ini", []byte("[Plugins]\nCore="+value+"\n"))
			if err != nil {
				t.Fatal(err)
			}
			parsed = cuberiteGameSettingsBooleans(egg, "/settings.ini", parsed)
			for _, f := range parsed.fields {
				if f.key == "Plugins/Core" && f.kind != "readonly" {
					t.Fatalf("invalid flag editable: %+v", f)
				}
			}
			if _, err := parsed.patch(map[string]string{"Plugins/Core": "1"}); err == nil {
				t.Fatal("invalid flag patch accepted")
			}
		})
	}
	base, err := parseGameSettings("/settings.ini", []byte("[Plugins]\nCore=1\nChatLog=0\n"))
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		egg  M
		file string
	}{{M{"name": "Cuberite"}, "/settings.ini"}, {egg, "/webadmin.ini"}, {egg, "/other/settings.ini"}} {
		got := cuberiteGameSettingsBooleans(tc.egg, tc.file, base)
		for _, f := range got.fields {
			if f.kind != "number" {
				t.Fatal("overlay escaped authority")
			}
		}
	}
}

func TestCuberiteBooleanOverlayExactNativeKeys(t *testing.T) {
	egg := cuberiteBooleanTestEgg(t)
	for _, key := range []string{"AntiCheat/LimitPlayerBlockChanges", "Authentication/AllowBungeeCord", "Authentication/Authenticate", "Authentication/OnlyAllowBungeeCord", "Server/AllowMultiLogin", "Server/AllowMultiWorldTabCompletion", "Server/RequireResourcePack", "Plugins/Core", "Plugins/ChatLog"} {
		t.Run(key, func(t *testing.T) {
			section, name, _ := strings.Cut(key, "/")
			for _, value := range []string{"0", "1"} {
				parsed, err := parseGameSettings("/settings.ini", []byte("["+section+"]\n"+name+"="+value+"\n"))
				if err != nil {
					t.Fatal(err)
				}
				parsed = cuberiteGameSettingsBooleans(egg, "/settings.ini", parsed)
				if len(parsed.fields) != 1 || parsed.fields[0].kind != "boolean" || parsed.fields[0].on != "1" || parsed.fields[0].off != "0" {
					t.Fatal("native flag not boolean")
				}
			}
		})
	}
	data := []byte("[Plugins]\nCore=1\ncore=0\nUnknown=2\n")
	parsed, err := parseGameSettings("/settings.ini", data)
	if err != nil {
		t.Fatal(err)
	}
	parsed = cuberiteGameSettingsBooleans(egg, "/settings.ini", parsed)
	for _, f := range parsed.fields {
		if strings.EqualFold(f.key, "Plugins/Core") && f.kind != "readonly" {
			t.Fatal("case collision made editable")
		}
	}
	if _, err := parsed.patch(map[string]string{"Plugins/Core": "0"}); err == nil {
		t.Fatal("case collision patched")
	}
	updated, err := parsed.patch(map[string]string{"Plugins/Unknown": "3"})
	if err != nil || string(updated) != strings.Replace(string(data), "Unknown=2", "Unknown=3", 1) {
		t.Fatalf("unknown edit damaged native aliases: %q %v", updated, err)
	}
}
