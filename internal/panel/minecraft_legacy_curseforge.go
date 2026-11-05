package panel

import (
	"crypto/sha256"
	_ "embed"
	"encoding/base64"
	"encoding/hex"
	"strings"
)

//go:embed game_library/minecraft-legacy-curseforge.sh
var minecraftLegacyCurseForgeShell string

// Only wrap the exact imported installer. Administrator scripts stay untouched.
func minecraftLegacyCurseForgeInstaller(script string) string {
	canonical := strings.ReplaceAll(script, "\r\n", "\n")
	sum := sha256.Sum256([]byte(canonical))
	if hex.EncodeToString(sum[:]) != "39e23984d71e13b7162497ef5914a4bdb0e3f28e51ffc12ed86f1bd11a6c9156" {
		return script
	}
	// The original helper uses a fixed scratch path; confine it to staging too.
	canonical = strings.ReplaceAll(canonical, "local tmpdir=/mnt/server/tmp", "local tmpdir=\"${SERVER_DIR}/tmp\"")
	wrapper := strings.Replace(minecraftLegacyCurseForgeShell, "# VOLTRA_SHARED_INSTALLER", minecraftInstallPython, 1)
	return strings.Replace(wrapper, "VOLTRA_ORIGINAL_BASE64", base64.StdEncoding.EncodeToString([]byte(canonical)), 1)
}
