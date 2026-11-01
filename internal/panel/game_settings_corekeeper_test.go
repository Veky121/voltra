package panel

import (
	"bytes"
	"testing"
)

func TestCoreKeeperPreservesPrivateAndUnknownBytes(t *testing.T) {
	original := []byte("{\n  \"gameId\":\"private\", \"password\":\"private\", \"worldSeed\":\"\", \"hashedWorldSeed\":0, \"worldMode\":0, \"unknown\": [1,2], \"maxNumberPlayers\":8\n}\n")
	p, e := parseCoreKeeperSettings(original)
	if e != nil || len(p.fields) != 1 {
		t.Fatal(e)
	}
	got, e := p.patch(map[string]string{"/maxNumberPlayers": "7"})
	if e != nil {
		t.Fatal(e)
	}
	want := bytes.Replace(original, []byte("Players\":8"), []byte("Players\":7"), 1)
	if !bytes.Equal(got, want) {
		t.Fatal("unrelated bytes changed")
	}
	for _, changes := range []map[string]string{{"/password": "x"}, {"/worldMode": "1"}, {"/maxNumberPlayers": "101"}, {"/maxNumberPlayers": "7.0"}} {
		if _, e = p.patch(changes); e == nil {
			t.Fatal("unsafe edit accepted")
		}
	}
	for _, b := range []string{`{"maxNumberPlayers":8,"maxNumberPlayers":7}`, `{"maxNumberPlayers":"8"}`, `{"maxNumberPlayers":8} trailing`} {
		if _, e = parseCoreKeeperSettings([]byte(b)); e == nil {
			t.Fatal("ambiguous config accepted")
		}
	}
}
