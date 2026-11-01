package panel

import (
	"bytes"
	"encoding/json"
	"os"
	"strings"
	"testing"
)

func TestRomesteadSpans(t *testing.T) {
	body := []byte("\xef\xbb\xbf{\r\n \"EnableCheats\":true, \"AutoCreateAndLoadWorld\":true, \"Password\":\"private\", \"Port\":28003, \"worlds\":[{\"token\":\"hidden\",\"n\":9007199254740993}]}\r\n")
	p, e := parseRomesteadSettings(body)
	if e != nil {
		t.Fatal(e)
	}
	for _, f := range p.fields {
		if strings.Contains(f.key, "token") || strings.Contains(f.value, "private") {
			t.Fatal("secret leaked")
		}
		if f.key == "/Password" && !f.secret {
			t.Fatal("unmasked")
		}
	}
	got, e := p.patch(map[string]string{"/EnableCheats": "false"})
	if e != nil {
		t.Fatal(e)
	}
	want := bytes.Replace(body, []byte(`"EnableCheats":true`), []byte(`"EnableCheats":false`), 1)
	if !bytes.Equal(got, want) {
		t.Fatal("byte drift")
	}
	if _, e = parseRomesteadSettings(got); e != nil {
		t.Fatal(e)
	}
	for _, c := range []map[string]string{{"/Port": "1"}, {"/Password": "new"}, {"/worlds": "[]"}, {"/EnableCheats": "false;evil"}, {"/missing": "true"}} {
		if _, e = p.patch(c); e == nil {
			t.Fatal("unsafe edit", c)
		}
	}
	empty, e := parseRomesteadSettings([]byte(`{}`))
	if e != nil || len(empty.fields) != 0 {
		t.Fatal("seeded fields")
	}
	for _, s := range []string{`[]`, `{"EnableCheats":true,"enablecheats":false}`, `{"x":{"a":1,"a":2}}`, `{"EnableCheats":1}`, `{} {}`} {
		if _, e = parseRomesteadSettings([]byte(s)); e == nil {
			t.Fatal("accepted", s)
		}
	}
}
func TestRomesteadEmittedAuthority(t *testing.T) {
	b, e := os.ReadFile("game_library/overrides.json")
	if e != nil {
		t.Fatal(e)
	}
	var entries map[string]struct {
		Egg struct {
			Startup string `json:"startup"`
			Scripts struct {
				Installation struct {
					Script string `json:"script"`
				} `json:"installation"`
			} `json:"scripts"`
		} `json:"egg"`
	}
	if e = json.Unmarshal(b, &entries); e != nil {
		t.Fatal(e)
	}
	egg := entries[romesteadSettingsRecipe].Egg
	in := settingsAuthorityInput{Startup: egg.Startup, Env: map[string]string{"VOLTRA_CRAFTING": "romestead", "SRCDS_APPID": "4763510"}, Files: map[string][]byte{"config.json": []byte(`{"EnableCheats":true}`)}}
	for _, chunk := range strings.Split(egg.Scripts.Installation.Script, "cat > ")[1:] {
		head, body, ok := strings.Cut(chunk, "\n")
		if !ok {
			continue
		}
		name, marker, ok := strings.Cut(head, " <<'")
		if !ok {
			continue
		}
		marker = strings.TrimSuffix(marker, "'")
		body, _, ok = strings.Cut(body, "\n"+marker+"\n")
		if ok {
			in.Files[name] = []byte(body + "\n")
		}
	}
	a, e := romesteadSettingsAuthority(romesteadSettingsRecipe, egg.Startup, in)
	if e != nil || a.Path != "/config.json" || a.Revision == "" {
		t.Fatal(a, e)
	}
	for name := range romesteadSettingsSources {
		saved := in.Files[name]
		in.Files[name] = append(bytes.Clone(saved), 'x')
		if _, e = romesteadSettingsAuthority(romesteadSettingsRecipe, egg.Startup, in); e == nil {
			t.Fatal("helper drift", name)
		}
		in.Files[name] = saved
	}
	for _, key := range []string{"VOLTRA_CRAFTING", "SRCDS_APPID", "WINDOWS_INSTALL", "PYTHONPATH", "EXTRA_ARGS"} {
		saved := in.Env[key]
		in.Env[key] = "drift"
		if _, e = romesteadSettingsAuthority(romesteadSettingsRecipe, egg.Startup, in); e == nil {
			t.Fatal(key)
		}
		in.Env[key] = saved
	}
	in.Startup += " extra"
	if _, e = romesteadSettingsAuthority(romesteadSettingsRecipe, egg.Startup, in); e == nil {
		t.Fatal("argv drift")
	}
}
