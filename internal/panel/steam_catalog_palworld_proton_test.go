package panel

import (
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"testing"
	"voltra/internal/palworldloader"
)

func TestPalworldProtonPreflightIsPrivateAndRequired(t *testing.T) {
	artifact, err := steamCatalogConsoleArtifact("amd64")
	if err != nil {
		t.Fatal(err)
	}
	linux, err := steamPalworldConsole("palworld-native", 25585, artifact)
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(linux)
	if hex.EncodeToString(digest[:]) != "6932125150702342003f466009c5e08b7a1d3384a7f8e0e91ad5ead3245d7ebe" {
		t.Fatal("Native Linux launcher changed during Proton integration")
	}
	proton, err := steamPalworldConsole("palworld-proton", 25585, artifact)
	if err != nil {
		t.Fatal(err)
	}
	text := string(proton)
	if strings.Index(text, "runtime.py verify") < 0 || strings.Index(text, "runtime.py verify") > strings.Index(text, "/usr/bin/xvfb-run") || !strings.Contains(text, "Shutdown 5") {
		t.Fatal("Proton launches before loader verification or lost original stop control")
	}
	inner := string(steamPalworldProtonInner())
	if !strings.Contains(inner, "unset WINEDLLOVERRIDES") || !strings.Contains(inner, "export WINEDLLOVERRIDES='dwmapi=n,b'") || strings.Contains(inner, "winetricks") || strings.Contains(inner, "-serverpassword") || strings.Contains(inner, "--disable-ue4ss") {
		t.Fatal("Proton silently changes loader/credential/license contract")
	}
	spec, _ := steamGameSpecFor("palworld-proton")
	if spec.Image != palworldloader.ProtonImage || spec.UnavailableReason != "" {
		t.Fatal("Immutable Proton image or reviewed public availability changed")
	}
}
