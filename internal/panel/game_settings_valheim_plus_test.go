package panel

import (
	"bytes"
	"os"
	"testing"
)

func TestValheimPlusConfigFixture(t *testing.T) {
	raw, err := os.ReadFile("testdata/game-settings/game-parity-20261029/wave382-valheim-plus-settings/native-valheim-plus.cfg")
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := parseValheimPlusSettings(raw)
	if err != nil || len(parsed.fields) != 7 {
		t.Fatalf("reviewed configuration fields: %v", err)
	}
	same, err := parsed.patch(nil)
	if err != nil || !bytes.Equal(raw, same) {
		t.Fatal("no-op changed configuration bytes", err)
	}
	updated, err := parsed.patch(map[string]string{"Server/maxPlayers": "32"})
	if err != nil || !bytes.Equal(updated, bytes.Replace(raw, []byte("maxPlayers = 10"), []byte("maxPlayers = 32"), 1)) {
		t.Fatal("player limit changed unrelated bytes", err)
	}
	for _, settings := range []map[string]string{
		{"Server/maxPlayers": "0"}, {"Server/maxPlayers": "33"},
		{"Server/enabled": "yes"}, {"Preloader/TargetAssembly": "other"},
	} {
		if _, err := parsed.patch(settings); err == nil {
			t.Fatal("invalid or unmanaged setting accepted")
		}
	}
}

func TestValheimPlusDuplicates(t *testing.T) {
	for _, raw := range []string{"[Server]\nmaxPlayers = 10\nmaxPlayers = 11\n", "[Server]\nenabled = true\nEnabled = false\n"} {
		if _, err := parseValheimPlusSettings([]byte(raw)); err == nil {
			t.Fatal("ambiguous setting accepted")
		}
	}
}
