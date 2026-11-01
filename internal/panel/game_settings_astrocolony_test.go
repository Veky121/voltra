package panel

import (
	"bytes"
	"strings"
	"testing"
)

func TestAstroColonyTypedPatch(t *testing.T) {
	data := []byte("\ufeff;owner\r\n[" + astrocolonySection + "]\r\nServerPassword=private\r\nMapName=Colony\r\nSeed=113\r\nMaxPlayers=5\r\nShouldLoadLatestSavegame=True\r\nAdminList=76561199104220463\r\nSharedTechnologies=1\r\nOxygenConsumption=1\r\nFreeConstruction=0\r\nAutosaveInterval=5.0 ;minutes\r\nAutosavesCount=10\r\nSandbox=True\r\nUnlimitedResourceStack=False\r\n+Unknown=one\r\n+Unknown=two\r\n")
	p, e := parseAstroColonySettings(data)
	if e != nil {
		t.Fatal(e)
	}
	if len(p.fields) != 13 {
		t.Fatal(len(p.fields))
	}
	if !p.fields[0].secret {
		t.Fatal("unmasked password")
	}
	changes := map[string]string{astrocolonySection + "/MapName": "New colony", astrocolonySection + "/MaxPlayers": "7", astrocolonySection + "/AutosaveInterval": "2.5", astrocolonySection + "/Sandbox": "0"}
	got, e := p.patch(changes)
	if e != nil {
		t.Fatal(e)
	}
	want := string(data)
	for _, pair := range [][2]string{{"MapName=Colony", "MapName=New colony"}, {"MaxPlayers=5", "MaxPlayers=7"}, {"AutosaveInterval=5.0", "AutosaveInterval=2.5"}, {"Sandbox=True", "Sandbox=0"}} {
		want = strings.Replace(want, pair[0], pair[1], 1)
	}
	if string(got) != want {
		t.Fatal("unrelated bytes changed")
	}
	unchanged, e := p.patch(nil)
	if e != nil || !bytes.Equal(data, unchanged) {
		t.Fatal("no-op changed bytes")
	}
	for key, value := range map[string]string{"Seed": "2147483648", "AutosaveInterval": "NaN", "Sandbox": "yes", "MapName": "bad\nSeed=1", "Port": "7777", "Absent": "1"} {
		if b, e := p.patch(map[string]string{astrocolonySection + "/" + key: value}); e == nil || b != nil {
			t.Fatalf("accepted %s", key)
		}
	}
}
func TestAstroColonyAmbiguity(t *testing.T) {
	for _, body := range []string{"Seed=1\nseed=2\n", "+Seed=1\n", "Seed=1\n[" + strings.ToLower(astrocolonySection) + "]\nSeed=2", "Sandbox=maybe", "Seed=1\x00"} {
		if _, e := parseAstroColonySettings([]byte("[" + astrocolonySection + "]\n" + body)); e == nil {
			t.Fatal("accepted ambiguity")
		}
	}
}
