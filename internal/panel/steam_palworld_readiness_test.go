package panel

import (
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"testing"
)

func TestSteamCatalogPalworldProtonReadinessAndNativeBytes(t *testing.T) {
	artifact, err := steamCatalogConsoleArtifact("amd64")
	if err != nil {
		t.Fatal(err)
	}
	native, err := steamPalworldConsole("palworld-native", 25585, artifact)
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(native)
	if hex.EncodeToString(digest[:]) != "6932125150702342003f466009c5e08b7a1d3384a7f8e0e91ad5ead3245d7ebe" {
		t.Fatal("Accepted native Linux launcher bytes changed")
	}
	proton, err := steamPalworldConsole("palworld-proton", 25585, artifact)
	if err != nil {
		t.Fatal(err)
	}
	check := steamPalworldReadiness("palworld-proton", 25585)
	if strings.Count(string(proton), check) != 2 || strings.Contains(string(proton), "nc -z") || !strings.HasPrefix(check, "timeout 1 bash -c ") {
		t.Fatal("Proton readiness must use bounded built-in TCP instead of missing nc")
	}
}
