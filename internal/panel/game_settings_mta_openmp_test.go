package panel

import (
	"bytes"
	"encoding/json"
	"os"
	"regexp"
	"testing"
)

func TestGTANativeSettings(t *testing.T) {
	raw := []byte("{\r\n \"language\":\"EN\", \"website\":\"open.mp\",\"password\":\"opaque\",\"n\":123456789012345678901.123456789\r\n}")
	p, e := parseOpenMPNativeSettings(raw)
	if e != nil || len(p.fields) != 2 {
		t.Fatal(e)
	}
	no, e := p.patch(nil)
	if e != nil || !bytes.Equal(raw, no) {
		t.Fatal("no-op")
	}
	edited, e := p.patch(map[string]string{"/language": "NL"})
	if e != nil || !bytes.Equal(edited, bytes.Replace(raw, []byte("\"EN\""), []byte("\"NL\""), 1)) {
		t.Fatal("preservation", e)
	}
	if _, e = parseOpenMPNativeSettings(edited); e != nil {
		t.Fatal(e)
	}
	for _, changes := range []map[string]string{{"/password": "x"}, {"/language": "x\nexit"}, {"/network/port": "x"}} {
		if _, e = p.patch(changes); e == nil {
			t.Fatal("unsafe edit")
		}
	}
	for _, raw := range []string{`{"language":"x","Language":"y"}`, `{"language":"x","language":"y"}`, `{"language":42}`} {
		if _, e = parseOpenMPNativeSettings([]byte(raw)); e == nil {
			t.Fatal(raw)
		}
	}
	m := []byte("<config>\r\n<!-- keep --> <password>opaque</password><serverport>1234</serverport></config>")
	p, e = parseMTANativeSettings(m)
	if e != nil || len(p.fields) != 0 {
		t.Fatal(e)
	}
	no, e = p.patch(nil)
	if e != nil || !bytes.Equal(m, no) {
		t.Fatal("XML preservation")
	}
	if _, e = p.patch(map[string]string{"serverport": "4"}); e == nil {
		t.Fatal("managed port")
	}
	for _, raw := range []string{`<!DOCTYPE config><config/>`, `<config><password/><Password/></config>`} {
		if _, e = parseMTANativeSettings([]byte(raw)); e == nil {
			t.Fatal("unsafe XML")
		}
	}
}

func TestGTAMTAOrdinary(t *testing.T) {
	raw := []byte("<config>\r\n<!--keep--><servername>A &amp; B</servername><maxplayers>32</maxplayers><password>opaque</password></config>")
	p, e := parseMTANativeSettings(raw)
	if e != nil || len(p.fields) != 2 {
		t.Fatal(e)
	}
	got, e := p.patch(map[string]string{"servername": "New <name>"})
	if e != nil || !bytes.Equal(got, bytes.Replace(raw, []byte("A &amp; B"), []byte("New &lt;name&gt;"), 1)) {
		t.Fatal(e, string(got))
	}
}

func TestGTAAuthorityEmitted(t *testing.T) {
	raw, e := os.ReadFile("../../artifacts/game-parity-20261029/wave63-gta-completion/gta_pair-fragment.json")
	if e != nil {
		t.Fatal(e)
	}
	var profiles map[string]struct {
		Egg struct {
			Startup string
			Scripts struct{ Installation struct{ Script string } }
		}
	}
	if e = json.Unmarshal(raw, &profiles); e != nil {
		t.Fatal(e)
	}
	re := regexp.MustCompile(`(?s)cat > \.voltra/([^ ]+) <<'VOLTRA_SOURCE'\n(.*?)\nVOLTRA_SOURCE`)
	for recipe, p := range profiles {
		for _, entry := range gameTemplates().Entries {
			if entry.Path == recipe {
				p.Egg.Startup = str(entry.Egg["startup"])
				p.Egg.Scripts.Installation.Script = str(asMap(asMap(entry.Egg["scripts"])["installation"])["script"])
			}
		}
		in := settingsAuthorityInput{Startup: p.Egg.Startup, Env: map[string]string{"SERVER_PORT": "7777", "VOLTRA_ALLOCATED_PORTS": "7777,7780"}, Files: map[string][]byte{}}
		for _, m := range re.FindAllStringSubmatch(p.Egg.Scripts.Installation.Script, -1) {
			in.Files[".voltra/"+m[1]] = []byte(m[2] + "\n")
		}
		in.Files["openmp/config.json"] = []byte(`{"network":{"port":7777,"bind":"0.0.0.0"}}`)
		in.Files["mtasa/mods/deathmatch/mtaserver.conf"] = []byte(`<config><serverip>auto</serverip><serverport>7777</serverport><httpport>7780</httpport><ase>0</ase></config>`)
		if _, e := ResolveGTANativeAuthority(recipe, []byte(`{}`), in); e != nil {
			t.Fatal(recipe, e)
		}
		for _, mutate := range []func(*settingsAuthorityInput){func(i *settingsAuthorityInput) { i.Startup = "exec /usr/bin/python3 .voltra/gta-runtime.py openmp" }, func(i *settingsAuthorityInput) { i.Files[".voltra/gta-runtime.py"] = []byte("drift") }, func(i *settingsAuthorityInput) { i.Env["VOLTRA_ALLOCATED_PORTS"] = "7780" }} {
			copy := settingsAuthorityInput{Startup: in.Startup, Env: map[string]string{}, Files: map[string][]byte{}}
			for k, v := range in.Env {
				copy.Env[k] = v
			}
			for k, v := range in.Files {
				copy.Files[k] = v
			}
			mutate(&copy)
			if _, e := ResolveGTANativeAuthority(recipe, []byte(`{}`), copy); e == nil {
				t.Fatal("accepted drift")
			}
		}
		if _, e := ResolveGTANativeAuthority(recipe, []byte(`{"config.json":{}}`), in); e == nil {
			t.Fatal("writer")
		}
	}
}
