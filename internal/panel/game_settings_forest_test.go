package panel

import (
	"bytes"
	"os"
	"strings"
	"testing"
)

func TestForestEmittedFixture(t *testing.T) {
	raw, err := os.ReadFile("../../artifacts/game-parity-20261029/forest-settings-owner/emitted-config.cfg")
	if err != nil {
		t.Fatal(err)
	}
	p, err := parseForestSettings(raw)
	if err != nil {
		t.Fatal(err)
	}
	if len(p.fields) != 4 {
		t.Fatalf("fields: %v", p.fields)
	}
	got, err := p.patch(nil)
	if err != nil || !bytes.Equal(raw, got) {
		t.Fatal("no-op changed bytes", err)
	}
	for _, f := range p.fields {
		if f.key == "enableVAC" && (f.kind != "boolean" || f.on != "on" || f.off != "off") {
			t.Fatal("boolean metadata")
		}
	}
	got, err = p.patch(map[string]string{"serverName": "Fixture forest", "serverPlayers": "8", "enableVAC": "on", "difficulty": "Hard"})
	if err != nil {
		t.Fatal(err)
	}
	again, err := parseForestSettings(got)
	if err != nil || len(again.fields) != 4 {
		t.Fatal("round trip", err)
	}
	for _, key := range []string{"serverPassword", "serverPasswordAdmin", "serverSteamAccount", "initType", "saveFolderPath", "serverIP", "serverGamePort", "slot", "missing"} {
		if _, err := p.patch(map[string]string{key: "x"}); err == nil {
			t.Fatal("accepted protected", key)
		}
	}
}
func TestForestBytePreservation(t *testing.T) {
	raw := []byte("\xef\xbb\xbf// header\r\nunknown \xff\r\nunknown second\r\n\tserverPlayers\t5  // keep\r\nserverPassword opaque-secret\r\nserverName Original\n")
	p, err := parseForestSettings(raw)
	if err != nil {
		t.Fatal(err)
	}
	raw[0] = 0 // parser must own its input
	got, err := p.patch(map[string]string{"serverPlayers": "9"})
	if err != nil {
		t.Fatal(err)
	}
	want := []byte("\xef\xbb\xbf// header\r\nunknown \xff\r\nunknown second\r\n\tserverPlayers\t9  // keep\r\nserverPassword opaque-secret\r\nserverName Original\n")
	if !bytes.Equal(got, want) {
		t.Fatalf("preservation mismatch %q", got)
	}
	for _, f := range p.fields {
		if strings.Contains(f.value, "secret") {
			t.Fatal("credential exposed")
		}
	}
}
func TestForestRefusals(t *testing.T) {
	for _, s := range []string{"serverName x\nserverName y", "servername x", "serverPassword x\nServerPassword y", "savefolderpath /x", "serverPlayers 01", "serverPlayers -1", "serverPlayers 1;bad", "enableVAC true", "difficulty hard", "serverName x\x00", "serverName x\ry"} {
		if _, err := parseForestSettings([]byte(s)); err == nil {
			t.Fatalf("accepted %q", s)
		}
	}
	p, err := parseForestSettings([]byte("serverName Original\nserverPlayers 5\nenableVAC off\ndifficulty Normal"))
	if err != nil {
		t.Fatal(err)
	}
	for key, values := range map[string][]string{"serverName": {"x\ny", "x//y", "x;bad", "x\"y", "x\ty", " x"}, "serverPlayers": {"0", "01", "2147483648", "1.5"}, "difficulty": {"hard", "New"}, "enableVAC": {"true", "ON"}} {
		for _, v := range values {
			if _, err := p.patch(map[string]string{key: v}); err == nil {
				t.Fatalf("accepted %s=%q", key, v)
			}
		}
	}
}
