package panel

import (
	"bytes"
	"strings"
	"testing"
)

func ss14TestEgg(t *testing.T) M {
	t.Helper()
	for _, entry := range gameTemplates().Entries {
		if entry.Path == ss14SettingsRecipe {
			return M{"uuid": gameTemplateEggUUID(entry)}
		}
	}
	t.Fatal("missing SS14 recipe")
	return nil
}

func TestSS14ScalarSafetyRejectsBeforeUnderlyingPatch(t *testing.T) {
	egg := ss14TestEgg(t)
	for _, tc := range []struct{ key, value string }{
		{"game/hostname", strings.Repeat("界", 49)}, {"game/hostname", "name\ncommand"},
		{"game/hostname", "name\u0085control"}, {"game/hostname", string([]byte{0xff})},
		{"game/soft_max_players", "0"}, {"game/soft_max_players", "257"},
		{"net/max_connections", "-1"}, {"net/max_connections", "1.0"}, {"net/max_connections", "1e1"},
		{"net/max_connections", "NaN"}, {"net/max_connections", "01"}, {"net/max_connections", "+1"},
		{"net/max_connections", "99999999999999999999999999"}, {"net/tickrate", "81"}, {"net/tickrate", " 30"},
	} {
		t.Run(tc.key+"/"+tc.value, func(t *testing.T) {
			called := false
			parsed := gameSettingsParsed{patch: func(map[string]string) ([]byte, error) { called = true; return nil, nil }}
			parsed = ss14GameSettingsSafety(egg, ss14SettingsPath, parsed)
			if _, err := parsed.patch(map[string]string{tc.key: tc.value}); err == nil || called {
				t.Fatal("invalid scalar reached underlying editor")
			}
		})
	}
}

func TestSS14ScalarSafetyPreservesUnknownNativeBytes(t *testing.T) {
	original := []byte("# operator\r\n[game]\r\nhostname = \"before\" # retained\r\nsoft_max_players=8\r\n[net]\r\ntickrate=30\r\nmax_connections=8\r\n[private]\r\nopaque = 'operator bytes' # unknown\r\n")
	parsed, err := parseGameSettings(ss14SettingsPath, original)
	if err != nil {
		t.Fatal(err)
	}
	parsed = ss14GameSettingsSafety(ss14TestEgg(t), ss14SettingsPath, parsed)
	name := strings.Repeat("界", 48)
	updated, err := parsed.patch(map[string]string{"game/hostname": name, "game/soft_max_players": "256", "net/max_connections": "1", "net/tickrate": "80"})
	if err != nil {
		t.Fatal(err)
	}
	expected := strings.Replace(string(original), "\"before\"", "\""+name+"\"", 1)
	expected = strings.Replace(expected, "soft_max_players=8", "soft_max_players=256", 1)
	expected = strings.Replace(expected, "tickrate=30", "tickrate=80", 1)
	expected = strings.Replace(expected, "max_connections=8", "max_connections=1", 1)
	if !bytes.Equal(updated, []byte(expected)) {
		t.Fatal("native unknowns/comments/order/newlines changed")
	}
}

func TestSS14ScalarSafetyExactRecipeAndPath(t *testing.T) {
	for _, tc := range []struct {
		egg  M
		file string
	}{
		{M{}, ss14SettingsPath}, {ss14TestEgg(t), "/other/server_config.toml"}, {ss14TestEgg(t), "/ss14/server_config.TOML"},
	} {
		called := false
		parsed := gameSettingsParsed{patch: func(map[string]string) ([]byte, error) { called = true; return nil, nil }}
		parsed = ss14GameSettingsSafety(tc.egg, tc.file, parsed)
		if _, err := parsed.patch(map[string]string{"net/tickrate": "0"}); err != nil || !called {
			t.Fatal("SS14 restriction leaked outside exact recipe/path")
		}
	}
	if parsed := ss14GameSettingsSafety(ss14TestEgg(t), ss14SettingsPath, gameSettingsParsed{}); parsed.patch != nil {
		t.Fatal("nil patch changed")
	}
}
