package panel

import (
	"bytes"
	"testing"
)

func TestAAPGWave28Preservation(t *testing.T) {
	original := []byte("\xef\xbb\xbf; operator\r\n[Engine.GameReplicationInfo]\r\nServerName=America's Army\r\n[AAGame.AAGameReplicationInfo]\r\nbDefaultHardcoreMode = false  \r\nMapList=One\r\nMapList=Two\r\nUnknown=(X=1,Y=2)\r\n[Engine.AccessControl]\r\nAdminPassword=existing-secret\r\n")
	parsed, err := parseAAPGSettings(original)
	if err != nil {
		t.Fatal(err)
	}
	unchanged, err := parsed.patch(nil)
	if err != nil || !bytes.Equal(original, unchanged) {
		t.Fatal("no-op changed bytes", err)
	}
	updated, err := parsed.patch(map[string]string{"AAGame.AAGameReplicationInfo/bDefaultHardcoreMode": "true"})
	if err != nil {
		t.Fatal(err)
	}
	expected := bytes.Replace(original, []byte("= false  "), []byte("= true  "), 1)
	if !bytes.Equal(updated, expected) {
		t.Fatal("unowned bytes changed")
	}
	for _, f := range parsed.fields {
		if f.key == "Engine.AccessControl/AdminPassword" && !f.secret {
			t.Fatal("credential not masked")
		}
	}
	for _, change := range []map[string]string{{"Unknown": "x"}, {"Engine.GameReplicationInfo/ServerName": "x"}, {"AAGame.AAGameReplicationInfo/bDefaultHardcoreMode": "1"}, {"Engine.AccessControl/AdminPassword": "x\nInjected=true"}} {
		if _, err := parsed.patch(change); err == nil {
			t.Fatal("unsafe patch accepted")
		}
	}
}

func TestAAPGWave28Refusals(t *testing.T) {
	for _, s := range []string{
		"[Engine.AccessControl]\nGamePassword=a\ngamepassword=b\n",
		"[Engine.AccessControl]\n+GamePassword=a\n",
		"[AAGame.AAGameReplicationInfo]\nbDefaultHardcoreMode=perhaps\n",
		"[Engine.AccessControl\nGamePassword=a\n",
	} {
		if _, err := parseAAPGSettings([]byte(s)); err == nil {
			t.Fatal("unsafe document accepted")
		}
	}
}
