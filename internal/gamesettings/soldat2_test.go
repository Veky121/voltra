package gamesettings

import "testing"

func TestSoldat2PatchPreservesNativeOperatorBytes(t *testing.T) {
	const source = "; operator\r\n[GameServerConfig]\r\nMaxPlayers=6\r\nDebug=False\r\nUnknownValue=literal\r\n[ConfigUpdater]\r\nVersion=36\r\n"
	p, err := Parse("/autoconfig.ini", []byte(source))
	if err != nil {
		t.Fatal(err)
	}
	p = soldat2SettingsSafety(p)
	if _, err = p.Patch(map[string]string{"GameServerConfig/Debug": "1"}); err == nil {
		t.Fatal("accepted invalid native boolean")
	}
	got, err := p.Patch(map[string]string{"GameServerConfig/Debug": "True"})
	if err != nil {
		t.Fatal(err)
	}
	want := "; operator\r\n[GameServerConfig]\r\nMaxPlayers=6\r\nDebug=True\r\nUnknownValue=literal\r\n[ConfigUpdater]\r\nVersion=36\r\n"
	if string(got) != want {
		t.Fatalf("operator bytes changed: %q", got)
	}
}

func TestSoldat2AuthorityAndAmbiguity(t *testing.T) {
	called := false
	p := soldat2SettingsSafety(Parsed{Fields: []Setting{
		{Key: "GameServerConfig/MaxPlayers", Value: "6"},
		{Key: "ConfigUpdater/Version", Value: "36"},
		{Key: "GameServerConfig/Debug", Value: "False"},
		{Key: "Other/Value", Value: "1"}, {Key: "other/value", Value: "2"},
	}, Patch: func(c map[string]string) ([]byte, error) { called = true; return []byte("preserved source"), nil }})
	for _, key := range []string{"GameServerConfig/MaxPlayers", "ConfigUpdater/Version", "Other/Value", "other/value", "unknown"} {
		if _, err := p.Patch(map[string]string{key: "2"}); err == nil || called {
			t.Fatalf("unsafe patch reached writer: %s", key)
		}
	}
	if p.Fields[2].Kind != "boolean" || p.Fields[2].On != "True" || p.Fields[2].Off != "False" {
		t.Fatal("native boolean encoding lost")
	}
	if _, err := p.Patch(map[string]string{"GameServerConfig/Debug": "True"}); err != nil || !called {
		t.Fatal("operator field refused")
	}
}
