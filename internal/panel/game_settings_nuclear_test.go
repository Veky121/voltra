package panel

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

func TestNuclearSettingsPreservation(t *testing.T) {
	data := []byte("{\r\n  \"ServerName\":\"Old\",\"Password\":\"opaque\",\"MaxPlayers\":20,\"ModdedServer\":false,\"Port\":{\"Value\":27015},\"unknown\":1.234567890123456789\r\n}\r\n")
	p, e := parseNuclearSettings(data)
	if e != nil {
		t.Fatal(e)
	}
	for _, f := range p.fields {
		if f.secret && f.value != "" {
			t.Fatal("secret leaked")
		}
	}
	got, e := p.patch(nil)
	if e != nil || !bytes.Equal(data, got) {
		t.Fatal("no-op changed bytes", e)
	}
	got, e = p.patch(map[string]string{"/ServerName": "New", "/ModdedServer": "true", "/Password": "quote\"value", "/MaxPlayers": "24"})
	if e != nil {
		t.Fatal(e)
	}
	if !bytes.Contains(got, []byte("1.234567890123456789\r\n")) || !bytes.HasSuffix(got, []byte("}\r\n")) {
		t.Fatal("unknown precision or CRLF lost")
	}
	if _, e = parseNuclearSettings(got); e != nil {
		t.Fatal(e)
	}
	for key, value := range map[string]string{"/Port": "1", "/MaxPlayers": "1;quit", "/ServerName": "bad\nline", "/ModdedServer": "1", "/Missing": "x", "/MissionDirectory": "/tmp"} {
		if _, e = p.patch(map[string]string{key: value}); e == nil {
			t.Fatal("unsafe accepted", key)
		}
	}
	absent, _ := parseNuclearSettings([]byte(`{"unknown":true}`))
	if _, e = absent.patch(map[string]string{"/ServerName": "add"}); e == nil {
		t.Fatal("added absent field")
	}
	for _, raw := range []string{`{"ServerName":"a","ServerName":"b"}`, `{"servername":"a"}`, `{"x":{"A":1,"a":2}}`, `{"MaxPlayers":1.0}`, `{"ModdedServer":"false"}`, `{"ServerName":"a"}// comment`} {
		if _, e = parseNuclearSettings([]byte(raw)); e == nil {
			t.Fatal("ambiguous accepted", raw)
		}
	}
}

func TestNuclearCandidateAuthority(t *testing.T) {
	files := map[string][]byte{}
	for name, digest := range nuclearAuthoritySources {
		data, e := os.ReadFile(filepath.Join("../../artifacts/game-parity-20261029/wave63-three-settings-integration/nuclear", filepath.Base(name)))
		if e != nil {
			t.Fatal(e)
		}
		data = bytes.TrimSuffix(data, []byte("\n"))
		if settingsAuthorityHash(data) != digest {
			t.Fatal("pending candidate changed", name)
		}
		files[name] = data
	}
	files["DedicatedServerConfig.json"] = []byte(`{"ServerName":"Existing","Password":"opaque","MaxPlayers":20,"ModdedServer":false}`)
	in := settingsAuthorityInput{Startup: nuclearAuthorityStartup, Files: files, Env: map[string]string{}}
	a, e := nuclearSettingsAuthority(nuclearRecipe, nuclearAuthorityStartup, in)
	if e != nil || a.Path != nuclearSettingsPath {
		t.Fatal(a, e)
	}
	in.Startup += " ; echo unsafe"
	if _, e = nuclearSettingsAuthority(nuclearRecipe, nuclearAuthorityStartup, in); e == nil {
		t.Fatal("startup drift accepted")
	}
	in.Startup = nuclearAuthorityStartup
	in.Env["PYTHONPATH"] = "/tmp"
	if _, e = nuclearSettingsAuthority(nuclearRecipe, nuclearAuthorityStartup, in); e == nil {
		t.Fatal("environment drift accepted")
	}
	delete(in.Env, "PYTHONPATH")
	for name := range nuclearAuthoritySources {
		old := files[name]
		files[name] = append(bytes.Clone(old), '\n')
		if _, e = nuclearSettingsAuthority(nuclearRecipe, nuclearAuthorityStartup, in); e == nil {
			t.Fatal("helper drift accepted", name)
		}
		files[name] = old
	}
	delete(files, "DedicatedServerConfig.json")
	if _, e = nuclearSettingsAuthority(nuclearRecipe, nuclearAuthorityStartup, in); e == nil {
		t.Fatal("path absence accepted")
	}
}
