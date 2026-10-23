#!/bin/ash
set -eu
apk add --no-cache xz curl tar unzip
cd /mnt/server
curl --fail --location --retry 3 --output openttd-linux.tar.xz https://cdn.openttd.org/openttd-releases/15.3/openttd-15.3-linux-generic-amd64.tar.xz
printf '%s  %s\n' f49eb25d61b00f8f4d332fee02b530ad75552d1efb8f2bb01e7ca5e6540fe059 openttd-linux.tar.xz | sha256sum -c -
tar -xf openttd-linux.tar.xz --strip-components=1
rm openttd-linux.tar.xz
chmod +x openttd
curl --fail --location --retry 3 --output opengfx.zip https://cdn.openttd.org/opengfx-releases/8.0/opengfx-8.0-all.zip
printf '%s  %s\n' 43a0c1dabf39cb865394f3a6cc36d4da5c10ecfaaf55652043104806810903be opengfx.zip | sha256sum -c -
mkdir -p .voltra baseset
gfx_stage=$(mktemp -d .voltra/opengfx.XXXXXX)
trap 'rm -rf "$gfx_stage"' EXIT HUP INT TERM
unzip -o opengfx.zip -d "$gfx_stage"
for archive in "$gfx_stage"/*.tar; do
 test -f "$archive"
 tar --strip-components=1 -C baseset -xf "$archive"
done
rm -rf "$gfx_stage"
trap - EXIT HUP INT TERM
rm opengfx.zip
if [ ! -f openttd.cfg ]; then
 cat > openttd.cfg <<'CONFIG'
[network]
server_name = Voltra OpenTTD
server_port = 3979
server_game_type = local
[gui]
autosave_on_exit = true
CONFIG
fi
echo 'OpenTTD 15.3 and OpenGFX 8.0 installed with verified checksums.'
