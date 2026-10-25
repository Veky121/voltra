#!/bin/bash
# Isolated fake installer test. No network, Wine, real serials or game files.
set -eu
task_dir=$(mktemp -d)
trap 'rm -rf "$task_dir"' EXIT
export DOCS_DIR="$task_dir/data" DLC_DIR="$task_dir/dlc" GAME_SERIAL='FAKE-TEST'
mkdir -p "$DOCS_DIR/pdlc" "$DLC_DIR"
source <(sed '/^# ---- Base game install/,$d' /src/internal/panel/game_library/fs25/lib/install-game.sh)
sleep() { /bin/sleep 0.05; }
xdotool() { :; }
wine() {
 case "$1" in
  *success*) printf 'payload' > "$DOCS_DIR/pdlc/actualName.dlc";;
  *empty*) : > "$DOCS_DIR/pdlc/empty.dlc";;
  *timeout*) printf 'partial' > "$DOCS_DIR/pdlc/partial.dlc"; /bin/sleep 10;;
 esac
}
printf installer > "$DLC_DIR/FarmingSimulator25_success.exe"
install_one_dlc "$DLC_DIR/FarmingSimulator25_success.exe" success
test -s "$DOCS_DIR/pdlc/actualName.dlc"
test -s "$DLC_DIR/.installed-$(sha256sum "$DLC_DIR/FarmingSimulator25_success.exe" | cut -d' ' -f1)"
printf empty > "$DLC_DIR/FarmingSimulator25_empty.exe"
if install_one_dlc "$DLC_DIR/FarmingSimulator25_empty.exe" empty; then echo 'empty payload accepted'; exit 1; fi
test ! -f "$DOCS_DIR/pdlc/empty.dlc"
test -f "$DLC_DIR/failed/empty.dlc"
DLC_TIMEOUT=0
printf timeout > "$DLC_DIR/FarmingSimulator25_timeout.exe"
if install_one_dlc "$DLC_DIR/FarmingSimulator25_timeout.exe" timeout; then echo 'timeout accepted'; exit 1; fi
test ! -f "$DOCS_DIR/pdlc/partial.dlc"
test -s "$DLC_DIR/failed/partial.dlc"
echo 'FS25 fake installer checks passed.'
