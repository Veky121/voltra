package panel

import (
	"bytes"
	"testing"
)

func TestFrozenflameOwnerPatch(t *testing.T) {
	old := []byte(";keep\r\n[/Script/FrozenFlame.GameBalance]\r\nbFreePVP=True;comment\r\nUnknown=secret\r\n")
	p, e := parseFrozenflameSettings(old)
	if e != nil {
		t.Fatal(e)
	}
	got, e := p.patch(map[string]string{"/Script/FrozenFlame.GameBalance/bFreePVP": "False"})
	if e != nil || !bytes.Equal(got, bytes.Replace(old, []byte("True"), []byte("False"), 1)) {
		t.Fatalf("patch %q %v", got, e)
	}
	for k, v := range map[string]string{"/Script/FrozenFlame.GameBalance/bFreePVP": "false", "unknown": "injection"} {
		if _, e = p.patch(map[string]string{k: v}); e == nil {
			t.Fatal("accepted invalid patch")
		}
	}
	p, e = parseFrozenflameSettings([]byte("[/Script/FrozenFlame.GameBalance]\nbFreePVP=True\nbfreepvp=False\n"))
	if e != nil {
		t.Fatal(e)
	}
	if _, e = p.patch(map[string]string{"/Script/FrozenFlame.GameBalance/bFreePVP": "False"}); e == nil {
		t.Fatal("accepted ambiguous alias")
	}
}
