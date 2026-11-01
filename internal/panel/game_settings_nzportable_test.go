package panel

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

func TestNZPortableProjection(t *testing.T) {
	original := []byte("// retained\r\nhostname \"Operator\" // comment\r\nsys_ticrate 0.04500000000000000001\r\npassword \"opaque-value\"\r\ncustom 9\r\n")
	p, err := parseNZPortableSettings(original)
	if err != nil {
		t.Fatal(err)
	}
	if len(p.fields) != 2 {
		t.Fatalf("fields: %#v", p.fields)
	}
	for _, f := range p.fields {
		if f.kind != "readonly" || strings.Contains(f.value, "opaque") {
			t.Fatal(f)
		}
	}
	out, err := p.patch(nil)
	if err != nil || !bytes.Equal(out, original) {
		t.Fatal("no-op changed bytes", err)
	}
	again, err := parseNZPortableSettings(out)
	if err != nil || len(again.fields) != 2 {
		t.Fatal("reparse", err)
	}
	for _, change := range []map[string]string{{"hostname": "new"}, {"hostname": "x;quit"}, {"password": "secret"}, {"custom": "1"}, {"sys_ticrate": "0.02"}} {
		if _, err := p.patch(change); err == nil {
			t.Fatal("accepted edit", change)
		}
	}
	for _, body := range []string{"hostname a\nHOSTNAME b", "exec other.cfg\nhostname a", "alias x quit\nhostname a", "hostname a;quit", "hostname \"a\\b\""} {
		q, e := parseNZPortableSettings([]byte(body))
		if e != nil {
			continue
		}
		if _, e = q.patch(map[string]string{"hostname": "b"}); e == nil {
			t.Fatal(body)
		}
		out, e := q.patch(nil)
		if e != nil || string(out) != body {
			t.Fatal("preservation", e)
		}
	}
}

func TestNZPortableCanonicalAuthority(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("game_library", "overrides.json"))
	if err != nil {
		t.Fatal(err)
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
	if err = json.Unmarshal(raw, &entries); err != nil {
		t.Fatal(err)
	}
	egg := entries[nzPortableSettingsRecipe].Egg
	modules := map[string][]byte{}
	re := regexp.MustCompile(`(?s)cat > \.voltra/([^ ]+) <<'VOLTRA_SOURCE'\n(.*?)\nVOLTRA_SOURCE`)
	for _, m := range re.FindAllStringSubmatch(egg.Scripts.Installation.Script, -1) {
		modules[m[1]] = []byte(m[2] + "\n")
	}
	runtime, installer := modules["id_family_runtime.py"], modules["nzp_install.py"]
	for _, mode := range []string{"vril", "fte_legacy"} {
		path := "/nzportable/" + mode + "/nzp/voltra-server.cfg"
		valid := func(recipe, startup, engine, document string, r, i []byte) bool {
			return nzPortableSettingsAuthority(recipe, startup, engine, document, r, i)
		}
		if !valid(nzPortableSettingsRecipe, egg.Startup, mode, path, runtime, installer) {
			t.Fatal("canonical authority drift")
		}
		for _, args := range [][4]string{{"other", egg.Startup, mode, path}, {nzPortableSettingsRecipe, egg.Startup + " ", mode, path}, {nzPortableSettingsRecipe, egg.Startup, "VRIL", path}, {nzPortableSettingsRecipe, egg.Startup, mode, path + "/../config.cfg"}} {
			if valid(args[0], args[1], args[2], args[3], runtime, installer) {
				t.Fatal("accepted drift", args)
			}
		}
		if valid(nzPortableSettingsRecipe, egg.Startup, mode, path, append(append([]byte{}, runtime...), ' '), installer) || valid(nzPortableSettingsRecipe, egg.Startup, mode, path, runtime, nil) {
			t.Fatal("accepted helper drift")
		}
	}
}
