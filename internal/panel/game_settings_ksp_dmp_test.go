package panel

import (
	"bytes"
	"strings"
	"testing"
)

func TestKspDMPSpans(t *testing.T) {
	raw := []byte("\ufeff# native dialect\r\nserverName=Voltra DMP\r\nmaxPlayers=4\r\ncheats=True\r\nport=28014\r\npassword=hidden-secret\r\nmods=a,b\r\nmods=c\r\nnested={secret:value}\r\n")
	p, e := parseKspDMPSettings(raw)
	if e != nil {
		t.Fatal(e)
	}
	for _, f := range p.fields {
		if strings.Contains(f.value, "secret") {
			t.Fatal("secret exposed")
		}
	}
	b, e := p.patch(nil)
	if e != nil || !bytes.Equal(b, raw) {
		t.Fatal("no-op changed bytes")
	}
	b, e = p.patch(map[string]string{"maxPlayers": "8", "cheats": "False", "serverName": "Changed"})
	if e != nil {
		t.Fatal(e)
	}
	want := bytes.ReplaceAll(bytes.ReplaceAll(bytes.ReplaceAll(raw, []byte("maxPlayers=4"), []byte("maxPlayers=8")), []byte("cheats=True"), []byte("cheats=False")), []byte("serverName=Voltra DMP"), []byte("serverName=Changed"))
	if !bytes.Equal(b, want) {
		t.Fatal("opaque bytes changed")
	}
	if _, e = parseKspDMPSettings(b); e != nil {
		t.Fatal(e)
	}
	for k, v := range map[string]string{"port": "9", "password": "x", "missing": "1", "maxPlayers": "0", "cheats": "yes", "serverName": "x\nport=9"} {
		if _, e = p.patch(map[string]string{k: v}); e == nil {
			t.Fatalf("accepted %s", k)
		}
	}
	for _, s := range []string{"maxPlayers=4\nMaxPlayers=5\n", "maxPlayers=4\nmaxPlayers=5\n", "serverName=hello#literal\n", "serverName=\"quoted\"\n"} {
		if _, e = parseKspDMPSettings([]byte(s)); e == nil {
			t.Fatalf("accepted ambiguity %q", s)
		}
	}
}
func TestKspDMPAuthority(t *testing.T) {
	// LMP can advance the shared source without changing the DMP installer.
	// Authority must recognize the exact helper that this recipe emits.
	helper := wave59CanonicalHelpers(t, kspDMPRecipe)[".voltra/ksp_runtime.py"]
	if len(helper) == 0 {
		t.Fatal("DMP installer does not emit its runtime helper")
	}
	receipt := []byte(`{"game":"dmp","version":"0.3.8.5","source_commit":"8253dc8e4f40e4519c085c3ee223abecd1a52954","runtime":"Microsoft.NETCore.App10","dependency_commits":{"External/SettingsParser":"0a1c1e1666bf94a9069acf1967e64d2679dc27a2"}}`)
	in := settingsAuthorityInput{Startup: kspDMPStartup, Files: map[string][]byte{".voltra/ksp_runtime.py": helper, ".voltra/ksp/dmp-release.json": receipt}}
	if _, e := kspDMPSettingsAuthority(kspDMPRecipe, kspDMPSettingsPath, in); e != nil {
		t.Fatal(e)
	}
	for _, p := range []string{"/config/Settings.txt", "/Config/../Settings.txt", "/Config/Settings.txt/x"} {
		if _, e := kspDMPSettingsAuthority(kspDMPRecipe, p, in); e == nil {
			t.Fatal("path accepted")
		}
	}
	in.Startup += " --config other"
	if _, e := kspDMPSettingsAuthority(kspDMPRecipe, kspDMPSettingsPath, in); e == nil {
		t.Fatal("arg drift")
	}
	in.Startup = kspDMPStartup
	in.Files[".voltra/ksp_runtime.py"] = append(helper, []byte("# drift")...)
	if _, e := kspDMPSettingsAuthority(kspDMPRecipe, kspDMPSettingsPath, in); e == nil {
		t.Fatal("helper drift")
	}
	in.Files[".voltra/ksp_runtime.py"] = helper
	in.Files[".voltra/ksp/dmp-release.json"] = bytes.Replace(receipt, []byte("0.3.8.5"), []byte("0.3.8.6"), 1)
	if _, e := kspDMPSettingsAuthority(kspDMPRecipe, kspDMPSettingsPath, in); e == nil {
		t.Fatal("identity drift")
	}
}
