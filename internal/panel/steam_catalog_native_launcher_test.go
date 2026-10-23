package panel

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Generate only secret-free script bytes from the current renderer for a
// receipt-owned stopped fixture; the staging CLI separately checks runtime state.
func TestSteamCatalogNativeRenderConsoleLauncher(t *testing.T) {
	if os.Getenv("VOLTRA_MANAGED_NATIVE_RENDER") != "1" {
		t.Skip("explicit fixture render only")
	}
	base, err := filepath.Abs(filepath.Join("..", "..", ".local", "managed-steam-native"))
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(base, "current.json"))
	if err != nil {
		t.Fatal(err)
	}
	var r struct {
		RunID     string `json:"run_id"`
		Directory string `json:"directory"`
		Game      string `json:"game"`
	}
	if err = json.Unmarshal(data, &r); err != nil {
		t.Fatal(err)
	}
	if len(r.RunID) != 36 || strings.ContainsAny(r.RunID, "/\\") || r.Game != "7days" || filepath.Clean(r.Directory) != filepath.Join(base, r.RunID) {
		t.Fatal("unexpected owned render scope")
	}
	current, _, err := steamCatalogSevenDaysConsole(9087, "public-nonempty-render-placeholder")
	if err != nil {
		t.Fatal(err)
	}
	// Frozen pre-correction renderer, used only as an exact historical
	// precondition by the disposable-fixture staging tool.
	old := strings.ReplaceAll(sevenDaysLauncher, "8081", "9087")
	address := fmt.Sprintf("0100007F:%04X", 9087)
	old = strings.ReplaceAll(old, "0100007F:1F91", address)
	old = strings.Replace(old, "printf 'shutdown\\r\\n' | timeout 10 nc 127.0.0.1 9087", "timeout 10 rcon -c /home/container/.voltra/sevendays-console.yaml shutdown", 1)
	old = strings.Replace(old, "telnet -E 127.0.0.1 9087 <&0 &", "rcon -c /home/container/.voltra/sevendays-console.yaml <&0 &", 1)
	old = strings.Replace(old, "$2 == \""+address+"\"", fmt.Sprintf("($2 == %q || $2 == %q)", address, fmt.Sprintf("00000000:%04X", 9087)), 1)
	for name, value := range map[string][]byte{"console-launcher-current.sh": current, "console-launcher-original.sh": []byte(old)} {
		if err = os.WriteFile(filepath.Join(r.Directory, name), value, 0600); err != nil {
			t.Fatal(err)
		}
	}
}
