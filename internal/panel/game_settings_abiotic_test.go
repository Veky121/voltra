package panel

import (
	"bytes"
	"encoding/json"
	"os"
	"regexp"
	"strings"
	"testing"
)

func TestAbioticPublisherTypedPatch(t *testing.T) {
	data, e := os.ReadFile("../../artifacts/game-parity-20261029/wave26-abiotic/publisher-SandboxSettings.ini")
	if e != nil {
		t.Fatal(e)
	}
	p, e := parseAbioticSettings(data)
	if e != nil {
		t.Fatal(e)
	}
	if len(p.fields) < 40 {
		t.Fatal("incomplete publisher coverage")
	}
	got, e := p.patch(map[string]string{"SandboxSettings/HardcoreMode": "True", "SandboxSettings/EnemyHealthMultiplier": "1.5"})
	if e != nil {
		t.Fatal(e)
	}
	want := bytes.Replace(data, []byte("HardcoreMode=False"), []byte("HardcoreMode=True"), 1)
	want = bytes.Replace(want, []byte("EnemyHealthMultiplier=1.0"), []byte("EnemyHealthMultiplier=1.5"), 1)
	if !bytes.Equal(got, want) {
		t.Fatal("unrelated bytes changed")
	}
	for _, key := range []string{"SandboxSettings/HardcoreMode", "SandboxSettings/EnemyHealthMultiplier", "SandboxSettings/GameDifficulty", "SandboxSettings/ServerPassword"} {
		for _, v := range []string{"NaN", "Inf", "x\ny=z", "true;bad"} {
			if b, e := p.patch(map[string]string{key: v}); e == nil || b != nil {
				t.Fatal("invalid patch accepted", key)
			}
		}
	}
}
func TestAbioticNativePrecedencePreservation(t *testing.T) {
	data := []byte("\ufeff[SandboxSettings]\r\n;keep\r\nEnemyHealthMultiplier = 2.5  \r\n+Unknown=one\r\n+Unknown=two\r\n[Other]\r\nSecret=private\r\n")
	p, e := parseAbioticSettings(data)
	if e != nil {
		t.Fatal(e)
	}
	got, e := p.patch(nil)
	if e != nil || !bytes.Equal(got, data) {
		t.Fatal("seeded or rewrote native")
	}
	if len(p.fields) != 1 || p.fields[0].value != "2.5" {
		t.Fatal("native precedence")
	}
	got, e = p.patch(map[string]string{"SandboxSettings/EnemyHealthMultiplier": "3"})
	if e != nil || !bytes.Equal(got, bytes.Replace(data, []byte("2.5"), []byte("3"), 1)) {
		t.Fatal("preservation")
	}
	if _, e = p.patch(map[string]string{"SandboxSettings/HardcoreMode": "True"}); e == nil {
		t.Fatal("inserted absent default")
	}
	for _, extra := range []string{"EnemyHealthMultiplier=1", "enemyhealthmultiplier=1", "+EnemyHealthMultiplier=1", "EnemyHealthMultiplier[]=1", "[sandboxsettings]", "[SandboxSettings]", "broken", "\x00"} {
		if _, e := parseAbioticSettings([]byte(strings.TrimPrefix(string(data), "\ufeff") + "[SandboxSettings]\n" + extra)); e == nil {
			t.Fatal("accepted ambiguity", extra)
		}
	}
}
func TestAbioticEmittedAuthority(t *testing.T) {
	raw, e := os.ReadFile("game_library/overrides.json")
	if e != nil {
		t.Fatal(e)
	}
	var catalog map[string]struct {
		Egg struct {
			Startup string `json:"startup"`
			Scripts struct {
				Installation struct {
					Script string `json:"script"`
				} `json:"installation"`
			} `json:"scripts"`
		} `json:"egg"`
	}
	if e = json.Unmarshal(raw, &catalog); e != nil {
		t.Fatal(e)
	}
	p := catalog[abioticSettingsRecipe]
	re := regexp.MustCompile(`(?s)cat > (\.voltra/[^\s]+) <<'([^']+)'\r?\n`)
	files := map[string][]byte{}
	script := p.Egg.Scripts.Installation.Script
	for _, m := range re.FindAllStringSubmatchIndex(script, -1) {
		name := script[m[2]:m[3]]
		marker := script[m[4]:m[5]]
		body := script[m[1]:]
		end := strings.Index(body, "\n"+marker+"\n")
		if end < 0 {
			t.Fatal("missing installer marker")
		}
		files["/"+name] = []byte(body[:end] + "\n")
	}
	files[abioticSettingsPath] = []byte("[SandboxSettings]\nHardcoreMode=False\n")
	if !abioticSettingsAuthority(abioticSettingsRecipe, p.Egg.Startup, 0, files) {
		t.Fatal("actual emitted installer rejected")
	}
	if abioticSettingsAuthority("other", p.Egg.Startup, 0, files) || abioticSettingsAuthority(abioticSettingsRecipe, p.Egg.Startup+" -SandboxIniPath=x", 0, files) || abioticSettingsAuthority(abioticSettingsRecipe, p.Egg.Startup, 1, files) {
		t.Fatal("precedence override admitted")
	}
	for name, data := range files {
		delete(files, name)
		if abioticSettingsAuthority(abioticSettingsRecipe, p.Egg.Startup, 0, files) {
			t.Fatal("missing source/path admitted")
		}
		files[name] = append([]byte(nil), data...)
		if len(data) > 0 {
			files[name][0] ^= 1
		}
		if name != abioticSettingsPath && abioticSettingsAuthority(abioticSettingsRecipe, p.Egg.Startup, 0, files) {
			t.Fatal("modified module admitted")
		}
		files[name] = data
	}
}
