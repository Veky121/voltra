package panel

import (
	"os"
	"strings"
	"testing"
)

func TestMinecraftLegacyCurseForgeInstaller(t *testing.T) {
	original, err := os.ReadFile("testdata/minecraft-legacy-curseforge.sh")
	if err != nil {
		t.Fatal(err)
	}
	wrapped := minecraftLegacyCurseForgeInstaller(string(original))
	if wrapped == string(original) || !strings.Contains(wrapped, "pack_content_transaction") || strings.Contains(wrapped, "VOLTRA_ORIGINAL_BASE64") {
		t.Fatal("Original imported CurseForge installer was not wrapped")
	}
	if got := minecraftLegacyCurseForgeInstaller(string(original) + "\n# administrator edit"); got != string(original)+"\n# administrator edit" {
		t.Fatal("Custom script changed")
	}
	if got := minecraftLegacyCurseForgeInstaller(wrapped); got != wrapped {
		t.Fatal("Already wrapped script changed")
	}
}
