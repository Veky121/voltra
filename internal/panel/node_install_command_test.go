package panel

import (
	"os/exec"
	"strings"
	"testing"
)

func TestNodeInstallCommandPinnedVerifiedAndNoCredential(t *testing.T) {
	t.Setenv("NODE_RELEASE_VERSION", "v1.2.3-rc.1")
	command := nodeInstallCommand("https://panel.example.com", false)
	for _, want := range []string{"/releases/download/v1.2.3-rc.1/", "WINGS-SHA256SUMS", "sha256sum -c script.sha256; sudo bash", "mktemp -d", "'v1.2.3-rc.1' 'https://panel.example.com'"} {
		if !strings.Contains(command, want) {
			t.Fatalf("missing %q in command %q", want, command)
		}
	}
	if strings.Contains(command, "latest") || strings.Contains(command, "curl |") {
		t.Fatal("unsafe installer command")
	}
	if bash, err := exec.LookPath("bash"); err == nil {
		if output, err := exec.Command(bash, "-n", "-c", command).CombinedOutput(); err != nil {
			t.Fatalf("shell syntax: %v: %s", err, output)
		}
	}
}

func TestNodeInstallCommandRejectsUnpinnedRelease(t *testing.T) {
	for _, version := range []string{"", "latest", "v1.2.3/../../x", "v1.2.3';echo injected", "main", "v01.2.3"} {
		t.Setenv("NODE_RELEASE_VERSION", version)
		if command := nodeInstallCommand("https://panel.example.com", false); strings.Contains(command, "curl") || !strings.Contains(command, "not configured") {
			t.Fatalf("unsafe version %q: %q", version, command)
		}
	}
}

func TestNodeInstallCommandRecoveryUsesExistingBinary(t *testing.T) {
	t.Setenv("NODE_RELEASE_VERSION", "")
	if command := nodeInstallCommand("https://panel.example.com", true); command != "sudo voltra-node setup --reconnect" {
		t.Fatal(command)
	}
}
