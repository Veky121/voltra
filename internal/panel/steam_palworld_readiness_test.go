package panel

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"testing"
)

// Historical accepted native launcher SHA256 before authenticated readiness:
// 6932125150702342003f466009c5e08b7a1d3384a7f8e0e91ad5ead3245d7ebe.
// This is historical evidence, not the current launcher contract.
func TestSteamCatalogPalworldAuthenticatedReadiness(t *testing.T) {
	artifact, err := steamCatalogConsoleArtifact("amd64")
	if err != nil {
		t.Fatal(err)
	}
	launchers := map[string]string{}
	for _, variant := range []string{"palworld-native", "palworld-proton"} {
		launcher, err := steamPalworldConsole(variant, 25585, artifact)
		if err != nil {
			t.Fatal(err)
		}
		s := string(launcher)
		if strings.Contains(s, "nc -z") || strings.Contains(s, "/dev/tcp") || !strings.Contains(s, "timeout --kill-after=1 3") || strings.Count(s, "VOLTRA_PALWORLD_CONSOLE_READY") != 1 {
			t.Fatal("readiness contract", variant)
		}
		// Golden updated only after the generated behavior fixture passed.
		golden := map[string]string{"palworld-native": "fef0cae67cc8283bd921aa61eedc97b8d837acfb77c8ad2780b987d2cacc070a", "palworld-proton": "3fcb1f8082ce2f8e75e194d5b5c18156b83a5ed3662a45b209c8181ec0d98b59"}
		if fmt.Sprintf("%x", sha256.Sum256(launcher)) != golden[variant] {
			t.Fatal("current generated launcher hash changed", variant)
		}
		launchers[variant] = s
	}
	script, err := os.ReadFile("testdata/palworld_readiness_fixture.py")
	if err != nil {
		t.Fatal(err)
	}
	input, _ := json.Marshal(launchers)
	command, args := "python3", []string{"-c", string(script)}
	if runtime.GOOS == "windows" {
		command, args = "wsl", []string{"-e", "python3", "-c", string(script)}
	} else if runtime.GOOS != "linux" {
		t.Skip("generated launcher behavior requires Linux process semantics")
	}
	if _, err := exec.LookPath(command); err != nil {
		t.Skipf("Linux fixture runner unavailable: %v", err)
	}
	cmd := exec.Command(command, args...)
	cmd.Stdin = strings.NewReader(string(input))
	output, err := cmd.CombinedOutput()
	t.Log(string(output))
	if err != nil {
		t.Fatalf("synthetic generated shell fixtures: %v", err)
	}
}
