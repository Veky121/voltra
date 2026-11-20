package panel

import (
	"bytes"
	"strings"
	"testing"
	"voltra/internal/gamesettings"
)

func TestSonsGameplayPreservesOpaqueBytes(t *testing.T) {
	input := []byte("\xef\xbb\xbf{\r\n\"ServerName\":\"operator\",\"Password\":\"private\",\"Unknown\":123456789012345678901234567890,\"GameSettings\":{\"Gameplay.TreeRegrowth\":true,\"Structure.Damage\":false,\"token\":\"private\",\"rows\":[true,false]},\"CustomGameModeSettings\":{\"GameSetting.Multiplayer.Cheats\":false}}\r\n")
	p, err := gamesettings.ParseSonsGameplaySettings(input)
	if err != nil {
		t.Fatal(err)
	}
	if len(p.Fields) != 3 {
		t.Fatal(p.Fields)
	}
	noop, err := p.Patch(nil)
	if err != nil || !bytes.Equal(input, noop) {
		t.Fatal("no-op", err)
	}
	changes := map[string]string{"/GameSettings/Gameplay.TreeRegrowth": "false", "/GameSettings/Structure.Damage": "true", "/CustomGameModeSettings/GameSetting.Multiplayer.Cheats": "true"}
	got, err := p.Patch(changes)
	if err != nil {
		t.Fatal(err)
	}
	want := strings.Replace(string(input), `"Gameplay.TreeRegrowth":true`, `"Gameplay.TreeRegrowth":false`, 1)
	want = strings.Replace(want, `"Structure.Damage":false`, `"Structure.Damage":true`, 1)
	want = strings.Replace(want, `"GameSetting.Multiplayer.Cheats":false`, `"GameSetting.Multiplayer.Cheats":true`, 1)
	if string(got) != want {
		t.Fatal("changed bytes beyond requested values")
	}
	// Root composition must reparse after base edits change byte offsets.
	base, err := gamesettings.ParseSonsSettings(input)
	if err != nil {
		t.Fatal(err)
	}
	if len(base.Fields) != 15 {
		t.Fatal("base controls changed")
	}
	staged, err := base.Patch(map[string]string{"/ServerName": "a much longer server name"})
	if err != nil {
		t.Fatal(err)
	}
	nested, err := gamesettings.ParseSonsGameplaySettings(staged)
	if err != nil {
		t.Fatal(err)
	}
	final, err := nested.Patch(changes)
	if err != nil {
		t.Fatal(err)
	}
	if string(final) != strings.Replace(want, `"ServerName":"operator"`, `"ServerName":"a much longer server name"`, 1) {
		t.Fatal("composition corrupted offsets")
	}
}

func TestSonsGameplayExistingOnlyAndRefusal(t *testing.T) {
	for _, input := range []string{`{}`, `{"GameSettings":null}`, `{"GameSettings":[]}`, `{"GameSettings":{"Gameplay.TreeRegrowth":null,"Structure.Damage":"true"}}`, `{"GameSettings":{"Gameplay.TreeRegrowth":[true]}}`} {
		p, err := gamesettings.ParseSonsGameplaySettings([]byte(input))
		if err != nil {
			t.Fatal(err)
		}
		if len(p.Fields) != 0 {
			t.Fatal("invented or mistyped controls", p.Fields)
		}
		if _, err = p.Patch(map[string]string{"/GameSettings/Gameplay.TreeRegrowth": "true"}); err == nil {
			t.Fatal("created absent field")
		}
	}
	for _, input := range []string{`[]`, `{} {}`, `{"GameSettings":{},"gamesettings":{}}`, `{"GameSettings":{"Gameplay.TreeRegrowth":true,"gameplay.treeregrowth":false}}`, `{"unknown":{"x":1,"x":2}}`, `{"GameSettings":{"Gameplay.TreeRegrowth":NaN}}`} {
		if _, err := gamesettings.ParseSonsGameplaySettings([]byte(input)); err == nil {
			t.Fatal("accepted ambiguous JSON", input)
		}
	}
	input := []byte(`{"GameSettings":{"Gameplay.TreeRegrowth":true}}`)
	p, err := gamesettings.ParseSonsGameplaySettings(input)
	if err != nil {
		t.Fatal(err)
	}
	for key, value := range map[string]string{"/Password": "private", "/GameSettings/token": "private", "/GameSettings/Gameplay.TreeRegrowth": "True", "/GameSettings/Structure.Damage": "false"} {
		if _, err := p.Patch(map[string]string{key: value}); err == nil {
			t.Fatal("accepted unsupported edit", key)
		}
	}
	if string(input) != `{"GameSettings":{"Gameplay.TreeRegrowth":true}}` {
		t.Fatal("mutated caller input")
	}
	egg := batchSettingsRecipeFixture(t, gamesettings.SonsSettingsRecipe)
	field := M{"key": "/CustomGameModeSettings/GameSetting.Multiplayer.Cheats"}
	gamesettings.SonsGameplaySettingPresentation(egg, gamesettings.SonsSettingsPath, field)
	if field["type"] != "boolean" || !strings.Contains(str(field["help"]), "new custom-mode save") {
		t.Fatal(field)
	}
	wrong := M{"key": "/GameSettings/Gameplay.TreeRegrowth"}
	gamesettings.SonsGameplaySettingPresentation(egg, "/other.cfg", wrong)
	if _, ok := wrong["label"]; ok {
		t.Fatal("wrong document presentation")
	}
}
