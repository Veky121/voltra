#!/bin/sh
set -eu
visibility=${SERVER_VISIBILITY:-auto}
case "$visibility" in
  auto) case "${srv_advertise:-${SRV_ADVERTISE:-false}}" in true) visibility=public;; false) visibility=local;; *) echo 'srv_advertise must be true or false' >&2; exit 1;; esac;;
  local|public|invite-only) ;;
  *) echo 'SERVER_VISIBILITY must be auto, local, public or invite-only' >&2; exit 1;;
esac
# Native config saves must not broaden credential-file permissions.
# Validate every known target before changing any config bytes or modes.
for native_config in openttd.cfg openttd.cfg.new private.cfg private.cfg.new secrets.cfg secrets.cfg.new; do
  test ! -L "$native_config" || { echo 'Native config symlink refused' >&2; exit 1; }
  test ! -e "$native_config" || test -f "$native_config" || { echo 'Native config must be a regular file' >&2; exit 1; }
done
test -f openttd.cfg
umask 077
for native_config in openttd.cfg openttd.cfg.new private.cfg private.cfg.new secrets.cfg secrets.cfg.new; do
  if test -f "$native_config"; then chmod 600 "$native_config"; fi
done
# Atomic managed-key update; retain all other settings, saves and comments.
tmp=$(mktemp ./openttd.cfg.XXXXXX)
trap 'rm -f "$tmp"' EXIT HUP INT TERM
awk -v value="$visibility" '
  function emit() { if(network && !written) {print "server_game_type = " value; written=1} }
  /^[ \t]*\[/ {emit(); network=($0 ~ /^[ \t]*\[network\][ \t]*$/); if(network) seen=1}
  network && /^[ \t]*server_game_type[ \t]*=/ {if(!written) print "server_game_type = " value; written=1; next}
  {print}
  END {emit(); if(!seen) print "[network]\nserver_game_type = " value}
' openttd.cfg > "$tmp"
chmod 600 "$tmp"
mv "$tmp" openttd.cfg
trap - EXIT HUP INT TERM
for saved in /home/container/.local/share/openttd/save/autosave/exit.sav /home/container/.openttd/save/autosave/exit.sav /home/container/save/autosave/exit.sav; do
  if [ -f "$saved" ]; then exec ./openttd -D -c openttd.cfg -g "$saved"; fi
done
exec ./openttd -D -c openttd.cfg
