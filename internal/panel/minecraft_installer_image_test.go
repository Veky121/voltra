package panel

import (
	"context"
	"os"
	"strings"
	"testing"
)

func TestMinecraftManagedInstallerUpgradePreservesCustomizations(t *testing.T) {
	a := cliTestApp(t)
	ctx := context.Background()
	egg, err := a.gameLibraryMinecraftLoaderEgg(ctx, "fabric")
	if err != nil || str(egg["script_container"]) != minecraftInstallerImage {
		t.Fatal("new managed installer is not pinned", err)
	}
	current := str(egg["script_install"])
	previous := strings.Replace(current, "    # Wings mounts /tmp as a small tmpfs. Pack archives plus the Java bootstrap\n    # must use the server disk budget, not exhaust that tmpfs during extraction.\n    with tempfile.TemporaryDirectory(prefix=\"voltra-minecraft-\", dir=work_directory or root) as temporary:", "    with tempfile.TemporaryDirectory(prefix=\"voltra-minecraft-\", dir=work_directory) as temporary:", 1)
	if previous == current {
		t.Fatal("historical staging fixture was not constructed")
	}
	old, err := os.ReadFile("testdata/minecraft-install-pre-streaming.sh")
	if err != nil {
		t.Fatal(err)
	}
	preStreaming := string(old)
	preStreamingScratch := strings.Replace(preStreaming, "    # Wings mounts /tmp as a small tmpfs. Pack archives plus the Java bootstrap\n    # must use the server disk budget, not exhaust that tmpfs during extraction.\n    with tempfile.TemporaryDirectory(prefix=\"voltra-minecraft-\", dir=work_directory or root) as temporary:", "    with tempfile.TemporaryDirectory(prefix=\"voltra-minecraft-\", dir=work_directory) as temporary:", 1)
	if !minecraftKnownHistoricalInstaller(preStreaming) || !minecraftKnownHistoricalInstaller(preStreamingScratch) || preStreaming == preStreamingScratch || strings.Contains(preStreaming, "def verified_archive(") {
		t.Fatal("historical installer identities do not match the published fixture")
	}
	for _, tc := range []struct{ name, image, script, want, wantScript string }{
		{"legacy_default", "ghcr.io/pterodactyl/installers:debian", current, minecraftInstallerImage, current},
		{"legacy_staging", "ghcr.io/pterodactyl/installers:debian", previous, minecraftInstallerImage, current},
		{"legacy_crlf", "ghcr.io/pterodactyl/installers:debian", strings.ReplaceAll(previous, "\n", "\r\n"), minecraftInstallerImage, current},
		{"pre_streaming_disk", minecraftInstallerImage, preStreaming, minecraftInstallerImage, current},
		{"pre_streaming_missing_final_newline", minecraftInstallerImage, strings.TrimRight(preStreaming, "\n"), minecraftInstallerImage, current},
		{"pre_streaming_crlf", minecraftInstallerImage, strings.ReplaceAll(preStreaming, "\n", "\r\n"), minecraftInstallerImage, current},
		{"pre_streaming_tmp", "ghcr.io/pterodactyl/installers:debian", preStreamingScratch, minecraftInstallerImage, current},
		{"historical_custom_script", minecraftInstallerImage, preStreaming + "\necho administrator-owned\n", minecraftInstallerImage, preStreaming + "\necho administrator-owned\n"},
		{"historical_custom_image", "example.invalid/custom:latest", preStreaming, "example.invalid/custom:latest", preStreaming},
		{"custom_image", "example.invalid/custom:latest", current, "example.invalid/custom:latest", current},
		{"custom_script", "ghcr.io/pterodactyl/installers:debian", "echo administrator-owned", "ghcr.io/pterodactyl/installers:debian", "echo administrator-owned"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if err := a.exec(ctx, "UPDATE eggs SET script_container=$2,script_install=$3,name='Custom display name' WHERE id=$1", egg["id"], tc.image, tc.script); err != nil {
				t.Fatal(err)
			}
			got, err := a.gameLibraryMinecraftLoaderEgg(ctx, "fabric")
			if err != nil || str(got["script_container"]) != tc.want || str(got["script_install"]) != tc.wantScript || str(got["name"]) != "Custom display name" {
				t.Fatal("installer migration lost administrator edits or failed to upgrade", err)
			}
		})
	}
}
