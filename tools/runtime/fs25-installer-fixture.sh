#!/bin/bash
# Exercises real shell control flow with isolated fake Wine, never a live game.
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
task_dir=$(mktemp -d)
trap 'rm -rf "$task_dir"' EXIT
export DOCS_DIR="$task_dir/data" DLC_DIR="$task_dir/dlc" GAME_SERIAL='FAKE-TEST'
export FS25_LIB="$root/internal/panel/game_library/fs25/lib"
mkdir -p "$DOCS_DIR/pdlc" "$DLC_DIR" "$task_dir/bin"
export PATH="$task_dir/bin:$PATH"
cat > "$task_dir/bin/wine" <<'WINE'
#!/bin/bash
case "$1" in
 taskkill) exit 0;;
 *Success*) printf 'new complete payload' > "$DOCS_DIR/pdlc/Success.dlc"; exit 0;;
 *Empty*) : > "$DOCS_DIR/pdlc/Empty.dlc"; exit 0;;
 *Timeout*) printf partial > "$DOCS_DIR/pdlc/Timeout.dlc"; sleep 60;;
esac
WINE
printf '#!/bin/sh\nexit 1\n' > "$task_dir/bin/xdotool"
chmod +x "$task_dir/bin/wine" "$task_dir/bin/xdotool"
source <(sed '/^# ---- Base game install/,$d' "$FS25_LIB/install-game.sh")
for product in Success Empty Timeout; do
 installer="$DLC_DIR/FarmingSimulator25_${product}_1_2_1_0_ESD.exe"
 printf '%s' "$product" > "$installer"
 hash=$(sha256sum "$installer" | cut -d' ' -f1)
 printf 'old working payload' > "$DOCS_DIR/pdlc/${product}.dlc"
 if [ "$product" = Timeout ]; then DLC_TIMEOUT=1; else DLC_TIMEOUT=30; fi
 if install_one_dlc "$installer" "$product" "$hash"; then
   [ "$product" = Success ] || { echo 'Failure incorrectly accepted'; exit 1; }
   test -s "$DLC_DIR/.pending-$hash"
   test "$(cat "$DOCS_DIR/pdlc/Success.dlc")" = 'new complete payload'
   test "$(cat "$DOCS_DIR/pdlc/.voltra-update/Success.dlc")" = 'old working payload'
 else
   [ "$product" != Success ] || { echo 'Success incorrectly rejected'; exit 1; }
   test "$(cat "$DOCS_DIR/pdlc/${product}.dlc")" = 'old working payload'
   test ! -f "$DLC_DIR/.pending-$hash"
 fi
done
echo 'FS25 shell fixture passed: same-name update, empty payload rollback, timeout rollback.'
