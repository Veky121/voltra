package panel

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"
	"voltra/internal/palworldloader"
)

// These are fixed per-server paths. No game input can set a Wine DLL search
// path, prefix, executable or a shell fragment.
func steamPalworldProtonInner() []byte {
	return []byte(`#!/usr/bin/env bash
set -euo pipefail
cd /home/container
prefix=/home/container/.steam/steam/steamapps/compatdata/2394010
client=/home/container/.steam/steam
if [ -n "${WINEDLLOVERRIDES:-}" ] && [ "$WINEDLLOVERRIDES" != 'dwmapi=n,b' ]; then
 printf 'Conflicting Wine DLL overrides require explicit operator review.\n' >&2; exit 71
fi
if [ -n "${STEAM_COMPAT_DATA_PATH:-}" ] && [ "$STEAM_COMPAT_DATA_PATH" != "$prefix" ]; then
 printf 'A different Proton prefix requires explicit operator review.\n' >&2; exit 71
fi
if [ -n "${STEAM_COMPAT_CLIENT_INSTALL_PATH:-}" ] && [ "$STEAM_COMPAT_CLIENT_INSTALL_PATH" != "$client" ]; then
 printf 'A different Steam client directory requires explicit operator review.\n' >&2; exit 71
fi
export STEAM_COMPAT_DATA_PATH="$prefix" STEAM_COMPAT_CLIENT_INSTALL_PATH="$client"
# Resolve every imported Windows runtime library/export before loading UE4SS.
# No Microsoft installer is downloaded and no license is accepted here.
unset WINEDLLOVERRIDES
cd /home/container/.voltra/palworld-loader-tools
/usr/local/bin/proton run /home/container/.voltra/palworld-loader-tools/runtime-probe.exe
cd /home/container
export WINEDLLOVERRIDES='dwmapi=n,b'
exec /usr/local/bin/proton run /home/container/Pal/Binaries/Win64/PalServer-Win64-Shipping.exe "$@"
`)
}

func steamPalworldProtonPreflight() (string, error) {
	code, err := palworldloader.PreflightShell()
	if err != nil {
		return "", err
	}
	inner := steamPalworldProtonInner()
	digest := sha256.Sum256(inner)
	code += fmt.Sprintf("printf '%%s  %%s\\n' '%s' '/home/container/.voltra/palworld-proton-run.sh' | sha256sum -c - >/dev/null\n", hex.EncodeToString(digest[:]))
	return strings.TrimSuffix(code, "\n"), nil
}
