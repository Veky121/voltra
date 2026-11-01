package panel

import (
	"bytes"
	"encoding/json"
	"os"
	"strings"
	"testing"
)

func TestVrisingSettingsBytesAndTypes(t *testing.T) {
	raw := []byte("\xef\xbb\xbf{\r\n  \"Name\": \"Operator\", \"MaxConnectedUsers\":8, \"Secure\":true, \"Port\":9876, \"Password\":\"hidden\", \"Rcon\":{\"Password\":\"nested\"}, \"Unknown\":[1,{\"secret\":\"opaque\"}]\r\n}\r\n")
	p, e := parseVrisingSettings(vrisingHostSettingsPath, raw)
	if e != nil {
		t.Fatal(e)
	}
	unchanged, e := p.patch(nil)
	if e != nil || !bytes.Equal(unchanged, raw) {
		t.Fatal("no-op bytes")
	}
	for _, f := range p.fields {
		if strings.Contains(f.value, "hidden") || strings.Contains(f.value, "nested") || strings.Contains(f.value, "opaque") {
			t.Fatal("secret exposed")
		}
	}
	out, e := p.patch(map[string]string{"/Name": "literal $safe", "/MaxConnectedUsers": "16", "/Secure": "false"})
	if e != nil {
		t.Fatal(e)
	}
	expected := bytes.Replace(raw, []byte(`"Operator"`), []byte(`"literal $safe"`), 1)
	expected = bytes.Replace(expected, []byte(`Users":8`), []byte(`Users":16`), 1)
	expected = bytes.Replace(expected, []byte(`Secure":true`), []byte(`Secure":false`), 1)
	if !bytes.Equal(out, expected) {
		t.Fatalf("unrelated bytes changed: %s", out)
	}
	if _, e = parseVrisingSettings(vrisingHostSettingsPath, out); e != nil {
		t.Fatal(e)
	}
	for key, value := range map[string]string{"/Port": "99", "/Password": "x", "/Rcon/Password": "x", "/Unknown": "x", "/Name": "bad\nvalue", "/MaxConnectedUsers": "129", "/Secure": "yes"} {
		if _, e = p.patch(map[string]string{key: value}); e == nil {
			t.Fatal("accepted", key)
		}
	}
}
func TestVrisingSettingsRefusals(t *testing.T) {
	for _, raw := range []string{`{"Name":"a","Name":"b"}`, `{"Name":"a","name":"b"}`, `{"Unknown":1,"unknown":2}`, `[]`, `{"Name":NaN}`} {
		if _, e := parseVrisingSettings(vrisingHostSettingsPath, []byte(raw)); e == nil {
			t.Fatal(raw)
		}
	}
	p, e := parseVrisingSettings(vrisingHostSettingsPath, []byte(`{"Unknown":[1],"Name":null}`))
	if e != nil || len(p.fields) != 0 {
		t.Fatal("invented fields", e)
	}
	if _, e = parseVrisingSettings("/save-data/Settings/../ServerHostSettings.json", []byte(`{}`)); e == nil {
		t.Fatal("path alias")
	}
}
func TestVrisingSettingsCanonicalAuthority(t *testing.T) {
	data, e := os.ReadFile("game_library/overrides.json")
	if e != nil {
		t.Fatal(e)
	}
	var profiles map[string]struct {
		Egg struct {
			Startup string `json:"startup"`
			Scripts struct {
				Installation struct {
					Script string `json:"script"`
				} `json:"installation"`
			} `json:"scripts"`
		} `json:"egg"`
	}
	if e = json.Unmarshal(data, &profiles); e != nil {
		t.Fatal(e)
	}
	egg := profiles[vrisingSettingsRecipe].Egg
	helpers := map[string][]byte{}
	for name := range vrisingSettingsPins {
		_, body, ok := strings.Cut(egg.Scripts.Installation.Script, "cat > "+name+" <<'VOLTRA_SOURCE'\n")
		if !ok {
			t.Fatal(name)
		}
		source, _, ok := strings.Cut(body, "\nVOLTRA_SOURCE")
		if !ok {
			t.Fatal(name)
		}
		helpers[name] = []byte(source + "\n")
	}
	check := func(recipe, startup, file, variant string) error {
		return vrisingSettingsAuthority(recipe, startup, file, variant, helpers)
	}
	if e = check(vrisingSettingsRecipe, egg.Startup, vrisingHostSettingsPath, "vanilla"); e != nil {
		t.Fatal(e)
	}
	for _, args := range [][4]string{{"bepinex", egg.Startup, vrisingHostSettingsPath, "vanilla"}, {vrisingSettingsRecipe, egg.Startup + " x", vrisingHostSettingsPath, "vanilla"}, {vrisingSettingsRecipe, egg.Startup, "/ServerGameSettings.json", "vanilla"}, {vrisingSettingsRecipe, egg.Startup, vrisingHostSettingsPath, "bepinex"}} {
		if check(args[0], args[1], args[2], args[3]) == nil {
			t.Fatal(args)
		}
	}
	for name, source := range helpers {
		helpers[name] = append(bytes.Clone(source), 'x')
		if check(vrisingSettingsRecipe, egg.Startup, vrisingHostSettingsPath, "vanilla") == nil {
			t.Fatal(name)
		}
		helpers[name] = source
	}
}
