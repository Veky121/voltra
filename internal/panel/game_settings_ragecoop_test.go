package panel

import (
	"bytes"
	"encoding/json"
	"os"
	"strings"
	"testing"
)

func TestRagecoopCapturedSettings(t *testing.T) {
	raw, err := os.ReadFile("../../.local/gta-next/ragecoop/native-settings.xml")
	if err != nil {
		t.Fatal(err)
	}
	p, err := parseRagecoopSettings(raw)
	if err != nil {
		t.Fatal(err)
	}
	same, err := p.patch(nil)
	if err != nil || !bytes.Equal(raw, same) {
		t.Fatal("read changed bytes", err)
	}
	next, err := p.patch(map[string]string{"WelcomeMessage": "hello <world> & friends", "UseVoice": "false"})
	if err != nil {
		t.Fatal(err)
	}
	expected := bytes.Replace(raw, []byte("517077 native state"), []byte("hello &lt;world&gt; &amp; friends"), 1)
	expected = bytes.Replace(expected, []byte("<UseVoice>true"), []byte("<UseVoice>false"), 1)
	if !bytes.Equal(next, expected) {
		t.Fatal("unrelated bytes changed")
	}
	if _, err = parseRagecoopSettings(next); err != nil {
		t.Fatal(err)
	}
	for _, m := range []map[string]string{{"Port": "1"}, {"Name": "other"}, {"UseVoice": "1"}, {"WelcomeMessage": "a\nb"}, {"Password": "leak"}, {"Missing": "x"}} {
		if _, err = p.patch(m); err == nil {
			t.Fatal("accepted", m)
		}
	}
}
func TestRagecoopOpaqueAndRefusal(t *testing.T) {
	raw := []byte(`<Settings><!--keep--><Password>private</Password><Items><Item>a</Item><Item>b</Item></Items><WelcomeMessage>hi</WelcomeMessage><UseVoice>true</UseVoice></Settings>`)
	p, e := parseRagecoopSettings(raw)
	if e != nil {
		t.Fatal(e)
	}
	for _, f := range p.fields {
		if strings.Contains(f.value, "private") || f.key == "Password" || f.key == "Items" {
			t.Fatal("secret exposed")
		}
	}
	for _, s := range []string{`<Settings><UseVoice>true</UseVoice><usevoice>false</usevoice></Settings>`, `<Settings><UseVoice>true</UseVoice><UseVoice>false</UseVoice></Settings>`, `<!DOCTYPE Settings><Settings/>`, `<Settings><UseVoice><x/></UseVoice></Settings>`, `<Settings><UseVoice/></Settings>`, `<wrong/>`, `<Settings/><Settings/>`} {
		if _, e := parseRagecoopSettings([]byte(s)); e == nil {
			t.Fatal("accepted", s)
		}
	}
}
func TestRagecoopActualHelperAuthority(t *testing.T) {
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
	profile := profiles[ragecoopRecipe]
	in := settingsAuthorityInput{Startup: profile.Egg.Startup, Env: map[string]string{}, Files: map[string][]byte{}}
	for _, n := range []string{"ragecoop-runtime.py", "gta-runtime.py", "native-console.py"} {
		prefix := "cat > .voltra/" + n + " <<'VOLTRA_SOURCE'\n"
		_, tail, ok := strings.Cut(profile.Egg.Scripts.Installation.Script, prefix)
		if !ok {
			t.Fatal(n)
		}
		body, _, ok := strings.Cut(tail, "\nVOLTRA_SOURCE")
		if !ok {
			t.Fatal(n)
		}
		in.Files[".voltra/"+n] = []byte(body + "\n")
	}
	in.Files["ragecoop/Settings.xml"] = []byte(`<Settings><UseVoice>true</UseVoice></Settings>`)
	if _, e := ragecoopSettingsAuthority(ragecoopRecipe, ragecoopPath, in); e != nil {
		t.Fatal(e)
	}
	for _, path := range []string{"/Settings.xml", "/ragecoop/../Settings.xml", ragecoopPath + ";x"} {
		if _, e := ragecoopSettingsAuthority(ragecoopRecipe, path, in); e == nil {
			t.Fatal(path)
		}
	}
	in.Startup += " --config other.xml"
	if _, e := ragecoopSettingsAuthority(ragecoopRecipe, ragecoopPath, in); e == nil {
		t.Fatal("arg drift")
	}
	in.Startup = ragecoopStartup
	in.Env["VOLTRA_SERVER_ROOT"] = "/tmp"
	if _, e := ragecoopSettingsAuthority(ragecoopRecipe, ragecoopPath, in); e == nil {
		t.Fatal("root drift")
	}
	delete(in.Env, "VOLTRA_SERVER_ROOT")
	in.Files[".voltra/ragecoop-runtime.py"] = []byte("drift")
	if _, e := ragecoopSettingsAuthority(ragecoopRecipe, ragecoopPath, in); e == nil {
		t.Fatal("helper drift")
	}
}
