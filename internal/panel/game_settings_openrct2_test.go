package panel

import (
	"bytes"
	"encoding/json"
	"os"
	"regexp"
	"testing"
)

func TestOpenRCT2SettingsEdits(t *testing.T) {
	source := []byte("; retained\r\n[general]\r\nautosave = 1 ; keep\r\nautosave_amount = 10\r\n[network]\r\nmaxplayers = 16\r\nadvertise = false\r\nserver_name = \"Old\"\r\ndefault_port = 11753\r\ndefault_password = \"private\"\r\n[plugin]\r\npath = \"opaque\"\r\n")
	p, e := parseOpenRCT2Settings(source)
	if e != nil {
		t.Fatal(e)
	}
	for _, f := range p.fields {
		if f.key == "network/default_password" || f.key == "plugin/path" {
			t.Fatal("opaque field exposed", f.key)
		}
	}
	same, e := p.patch(nil)
	if e != nil || !bytes.Equal(same, source) {
		t.Fatal("read changed bytes")
	}
	updated, e := p.patch(map[string]string{"general/autosave": "3", "network/advertise": "true", "network/server_name": "New"})
	if e != nil {
		t.Fatal(e)
	}
	expected := bytes.Replace(source, []byte("autosave = 1"), []byte("autosave = 3"), 1)
	expected = bytes.Replace(expected, []byte("advertise = false"), []byte("advertise = true"), 1)
	expected = bytes.Replace(expected, []byte(`"Old"`), []byte(`"New"`), 1)
	if !bytes.Equal(updated, expected) {
		t.Fatalf("unrelated bytes changed: %s", updated)
	}
	if _, e = parseOpenRCT2Settings(updated); e != nil {
		t.Fatal(e)
	}
	for k, v := range map[string]string{"general/autosave": "6", "network/maxplayers": "0", "network/default_port": "12", "network/default_password": "x", "network/server_name": "x\nkey=1", "network/server_greeting": "absent"} {
		if _, e = p.patch(map[string]string{k: v}); e == nil {
			t.Fatal("accepted", k)
		}
	}
	for _, extra := range []string{"[NETWORK]\nmaxplayers=2\n", "[network]\nmaxplayers=2\n"} {
		if _, e = parseOpenRCT2Settings(append(append([]byte{}, source...), extra...)); e == nil {
			t.Fatal("duplicate accepted")
		}
	}
}

func TestOpenRCT2SettingsAuthority(t *testing.T) {
	raw, e := os.ReadFile("game_library/overrides.json")
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
	if e = json.Unmarshal(raw, &profiles); e != nil {
		t.Fatal(e)
	}
	egg := profiles["openrct2/egg-openrct2.json"].Egg
	helpers := map[string][]byte{}
	for _, m := range regexp.MustCompile(`(?s)cat > \.voltra/([^ ]+) <<'VOLTRA_SOURCE'\n(.*?)\nVOLTRA_SOURCE`).FindAllStringSubmatch(egg.Scripts.Installation.Script, -1) {
		helpers[".voltra/"+m[1]] = []byte(m[2] + "\n")
	}
	check := func(startup, file string) error {
		return validateOpenRCT2SettingsAuthority("openrct2/egg-openrct2.json", startup, file, helpers)
	}
	if e = check(egg.Startup, openRCT2SettingsPath); e != nil {
		t.Fatal("canonical mismatch", e)
	}
	if check(egg.Startup+" --override", openRCT2SettingsPath) == nil || check(egg.Startup, "/ServerData/../config.ini") == nil {
		t.Fatal("drift accepted")
	}
	helpers[".voltra/openrct2-runtime.py"] = []byte("drift")
	if check(egg.Startup, openRCT2SettingsPath) == nil {
		t.Fatal("helper drift accepted")
	}
}
