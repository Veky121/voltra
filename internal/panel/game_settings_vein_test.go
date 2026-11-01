package panel

import (
	"bytes"
	"os"
	"strings"
	"testing"
)

func TestVeinNativeScalarPacket(t *testing.T) {
	// Exact preserved runtime fixture from test-frontier-native.py, with opaque
	// precision and unknown secret rows added to test editor noninterference.
	fixture := []byte("\xef\xbb\xbf; operator\r\n[/Script/Engine.GameSession]\r\nMaxPlayers=12\r\n[/Script/Vein.VeinGameSession]\r\nservername=\"Operator server\"\r\nPassword=\"operator-private\"\r\nbPublic=False\r\nbShouldAdvertise=True\r\nBindAddr=0.0.0.0\r\n+AdminSteamIDs=one\r\n+AdminSteamIDs=two\r\nUnknownToken=private\r\nPrecision=9007199254740993.123456789\r\n[OnlineSubsystemSteam]\r\nGameServerQueryPort=28001\r\n")
	original := bytes.Clone(fixture)
	p, e := parseVeinSettings(fixture)
	if e != nil {
		t.Fatal(e)
	}
	if len(p.fields) != 7 {
		t.Fatalf("fields: %v", p.fields)
	}
	for _, f := range p.fields {
		if strings.HasSuffix(f.key, "/Password") && (!f.secret || f.kind != "text") {
			t.Fatal("password metadata")
		}
		if veinSettingManaged(f.key) && f.kind != "readonly" {
			t.Fatal("managed metadata")
		}
		if strings.HasSuffix(f.key, "/bPublic") && f.kind != "boolean" {
			t.Fatal("boolean metadata")
		}
	}
	key := "/Script/Vein.VeinGameSession/servername"
	out, e := p.patch(map[string]string{key: "New name"})
	if e != nil {
		t.Fatal(e)
	}
	want := bytes.Replace(fixture, []byte("\"Operator server\""), []byte("\"New name\""), 1)
	if !bytes.Equal(out, want) || !bytes.Equal(fixture, original) {
		t.Fatal("unexpected byte mutation")
	}
	for _, changes := range []map[string]string{
		{"OnlineSubsystemSteam/GameServerQueryPort": "1234"}, {"/Script/Vein.VeinGameSession/BindAddr": "127.0.0.1"},
		{"/Script/Vein.VeinGameSession/UnknownToken": "oops"}, {key: "bad\nInjected=1"},
		{"/Script/Engine.GameSession/MaxPlayers": "1e2"}, {"/Script/Engine.GameSession/MaxPlayers": "10001"},
		{"/Script/Vein.VeinGameSession/bPublic": "yes"}, {"/Script/Vein.VeinGameSession/Password": strings.Repeat("x", 33)},
	} {
		if _, e := p.patch(changes); e == nil {
			t.Fatalf("accepted %v", changes)
		}
	}
	out, e = p.patch(nil)
	if e != nil || !bytes.Equal(out, fixture) {
		t.Fatal("no-op changed bytes")
	}
}

func TestVeinRefusalAndMissingScalars(t *testing.T) {
	for _, rows := range []string{"ServerName=one\nservername=two\n", "ServerName=one\nServerName=two\n", "+ServerName=one\n", "!Password=ClearArray\n", "Password=\"unterminated\n", "bPublic=maybe\n"} {
		if _, e := parseVeinSettings([]byte("[/Script/Vein.VeinGameSession]\n" + rows)); e == nil {
			t.Fatalf("accepted %q", rows)
		}
	}
	p, e := parseVeinSettings([]byte("; no defaults\n[Other]\nPassword=hidden\n"))
	if e != nil || len(p.fields) != 0 {
		t.Fatal("invented fields", e)
	}
	if _, e = p.patch(map[string]string{"/Script/Vein.VeinGameSession/Password": "new"}); e == nil {
		t.Fatal("seeded missing password")
	}
}

func TestVeinReviewedRuntimeContract(t *testing.T) {
	data, e := os.ReadFile("game_library/scripts/frontier-native.py")
	if e != nil {
		t.Fatal(e)
	}
	for _, token := range []string{"def vein_configuration(", "Vein/Saved/Config/LinuxServer/Game.ini", "if present: continue", "'-Port='+str(p['primary'])", "'-QueryPort='+str(p['QUERY_PORT'])"} {
		if !bytes.Contains(data, []byte(token)) {
			t.Fatalf("review runtime drift: %s", token)
		}
	}
}
