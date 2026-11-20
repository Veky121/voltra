package gamesettings

import (
	"bytes"
	"strings"
	"testing"
)

func TestVoyagersPreservationAndSecretBoundary(t *testing.T) {
	original := []byte("\ufeff[" + VoyagersSettingsSection + "]\r\n; comment\r\n  HostServerDisplayName = Old  \r\nHostServerPassword=opaque;secret\r\nMaxPlayers=10\r\nAutosaveTimerSeconds=300\r\n+Unknown=one\r\n+Unknown=two\r\n[Other]\r\nx=y")
	p, e := parseVoyagersSettings(original)
	if e != nil {
		t.Fatal(e)
	}
	if len(p.Fields) != 4 || p.Fields[1].Value != "" || !p.Fields[1].Secret {
		t.Fatal("secret metadata or ordered controls")
	}
	got, e := p.Patch(map[string]string{VoyagersSettingsSection + "/HostServerDisplayName": "New", VoyagersSettingsSection + "/AutosaveTimerSeconds": "120"})
	if e != nil {
		t.Fatal(e)
	}
	want := bytes.Replace(original, []byte("= Old"), []byte("= New"), 1)
	want = bytes.Replace(want, []byte("Seconds=300"), []byte("Seconds=120"), 1)
	if !bytes.Equal(got, want) {
		t.Fatalf("unexpected rewrite: %q", got)
	}
	if !bytes.Contains(got, []byte("opaque;secret")) {
		t.Fatal("secret changed")
	}
	noop, e := p.Patch(nil)
	if e != nil || !bytes.Equal(noop, original) {
		t.Fatal("no-op changed bytes")
	}
	for _, value := range []string{"", "replacement"} {
		if b, e := p.Patch(map[string]string{VoyagersSettingsSection + "/HostServerPassword": value}); e == nil || b != nil {
			t.Fatal("password action accepted")
		}
	}
}

func TestVoyagersAmbiguityRefusal(t *testing.T) {
	base := "[" + VoyagersSettingsSection + "]\nMaxPlayers=10\n"
	cases := []string{base + "MaxPlayers=9", base + "maxplayers=9", base + "+MaxPlayers=9", base + "MaxPlayers[]=9", base + "!MaxPlayers=ClearArray", base + "[" + VoyagersSettingsSection + "]\n", strings.Replace(base, "BoatGame", "boatgame", 1), base + "\x00", base + "broken", base + "HostServerDisplayName=\"quoted\"", base + "AutosaveTimerSeconds=9", base + "HostServerDisplayName=bad;comment"}
	for i, s := range cases {
		t.Run(string(rune('a'+i)), func(t *testing.T) {
			if _, e := parseVoyagersSettings([]byte(s)); e == nil {
				t.Fatal("accepted ambiguity")
			}
		})
	}
	if _, e := parseVoyagersSettings([]byte{0xff}); e == nil {
		t.Fatal("invalid encoding")
	}
}

func TestVoyagersExistingOnlyAndInjection(t *testing.T) {
	p, e := parseVoyagersSettings([]byte("[" + VoyagersSettingsSection + "]\nHostServerDisplayName=Old\nMaxPlayers=10\nAutosaveTimerSeconds=300\n"))
	if e != nil {
		t.Fatal(e)
	}
	for key, values := range map[string][]string{"HostServerDisplayName": {"x\ny=z", "x\rZ", "x;z", "x#z", "x\"z", "x\\z", "x=y", " x", ""}, "MaxPlayers": {"0", "11", "01", "1e0", "+1"}, "AutosaveTimerSeconds": {"9", "901", "1.5"}, "Missing": {"x"}} {
		for _, value := range values {
			if b, e := p.Patch(map[string]string{VoyagersSettingsSection + "/" + key: value}); e == nil || b != nil {
				t.Fatalf("accepted %s %q", key, value)
			}
		}
	}
	for _, s := range []string{"", "[Other]\nx=y\n"} {
		p, e := parseVoyagersSettings([]byte(s))
		if e != nil || len(p.Fields) != 0 {
			t.Fatal("seeded fields")
		}
		if _, e = p.Patch(map[string]string{VoyagersSettingsSection + "/MaxPlayers": "5"}); e == nil {
			t.Fatal("inserted key")
		}
	}
	for _, values := range []map[string]string{{"MaxPlayers": "1", "AutosaveTimerSeconds": "10"}, {"MaxPlayers": "10", "AutosaveTimerSeconds": "900"}} {
		c := map[string]string{}
		for k, v := range values {
			c[VoyagersSettingsSection+"/"+k] = v
		}
		b, e := p.Patch(c)
		if e != nil {
			t.Fatal(e)
		}
		if _, e = parseVoyagersSettings(b); e != nil {
			t.Fatal(e)
		}
	}
}
