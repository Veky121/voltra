package panel

import (
	"bytes"
	"os"
	"strings"
	"testing"
)

func TestNitroxPublisherSyntaxFixture(t *testing.T) {
	data, err := os.ReadFile("testdata/game-settings/game-parity-20261029/nitrox-settings-source/authoritative-syntax.cfg")
	if err != nil {
		t.Fatal(err)
	}
	p, err := parseNitroxSettings(data)
	if err != nil {
		t.Fatal(err)
	}
	if len(p.fields) != 8 {
		t.Fatalf("got %d controls", len(p.fields))
	}
	got, err := p.patch(nil)
	if err != nil || !bytes.Equal(data, got) {
		t.Fatal("fixture roundtrip changed")
	}
}

func TestNitroxLiteralPreservation(t *testing.T) {
	original := "\ufeff# publisher comments\r\nServerPort=28020\r\nServerPassword=literal;#=credential\r\nAdminPassword=secret\r\nSeed=operator\r\nPostSaveCommandPath=/operator/hook\r\nUnknown=[a,b]\r\nSaveInterval=120000\r\nDisableAutoSave=False\r\nGameMode=SURVIVAL"
	p, err := parseNitroxSettings([]byte(original))
	if err != nil {
		t.Fatal(err)
	}
	if len(p.fields) != 3 {
		t.Fatalf("unexpected exposed controls: %d", len(p.fields))
	}
	unchanged, err := p.patch(nil)
	if err != nil || string(unchanged) != original {
		t.Fatal("no-op changed bytes")
	}
	got, err := p.patch(map[string]string{"DisableAutoSave": "True", "SaveInterval": "1000", "GameMode": "HARDCORE"})
	if err != nil {
		t.Fatal(err)
	}
	want := strings.ReplaceAll(strings.ReplaceAll(strings.ReplaceAll(original, "DisableAutoSave=False", "DisableAutoSave=True"), "SaveInterval=120000", "SaveInterval=1000"), "GameMode=SURVIVAL", "GameMode=HARDCORE")
	if string(got) != want {
		t.Fatal("unrelated bytes changed")
	}
	for _, change := range []map[string]string{{"ServerPort": "1234"}, {"ServerPassword": "replacement"}, {"MaxBackups": "2"}, {"GameMode": "SURVIVAL\nServerPort=1"}, {"SaveInterval": "999"}, {"DisableAutoSave": "False # comment"}} {
		if b, e := p.patch(change); e == nil || b != nil {
			t.Fatal("unsafe change accepted")
		}
	}
	if !bytes.Equal(unchanged, []byte(original)) {
		t.Fatal("input changed")
	}
}

func TestNitroxBoundsAndAmbiguity(t *testing.T) {
	for _, input := range []string{"SaveInterval=999", "MaxConnections=0", "MaxBackups=-1", "InitialSyncTimeout=2147483648", "GameMode=1", "SerializerMode=XML", "DisableConsole=yes", "SaveInterval=1000\nsaveinterval=2000", "ServerPort=1\nserverport=2", "AdminPassword=a\nADMINPASSWORD=b", "x=1\nx=2", "\xff"} {
		if _, err := parseNitroxSettings([]byte(input)); err == nil {
			t.Errorf("accepted %q", input)
		}
	}
	for _, input := range []string{"SaveInterval=1000", "MaxConnections=2147483647", "MaxBackups=0", "InitialSyncTimeout=-2147483648", "DefaultPlayerPerm=CONSOLE", "SerializerMode=PROTOBUF", "disableconsole=True"} {
		p, err := parseNitroxSettings([]byte(input))
		if err != nil || len(p.fields) != 1 {
			t.Errorf("rejected %q: %v", input, err)
		}
	}
}
