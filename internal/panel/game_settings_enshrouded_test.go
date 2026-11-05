package panel

import (
	"bytes"
	"strings"
	"testing"
)

func TestEnshroudedSettingsPreserve(t *testing.T) {
	raw := []byte("{\r\n  \"name\":\"old\", \"slotCount\":16, \"queryPort\":15637, \"userGroups\":[{\"password\":\"do-not-leak\"}], \"unknown\":900719925474099312345, \"gameSettings\":{\"x\":1.234567890123456789}\r\n}")
	p, e := parseEnshroudedSettings(raw)
	if e != nil {
		t.Fatal(e)
	}
	for _, f := range p.fields {
		if strings.Contains(f.value, "do-not-leak") || strings.Contains(f.key, "userGroups") {
			t.Fatal("secret leaked")
		}
	}
	got, e := p.patch(map[string]string{"/name": "new", "/slotCount": "12"})
	if e != nil {
		t.Fatal(e)
	}
	want := bytes.Replace(bytes.Replace(raw, []byte(`"old"`), []byte(`"new"`), 1), []byte(`:16`), []byte(`:12`), 1)
	if !bytes.Equal(got, want) {
		t.Fatal("untouched bytes changed")
	}
	for k, v := range map[string]string{"/queryPort": "1", "/missing": "x", "/slotCount": "17", "/enableTextChat": "true", "/name": "bad\nvalue", "/userGroups": "[]"} {
		if _, e = p.patch(map[string]string{k: v}); e == nil {
			t.Fatalf("accepted %s", k)
		}
	}
}
func TestEnshroudedSettingsRefusal(t *testing.T) {
	for _, s := range []string{`{"name":"a","name":"b"}`, `{"name":"a","Name":"b"}`, `{"enableTextChat":"true"}`, `[]`, `{"slotCount":1.5}`, `{"name":"a"} trailing`, `{/*comment*/"name":"a"}`} {
		if _, e := parseEnshroudedSettings([]byte(s)); e == nil {
			t.Fatal("accepted ambiguous/invalid JSON")
		}
	}
}
func TestEnshroudedAuthority(t *testing.T) {
	in := settingsAuthorityInput{Startup: enshroudedSettingsStartup, Env: map[string]string{"SERVER_PORT": "15637", "VOLTRA_ALLOCATED_PORTS": "15637"}, Files: map[string][]byte{}}
	in.Files = wave46CanonicalHelpers(t, enshroudedSettingsRecipe)
	in.Files["enshrouded_server.json"] = []byte(`{"queryPort":15637,"saveDirectory":"./savegame","logDirectory":"./logs","name":"x"}`)
	a, e := enshroudedSettingsAuthority(enshroudedSettingsRecipe, enshroudedSettingsStartup, in)
	if e != nil || a.Path != enshroudedSettingsPath {
		t.Fatal(a, e)
	}
	in.Startup += "; injected"
	if _, e := enshroudedSettingsAuthority(enshroudedSettingsRecipe, enshroudedSettingsStartup, in); e == nil {
		t.Fatal("startup accepted")
	}
	in.Startup = enshroudedSettingsStartup
	in.Files[".voltra/enshrouded_runtime.py"] = []byte("old Wine helper")
	if _, e := enshroudedSettingsAuthority(enshroudedSettingsRecipe, enshroudedSettingsStartup, in); e == nil {
		t.Fatal("helper accepted")
	}
}
