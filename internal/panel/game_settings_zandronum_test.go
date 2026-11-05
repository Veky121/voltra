package panel

import (
	"bytes"
	"encoding/json"
	"os"
	"regexp"
	"strings"
	"testing"
)

func TestZandronumWebsitePreservation(t *testing.T) {
	for _, old := range []string{`"123"`, `123`, `'123'`} {
		raw := "; unknown\r\n[FileSearch.Directories]\r\nPath=a\r\nPath=b\r\n[AutoExec]\r\nPath=custom.cfg\r\n[Doom.NetServerInfo]\r\nsv_hostname=managed\r\nunknown=7\r\nsv_website = " + old + " ; retain\r\n"
		p, e := parseZandronumSettings([]byte(raw))
		if e != nil {
			t.Fatal(e)
		}
		for _, f := range p.fields {
			if f.key == zandronumWebsiteKey {
				if f.kind != "text" {
					t.Fatal(f)
				}
			} else if f.kind != "readonly" {
				t.Fatal(f)
			}
		}
		same, e := p.patch(nil)
		if e != nil || string(same) != raw {
			t.Fatal("no-op", e)
		}
		site := "https://example.org/a"
		replacement := site
		if old[0] == '"' {
			replacement = `"` + site + `"`
		} else if old[0] == '\'' {
			replacement = "'" + site + "'"
		}
		got, e := p.patch(map[string]string{zandronumWebsiteKey: site})
		if e != nil || string(got) != strings.Replace(raw, old, replacement, 1) {
			t.Fatal("preservation", string(got), e)
		}
		for _, key := range []string{"Doom.NetServerInfo/sv_hostname", "Doom.NetServerInfo/unknown", "AutoExec/Path", "missing", "Other/sv_website"} {
			if _, e = p.patch(map[string]string{key: "x"}); e == nil {
				t.Fatal("forged patch", key)
			}
		}
		for _, value := range []any{true, 12, nil, []any{}, M{}} {
			if _, e := gameSettingsChanges(p.fields, M{zandronumWebsiteKey: value}, M{}, zandronumSettingsPath); e == nil {
				t.Fatal("non-string", value)
			}
		}
		if _, e := p.patch(map[string]string{zandronumWebsiteKey: "https://example.org/#frag"}); (e == nil) != (old[0] == '"' || old[0] == '\'') {
			t.Fatal("comment delimiter policy", old, e)
		}
	}
}

func TestZandronumUnsafeDocumentsAndURLs(t *testing.T) {
	base := "[Doom.NetServerInfo]\nsv_website=123\n"
	for _, raw := range []string{"", "[Other]\nsv_website=x\n", strings.Replace(base, "Doom.NetServerInfo", "doom.netserverinfo", 1), base + "SV_WEBSITE=x\n", base + "sv_website=x\n", base + "[Doom.NetServerInfo]\n", strings.Replace(base, "sv_website=123", "sv_website", 1), strings.Replace(base, "=123", "=\"unterminated", 1), base + "bad\x00=x\n"} {
		if _, e := parseZandronumSettings([]byte(raw)); e == nil {
			t.Fatal("unsafe document", raw)
		}
	}
	p, e := parseZandronumSettings([]byte(base))
	if e != nil {
		t.Fatal(e)
	}
	for _, site := range []string{"ftp://example.org", "//example.org", "https://user:pw@example.org", " https://example.org", "https://example.org ", "https:///path", "https://example.org/\nquit", "https://example.org/\x00", "https://example.org/\u2028", strings.Repeat("x", 2049)} {
		if _, e = p.patch(map[string]string{zandronumWebsiteKey: site}); e == nil {
			t.Fatal("invalid URL", site)
		}
	}
	for _, site := range []string{"", "http://example.org", "https://example.org/a?q=1"} {
		if _, e = p.patch(map[string]string{zandronumWebsiteKey: site}); e != nil {
			t.Fatal(site, e)
		}
	}
}

func TestZandronumFrozenHelpers(t *testing.T) {
	raw, e := os.ReadFile("game_library/overrides.json")
	if e != nil {
		t.Fatal(e)
	}
	var entries map[string]struct {
		Egg struct {
			Startup string
			Scripts struct{ Installation struct{ Script string } }
		}
	}
	if e = json.Unmarshal(raw, &entries); e != nil {
		t.Fatal(e)
	}
	egg := entries[zandronumSettingsRecipe].Egg
	if egg.Startup != zandronumSettingsStartup {
		t.Fatal("startup drift")
	}
	files := map[string][]byte{}
	for _, marker := range []string{"VOLTRA_SOURCE", "VOLTRA_INI"} {
		re := regexp.MustCompile(`(?s)cat > (\.voltra/[^ ]+) <<'` + marker + `'\n(.*?)\n` + marker)
		for _, m := range re.FindAllStringSubmatch(egg.Scripts.Installation.Script, -1) {
			files[m[1]] = []byte(m[2] + "\n")
		}
	}
	if !zandronumSourceHelpers(files) {
		t.Fatal("frozen helper mismatch")
	}
	for name, data := range files {
		files[name] = append(append([]byte{}, data...), ' ')
		if zandronumSourceHelpers(files) {
			t.Fatal("helper drift", name)
		}
		files[name] = data
	}
	if !bytes.Contains(files[".voltra/id_family_runtime.py"], []byte("'-config'")) {
		t.Fatal("config selector missing")
	}
	for _, key := range []string{"sv_maxplayers", "sv_hostname", "sv_broadcast", "sv_updatemaster", "sv_password", "sv_forcepassword", "dmflags", "dmflags2", "zadmflags", "compatflags", "compatflags2", "zacompatflags"} {
		if !zandronumStartupManaged("Doom.NetServerInfo/" + key) {
			t.Fatal(key)
		}
	}
}

func TestZandronumDiscoveryBoundary(t *testing.T) {
	egg := M{"startup": zandronumSettingsStartup}
	if campaignParserRecipe(egg) != zandronumSettingsRecipe {
		t.Fatal("recipe registration")
	}
	if docs := gameSettingsDeclaredDocuments(egg); len(docs) != 0 {
		t.Fatal("unprepared discovery", docs)
	}
	egg["_campaign_parser_path"] = zandronumSettingsPath
	docs := gameSettingsDeclaredDocuments(egg)
	if len(docs) != 1 || docs[0] != zandronumSettingsPath {
		t.Fatal(docs)
	}
	for _, file := range []string{"/other.ini", "/zandronum/Zandronum.ini", "/zandronum/../zandronum/zandronum.ini"} {
		if _, e := parseDiscoveredGameSettings(egg, file, []byte("[Doom.NetServerInfo]\nsv_website=\n")); e == nil {
			t.Fatal("wrong path", file)
		}
	}
	if _, e := parseDiscoveredGameSettings(egg, zandronumSettingsPath, []byte("[Doom.NetServerInfo]\nsv_website=\n")); e != nil {
		t.Fatal(e)
	}
	if campaignParserRecipe(M{"name": "Zandronum", "startup": zandronumSettingsStartup + " "}) != "" {
		t.Fatal("startup drift")
	}
}

func TestZandronumNativeStoppedDocument(t *testing.T) {
	raw, err := os.ReadFile("testdata/zandronum-native-stopped.ini")
	if err != nil {
		t.Fatal(err)
	}
	p, err := parseZandronumSettings(raw)
	if err != nil {
		t.Fatal(err)
	}
	patched, err := p.patch(map[string]string{zandronumWebsiteKey: "https://example.invalid/native"})
	if err != nil {
		t.Fatal(err)
	}
	expected := bytes.Replace(raw, []byte("sv_website=\n"), []byte("sv_website=https://example.invalid/native\n"), 1)
	if !bytes.Equal(patched, expected) {
		t.Fatal("native document unrelated bytes changed")
	}
}
