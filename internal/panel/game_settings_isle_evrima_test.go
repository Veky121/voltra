package panel

import (
	"bytes"
	"os"
	"strings"
	"testing"
)

func TestIsleEvrimaRetainedFixture(t *testing.T) {
	data, e := os.ReadFile("../../artifacts/game-parity-20261029/isle-evrima-settings/retained-Game.ini")
	if e != nil {
		t.Fatal(e)
	}
	p, e := parseIsleEvrimaSettings(data)
	if e != nil {
		t.Fatal(e)
	}
	for _, f := range p.fields {
		if f.secret && f.value != "" {
			t.Fatal("secret exposed")
		}
		if strings.Contains(f.key, "Rcon") || strings.Contains(f.key, "Queue") {
			t.Fatal("managed role exposed")
		}
	}
	next, e := p.patch(map[string]string{isleEvrimaSection + "/ServerName": "Changed", isleEvrimaSection + "/bEnableHumans": "true"})
	if e != nil {
		t.Fatal(e)
	}
	want := bytes.Replace(data, []byte("ServerName=Owned fixture"), []byte("ServerName=Changed"), 1)
	want = bytes.Replace(want, []byte("bEnableHumans=false"), []byte("bEnableHumans=true"), 1)
	if !bytes.Equal(want, next) {
		t.Fatal("unrelated bytes changed")
	}
	noop, e := p.patch(nil)
	if e != nil || !bytes.Equal(noop, data) {
		t.Fatal("no-op changed bytes")
	}
	for _, key := range []string{"RconPassword", "MapName", "QueuePort", "Missing", "+ServerName", "servername"} {
		if _, e := p.patch(map[string]string{isleEvrimaSection + "/" + key: "bad"}); e == nil {
			t.Fatal("accepted", key)
		}
	}
	for _, value := range []string{"bad\nInjected=true", "bad;comment", "bad#comment", "(value)", "[section]", "bad=alias", "bad\x00"} {
		if _, e := p.patch(map[string]string{isleEvrimaSection + "/ServerName": value}); e == nil {
			t.Fatal("injection accepted")
		}
	}
}
func TestIsleEvrimaAmbiguity(t *testing.T) {
	base := "[" + isleEvrimaSection + "]\nServerName=One\n"
	for _, tail := range []string{"ServerName=Two\n", "servername=Two\n", "+ServerName=Two\n", "!ServerName=ClearArray\n", "[" + isleEvrimaSection + "]\n", "MaxPlayerCount=1e2\n", "bEnableHumans=perhaps\n"} {
		if _, e := parseIsleEvrimaSettings([]byte(base + tail)); e == nil {
			t.Fatal("accepted ambiguous fixture", tail)
		}
	}
	p, e := parseIsleEvrimaSettings([]byte(base))
	if e != nil {
		t.Fatal(e)
	}
	if len(p.fields) != 1 {
		t.Fatal("seeded missing values")
	}
}
