package panel

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"os/exec"
	"regexp"
	"strings"
	"testing"
	"time"
)

// Opt-in Linux shell execution against a cached helper image. Package setup is
// explicitly stubbed; this proves the emitted staging script and helper bytes,
// not package availability, Wings preparation, Steam access or native startup.
func TestPrivateSteamPreparationLinuxStaging(t *testing.T) {
	if os.Getenv("VOLTRA_PRIVATE_PREPARE_LINUX_TEST") != "1" {
		t.Skip("opt-in cached Docker Linux staging fixture")
	}
	var script string
	for _, entry := range gameTemplates().Entries {
		if privateTemplateApp(entry) != 0 {
			prepared, err := privatePreparationEntry(entry)
			if err != nil {
				t.Fatal(err)
			}
			script = str(asMap(asMap(prepared.Egg["scripts"])["installation"])["script"])
			break
		}
	}
	want := map[string]string{}
	pattern := regexp.MustCompile(`(?s)cat > (\.voltra/[^ ]+) <<'VOLTRA_LIGHT_GAMES_SOURCE'\n(.*?)\nVOLTRA_LIGHT_GAMES_SOURCE`)
	for _, match := range pattern.FindAllStringSubmatch(script, -1) {
		sum := sha256.Sum256([]byte(match[2] + "\n"))
		want[match[1]] = hex.EncodeToString(sum[:])
	}
	if len(want) != 5 {
		t.Fatalf("expected five canonical helpers, got %d", len(want))
	}
	prefix := "set -euo pipefail\nvoltra_package_calls=0\napt-get() { voltra_package_calls=$((voltra_package_calls+1)); return 0; }\nreadonly -f apt-get\n"
	verify := "\npython3 - <<'VOLTRA_PREPARATION_CHECK'\nimport hashlib,json\nfrom pathlib import Path\nroot=Path('/mnt/server')\nassert not (root/'BSDS.x86_64').exists()\nassert sorted(p.name for p in root.iterdir())==['.voltra']\nprint(json.dumps({str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in (root/'.voltra').iterdir()}))\nVOLTRA_PREPARATION_CHECK\n"
	ctx, cancel := context.WithTimeout(context.Background(), 40*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "docker", "run", "--rm", "--pull", "never", "--network", "none", "--read-only", "--memory", "256m", "--cpus", "1", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--tmpfs", "/mnt/server:rw,size=8m", "--tmpfs", "/tmp:rw,size=1m", "-i", "python:3.13-slim", "bash", "-s")
	managedNativeHideWindow(cmd)
	cmd.Stdin = strings.NewReader(prefix + script + "\ntest \"$voltra_package_calls\" -eq 2\n" + verify)
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("Linux staging failed: %v %s", err, output)
	}
	lines := strings.Split(strings.TrimSpace(string(output)), "\n")
	var got map[string]string
	if json.Unmarshal([]byte(lines[len(lines)-1]), &got) != nil || len(got) != len(want) {
		t.Fatal("invalid staging identity report")
	}
	for name, digest := range want {
		if got[name] != digest {
			t.Fatal("staged helper differs from emitted canonical bytes", name)
		}
	}
	t.Logf("Executed Linux staging script; %d helper identities match; packages stubbed; no network or publisher content", len(got))
}
