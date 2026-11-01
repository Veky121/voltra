package panel

import (
	"bytes"
	"testing"
)

func TestOHDNativeSettingsSpansAndRefusals(t *testing.T) {
	data := []byte("[/Script/Engine.GameSession]\r\nServerName=\"Owner\"\r\nMaxPlayers=32\r\nPassword=\"private\"\r\n[Mod]\r\n+Items=one\r\n+Items=two\r\n[/Script/RCON.RCONServerSystem]\r\nbEnabled=True\r\nListenPort=7779\r\nPassword=\"secret\"\r\n")
	p, err := parseOHDSettings(data)
	if err != nil {
		t.Fatal(err)
	}
	after, err := p.patch(map[string]string{"/Script/Engine.GameSession/MaxPlayers": "48"})
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(after, bytes.Replace(data, []byte("MaxPlayers=32"), []byte("MaxPlayers=48"), 1)) {
		t.Fatalf("unrelated bytes changed: %q", after)
	}
	for key, value := range map[string]string{"/Script/RCON.RCONServerSystem/ListenPort": "8888", "/Script/Engine.GameSession/MaxPlayers": "0", "/Script/Engine.GameSession/ServerName": "x\nInjected=1"} {
		if _, err := p.patch(map[string]string{key: value}); err == nil {
			t.Fatalf("accepted %s", key)
		}
	}
	duplicate := append(append([]byte(nil), data...), []byte("password=shadow\n")...)
	p, err = parseOHDSettings(duplicate)
	if err != nil {
		return
	}
	if _, err = p.patch(map[string]string{"/Script/RCON.RCONServerSystem/Password": "new"}); err == nil {
		t.Fatal("accepted case duplicate")
	}
}
