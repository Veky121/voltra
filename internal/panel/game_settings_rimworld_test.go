package panel

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"testing"
)

func TestRimworldSettings(t *testing.T) {
	for _, c := range []struct {
		recipe, path string
		max          string
	}{
		{"rimworld/open_world/egg-rimworld-open-world.json", "/Data/Config.json", "1000"},
		{"rimworld/together/egg-rimworld-together.json", "/Configs/ServerConfig.json", "150"},
	} {
		raw := []byte("\xef\xbb\xbf{\r\n \"MaxPlayers\": 7, \"Name\":\"native\", \"Password\":\"opaque\", \"Unknown\":900719925474099312345, \"Nested\":{\"Token\":\"opaque\"}}\r\n")
		p, e := parseRimworldSettings(c.recipe, c.path, raw)
		if e != nil {
			t.Fatal(e)
		}
		for _, f := range p.fields {
			if f.secret && f.value != "" {
				t.Fatal("secret leak")
			}
		}
		for _, changes := range []map[string]string{nil, {"/MaxPlayers": "7"}} {
			b, e := p.patch(changes)
			if e != nil || !bytes.Equal(b, raw) {
				t.Fatal("no-op", e)
			}
		}
		b, e := p.patch(map[string]string{"/MaxPlayers": c.max})
		if e != nil {
			t.Fatal(e)
		}
		expected := bytes.Replace(raw, []byte(": 7,"), []byte(": "+c.max+","), 1)
		if !bytes.Equal(b, expected) {
			t.Fatal("preservation")
		}
		q, e := parseRimworldSettings(c.recipe, c.path, b)
		if e != nil {
			t.Fatal(e)
		}
		if _, e = q.patch(map[string]string{"/MaxPlayers": "8"}); e != nil {
			t.Fatal(e)
		}
		for k, v := range map[string]string{"/Password": "new", "/Port": "123", "/PlayerVersion": "1.4", "/Unknown": "1", "/MaxPlayers": "1e2", "/Name": "bad\nname", "/Nested/Token": "x"} {
			if _, e = p.patch(map[string]string{k: v}); e == nil {
				t.Fatalf("accepted %s", k)
			}
		}
		for _, s := range []string{`{"MaxPlayers":7,"maxplayers":8}`, `{"x":{"a":1,"A":2}}`, `{"a":1,"a":2}`, `{"MaxPlayers":7}//comment`, `[]`} {
			if _, e := parseRimworldSettings(c.recipe, c.path, []byte(s)); e == nil {
				t.Fatal("unsafe JSON", s)
			}
		}
		if _, e := parseRimworldSettings(c.recipe, c.path+".bak", raw); e == nil {
			t.Fatal("path drift")
		}
	}
}
func TestRimworldAuthority(t *testing.T) {
	installed := map[string][]byte{}
	reviewed := map[string]string{}
	for _, p := range []string{".voltra/sonic_rimworld.py", ".voltra/native_console.py", ".voltra/steam_template.py", ".voltra/additional_survival_install.py"} {
		installed[p] = []byte(p)
		s := sha256.Sum256(installed[p])
		reviewed[p] = hex.EncodeToString(s[:])
	}
	recipe := "rimworld/together/egg-rimworld-together.json"
	file := "/Configs/ServerConfig.json"
	startup := rimworldStartupPrefix + "together"
	check := func(s string, m int) bool {
		return rimworldSettingsAuthority(recipe, file, s, startup, m, installed, reviewed)
	}
	if !check(startup, 0) || check(startup+" ", 0) || check(startup, 1) {
		t.Fatal("startup/mappings")
	}
	installed[".voltra/sonic_rimworld.py"] = []byte("drift")
	if check(startup, 0) {
		t.Fatal("helper drift")
	}
}
