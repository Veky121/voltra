package panel

import (
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
	// Shared readiness now authenticates both variants. Its exact generated
	// hashes belong to TestSteamCatalogPalworldAuthenticatedReadiness; keep
	// this test focused on Proton preflight not leaking into native Linux.
	linuxText := string(linux)
	if strings.Contains(linuxText, "runtime.py verify") || strings.Contains(linuxText, "/usr/bin/xvfb-run") ||
		!strings.Contains(linuxText, "./Pal/Binaries/Linux/PalServer-Linux-Shipping Pal") || !strings.Contains(linuxText, "Shutdown 15") {
		t.Fatal("Proton integration changed native Linux platform or stop controls")
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
