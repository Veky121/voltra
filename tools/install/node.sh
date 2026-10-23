#!/usr/bin/env bash
# Public source: Veky121/voltra/tools/install/node.sh. No remote script execution.
set -euo pipefail
umask 077
fail() { printf 'Voltra installer: %s\n' "$*" >&2; exit 1; }
[[ $# == 2 || ( $# == 3 && $3 == --replace-existing ) ]] || fail 'usage: sudo bash install-node.sh vVERSION https://panel.example.com [--replace-existing]'
version=$1
panel=${2%/}
replace=${3:-}
[[ $version =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z]+([.-][0-9A-Za-z]+)*)?$ ]] || fail 'version must be an explicit vMAJOR.MINOR.PATCH or prerelease tag'
[[ -n $panel && $panel != *[[:space:]]* && $panel != *'@'* && $panel != *'#'* && $panel != *'?'* && $panel != *\\* && $panel != *"'"* ]] || fail 'Panel URL must not contain credentials, whitespace, query or fragment'
case $panel in
  https://?*) ;;
  http://*) authority=${panel#http://}; authority=${authority%%/*}; [[ $authority =~ ^(localhost|127\.0\.0\.1|\[::1\])(:[0-9]{1,5})?$ ]] || fail 'HTTP is allowed only on loopback for development' ;;
  *) fail 'Panel URL requires HTTPS' ;;
esac
[[ ${EUID:-$(id -u)} == 0 ]] || fail 'run as root'
[[ $(uname -s) == Linux ]] || fail 'only Linux is supported'
case $(uname -m) in x86_64|amd64) arch=amd64 ;; aarch64|arm64) arch=arm64 ;; *) fail 'supported architectures: amd64 and arm64' ;; esac
for cmd in curl sha256sum systemctl docker install mktemp awk od; do
  command -v "$cmd" >/dev/null || fail "missing $cmd; install prerequisites using your distribution package manager, then rerun"
done
[[ -d /run/systemd/system ]] || fail 'boot this host with systemd first'
{ exec 3<>/dev/tty; } 2>/dev/null || fail 'an interactive terminal is required'
[[ -t 3 ]] || fail 'an interactive terminal is required'
existing=false
for file in /usr/local/bin/wings /usr/bin/wings /usr/local/bin/voltra-node /etc/pterodactyl/config.yml /etc/voltra; do
  [[ ! -e $file && ! -L $file ]] || existing=true
done
command -v wings >/dev/null && existing=true
command -v voltra-node >/dev/null && existing=true
for unit in wings.service voltra-wings.service voltra-node.service; do
  if systemctl cat "$unit" >/dev/null 2>&1 || systemctl is-active --quiet "$unit" || systemctl is-enabled --quiet "$unit" 2>/dev/null; then existing=true; fi
done
if $existing; then
  [[ $replace == --replace-existing ]] || fail 'existing Wings or Voltra installation detected. No changes made. Read WINGS.md migration instructions; replacement requires --replace-existing and operator acknowledgement. For enrollment recovery run sudo voltra-node setup --reconnect.'
  for unit in wings.service voltra-wings.service voltra-node.service; do
    if systemctl is-active --quiet "$unit"; then fail "stop $unit yourself during a planned maintenance window before replacement; this installer never stops games or services"; fi
    state=$(systemctl show "$unit" --property=ActiveState --value 2>/dev/null || true)
    case $state in
      ''|inactive|failed) ;;
      *) fail "$unit is $state; wait until it is fully stopped before replacement" ;;
    esac
  done
  printf '%s\n' 'Replacing daemon binaries can affect every game on this node when you next start Wings.' 'Back up binaries and private configurations first. Existing data and configuration will be retained.' 'Type REPLACE STOPPED NODE BINARIES to proceed:' >&3
  IFS= read -r acknowledgement <&3
  [[ $acknowledgement == 'REPLACE STOPPED NODE BINARIES' ]] || fail 'replacement cancelled'
fi
docker info >/dev/null 2>&1 || fail 'Docker is unavailable; configure/start it yourself before installing'
staging=$(mktemp -d)
trap 'rm -rf -- "$staging"' EXIT
base="https://github.com/Veky121/voltra/releases/download/$version"
download() {
  curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' \
    --connect-timeout 15 --max-time 300 "$base/$1" -o "$staging/$1" || fail "download failed: $1 at $version; both release workflows must finish before installation"
}
verify() {
  local manifest=$1 asset=$2 expected
  expected=$(awk -v name="$asset" '$2 == name && length($1) == 64 && $1 !~ /[^0-9a-f]/ { print $1; count++ } END { if (count != 1) exit 1 }' "$staging/$manifest") || fail "missing or duplicate checksum for $asset"
  printf '%s  %s\n' "$expected" "$staging/$asset" | sha256sum --check --status || fail "checksum mismatch: $asset; nothing installed"
}
printf 'Downloading and verifying Voltra %s for Linux %s.\n' "$version" "$arch"
download WINGS-SHA256SUMS
download NODE-SHA256SUMS
for asset in "voltra-wings-linux-$arch" WINGS-LICENSE wings-provenance.json; do
  download "$asset"
  verify WINGS-SHA256SUMS "$asset"
done
download "voltra-node-linux-$arch"
verify NODE-SHA256SUMS "voltra-node-linux-$arch"
for asset in "voltra-wings-linux-$arch" "voltra-node-linux-$arch"; do
  [[ $(od -An -tx1 -N4 "$staging/$asset" | tr -d ' \n') == 7f454c46 ]] || fail "not a Linux executable: $asset"
done
# All artifacts pass verification before touching installation paths.
install -d -m 0755 /usr/local/bin /usr/local/share/voltra
install -m 0644 "$staging/WINGS-LICENSE" /usr/local/share/voltra/WINGS-LICENSE
install -m 0644 "$staging/wings-provenance.json" /usr/local/share/voltra/wings-provenance.json
if $existing; then
  backup=$(mktemp -d /usr/local/share/voltra/binary-backup.XXXXXXXX)
  for binary in wings voltra-node; do
    [[ ! -e /usr/local/bin/$binary ]] || cp -p -- "/usr/local/bin/$binary" "$backup/$binary"
  done
  printf 'Previous /usr/local/bin binaries saved in %s\n' "$backup"
fi
install -m 0755 "$staging/voltra-wings-linux-$arch" /usr/local/bin/.voltra-wings.new
install -m 0755 "$staging/voltra-node-linux-$arch" /usr/local/bin/.voltra-node.new
mv -f /usr/local/bin/.voltra-wings.new /usr/local/bin/wings
mv -f /usr/local/bin/.voltra-node.new /usr/local/bin/voltra-node
if $existing; then
  printf '%s\n' 'Binaries replaced. No services started, stopped or restarted. Existing configuration retained.' 'Review your service ExecStart paths before starting services during your maintenance window.'
  exit 0
fi
printf '%s\n' "Open the node wizard at $panel. Paste its connection string into the hidden setup prompt, then approve the matching verification code." 'Approved setup creates and enables voltra-wings.service and voltra-node.service.'
/usr/local/bin/voltra-node setup </dev/tty
printf '%s\n' 'Check: sudo systemctl status voltra-wings voltra-node' 'Boot: sudo systemctl enable voltra-wings voltra-node' 'Logs: sudo journalctl -u voltra-wings -u voltra-node -n 100'
