package panel

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"
	"voltra/internal/gamesettings"
)

func TestSonsSettingsPreservationAndOptionalFields(t *testing.T) {
	input := []byte("\xef\xbb\xbf{\r\n  \"ServerName\":\"operator\", \"Password\":\"private\",\r\n  \"GameMode\":\"Normal\", \"Unknown\":123456789012345678901234567890,\r\n  \"GameSettings\":{\"token\":\"nested-private\",\"rows\":[1,2,3]}\r\n}\r\n")
	p, err := gamesettings.ParseSonsSettings(input)
	if err != nil {
		t.Fatal(err)
	}
	if len(p.Fields) != len(gamesettings.SonsSettingSpecs) {
		t.Fatalf("fields=%d", len(p.Fields))
	}
	noOp, err := p.Patch(nil)
	if err != nil || !bytes.Equal(noOp, input) {
		t.Fatalf("no-op changed bytes: %v", err)
	}
	got, err := p.Patch(map[string]string{"/ServerName": "new", "/LanOnly": "true", "/SaveInterval": "900"})
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.HasPrefix(got, []byte{0xef, 0xbb, 0xbf}) || !json.Valid(got[3:]) {
		t.Fatal("invalid JSON or lost BOM")
	}
	for _, retained := range []string{`"Password":"private"`, `"Unknown":123456789012345678901234567890`, `"GameSettings":{"token":"nested-private","rows":[1,2,3]}`, `"GameMode":"Normal"`} {
		if !bytes.Contains(got, []byte(retained)) {
			t.Fatalf("lost opaque bytes %s", retained)
		}
	}
	next, err := gamesettings.ParseSonsSettings(got)
	if err != nil {
		t.Fatal(err)
	}
	unchanged, err := next.Patch(nil)
	if err != nil || !bytes.Equal(got, unchanged) {
		t.Fatal("roundtrip changed bytes")
	}
	for _, field := range p.Fields {
		if strings.Contains(field.Key, "token") || field.Key == "/Unknown" || field.Key == "/GameSettings" {
			t.Fatal("opaque contents exposed")
		}
		if field.Key == "/Password" && !field.Secret {
			t.Fatal("password not marked secret")
		}
	}
}

func TestSonsSettingsRejectsUnsafeTypesAndChanges(t *testing.T) {
	for _, input := range []string{`[]`, `{} {}`, `{"MaxPlayers":4,"MaxPlayers":5}`, `{"MaxPlayers":4,"maxplayers":5}`, `{"LanOnly":"false"}`, `{"MaxPlayers":4.5}`, `{"MaxPlayers":9}`, `{"IdleDayCycleSpeed":1.1}`, `{"ServerName":"bad\nline"}`, `{"GameMode":"invented"}`, `{"Password":"` + strings.Repeat("x", 41) + `"}`, `{"unknown":{"x":1,"x":2}}`, `{"unknown":NaN}`} {
		if _, err := gamesettings.ParseSonsSettings([]byte(input)); err == nil {
			t.Fatalf("accepted %s", input)
		}
	}
	p, err := gamesettings.ParseSonsSettings([]byte(`{"Password":"private","GamePort":8766,"SaveMode":null}`))
	if err != nil {
		t.Fatal(err)
	}
	for key, value := range map[string]string{"/MaxPlayers": "9", "/GamePort": "9999", "/Password": "bad\rline", "/IdleDayCycleSpeed": "NaN", "/SaveSlot": "01", "/GameSettings": "{}", "/SaveMode": "New"} {
		if _, err := p.Patch(map[string]string{key: value}); err == nil {
			t.Fatalf("accepted %s=%s", key, value)
		}
	}
	if _, err := p.Patch(map[string]string{"/Password": ""}); err != nil {
		t.Fatal("explicit clear failed", err)
	}
}

func TestSonsSettingsEmptyObjectAndPresentation(t *testing.T) {
	p, err := gamesettings.ParseSonsSettings([]byte(`{}`))
	if err != nil {
		t.Fatal(err)
	}
	got, err := p.Patch(map[string]string{"/MaxPlayers": "6", "/LanOnly": "false"})
	if err != nil || !json.Valid(got) {
		t.Fatalf("empty object insertion %s %v", got, err)
	}
	egg := batchSettingsRecipeFixture(t, gamesettings.SonsSettingsRecipe)
	if _, err = gamesettings.ParseForEgg(egg, "/other.cfg", []byte(`{}`)); err == nil {
		t.Fatal("wrong path accepted")
	}
	field := M{"key": "/SaveMode", "value": "continue"}
	gamesettings.SonsSettingPresentation(egg, gamesettings.SonsSettingsPath, field)
	if field["type"] != "select" || field["group"] != "World and saves" {
		t.Fatal(field)
	}
	options, ok := field["options"].([]M)
	if !ok || len(options) != 2 {
		t.Fatal("missing save mode options", field)
	}
	if str(options[0]["value"]) != "continue" || !strings.Contains(str(options[1]["label"]), "overwrites") {
		t.Fatal(options)
	}
}
