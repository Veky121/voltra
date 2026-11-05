package panel

import (
	"bytes"
	"encoding/json"
	"os"
	"testing"
)

func TestSolacePreservation(t *testing.T) {
	data := []byte("{\r\n  \"name\":\"old\", \"isPrivate\":false, \"maxPlayers\":12, \"password\":\"opaque\", \"port\":27015, \"x\":1.234567890123456789\r\n}\r\n")
	p, e := parseSolaceSettings(data)
	if e != nil {
		t.Fatal(e)
	}
	if len(p.fields) != 3 {
		t.Fatal(p.fields)
	}
	for _, f := range p.fields {
		if f.secret || f.value == "opaque" {
			t.Fatal("secret exposed")
		}
	}
	for _, changes := range []map[string]string{nil, {"/name": "old"}} {
		got, e := p.patch(changes)
		if e != nil || !bytes.Equal(got, data) {
			t.Fatal("no-op", e)
		}
	}
	got, e := p.patch(map[string]string{"/name": "new", "/maxPlayers": "24"})
	if e != nil {
		t.Fatal(e)
	}
	want := bytes.Replace(data, []byte(`"old"`), []byte(`"new"`), 1)
	want = bytes.Replace(want, []byte(`:12`), []byte(`:24`), 1)
	if !bytes.Equal(got, want) {
		t.Fatal(string(got))
	}
	if _, e = parseSolaceSettings(got); e != nil {
		t.Fatal(e)
	}
	for _, changes := range []map[string]string{{"/password": "x"}, {"/port": "1234"}, {"/worldSaveToUse": "other"}, {"/name": "bad\nname"}, {"/maxPlayers": "1e2"}, {"/maxPlayers": "01"}, {"/maxPlayers": "1025"}, {"/isPrivate": "1"}, {"/autoRestart": "3"}} {
		if _, e = p.patch(changes); e == nil {
			t.Fatal(changes)
		}
	}
	for _, bad := range []string{`[]`, `{"name":null}`, `{"name":"a","Name":"b"}`, `{"x":{"a":1,"a":2}}`, `{"x":{"a":1,"A":2}}`, `{"maxPlayers":1.0}`, `{"isPrivate":"false"}`, `{"name":"a"} {}`, `{/*comment*/}`} {
		if _, e := parseSolaceSettings([]byte(bad)); e == nil {
			t.Fatal(bad)
		}
	}
	p, e = parseSolaceSettings([]byte(`{"unknown":12345678901234567890}`))
	if e != nil || len(p.fields) != 0 {
		t.Fatal("invented settings", e)
	}
}
func TestSolaceCanonicalAuthority(t *testing.T) {
	root := "testdata/game-settings/game-parity-20261029/wave63-three-settings-integration/solace/"
	raw, e := os.ReadFile(root + "../solace-proposal.json")
	if e != nil {
		t.Fatal(e)
	}
	var profile struct {
		Egg struct {
			Startup string `json:"startup"`
		}
	}
	if e = json.Unmarshal(raw, &profile); e != nil {
		t.Fatal(e)
	}
	helpers := map[string][]byte{}
	for _, name := range []string{"steam_template.py", "native_config.py", "native_console.py", "fantasy_worlds_runtime.py", "fantasy_worlds_install.py", "fantasy_worlds_defaults.json", "fantasy_worlds_wine.py", "fantasy_worlds_wine_build.py", "fantasy_worlds_wine_console.c"} {
		helpers[name], e = os.ReadFile(root + name)
		helpers[name] = bytes.TrimSuffix(helpers[name], []byte("\n"))
		if e != nil {
			t.Fatal(e)
		}
	}
	check := func(r, s, p string) error { return solaceSettingsAuthority(r, s, p, helpers) }
	if e = check(solaceSettingsRecipe, profile.Egg.Startup, solaceSettingsDocument); e != nil {
		t.Fatal(e)
	}
	for _, v := range [][3]string{{"foreign", solaceSettingsStartup, solaceSettingsDocument}, {solaceSettingsRecipe, solaceSettingsStartup + " ", solaceSettingsDocument}, {solaceSettingsRecipe, solaceSettingsStartup, "/servercfg.dat"}} {
		if check(v[0], v[1], v[2]) == nil {
			t.Fatal("drift accepted")
		}
	}
	for name, data := range helpers {
		helpers[name] = append(append([]byte(nil), data...), ' ')
		if check(solaceSettingsRecipe, solaceSettingsStartup, solaceSettingsDocument) == nil {
			t.Fatal(name)
		}
		helpers[name] = data
	}
}
