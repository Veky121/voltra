#!/bin/bash
# Runs inside Wings' installation container, never inside the live game process.
set -euo pipefail
umask 077
cd /mnt/server
if [ "$(id -u)" -ne 0 ]; then
    echo '[fs25/install] Installation needs the standard root installer container.' >&2
    exit 1
fi
# Keep deployed scripts readable by the server even if package preparation fails.
server_uid=$(stat -c %u /mnt/server)
server_gid=$(stat -c %g /mnt/server)
chown -R "$server_uid:$server_gid" .voltra/fs25 .voltra/scripts

# The installation image must default to root so Wings can read its private script.
# Install the same Wine major version as the runtime, before opening its prefix.
if ! command -v wine >/dev/null 2>&1; then
    echo '[fs25/install] Preparing Wine 11 installation environment...'
    export DEBIAN_FRONTEND=noninteractive
    dpkg --add-architecture i386
    apt-get update -qq
    apt-get install -y -qq --no-install-recommends ca-certificates curl gnupg
    mkdir -p /etc/apt/keyrings
    curl --fail --location --retry 3 https://dl.winehq.org/wine-builds/winehq.key -o /tmp/winehq.asc
    gpg --batch --yes --dearmor -o /etc/apt/keyrings/winehq-archive.key /tmp/winehq.asc
    curl --fail --location --retry 3 https://dl.winehq.org/wine-builds/debian/dists/bookworm/winehq-bookworm.sources -o /etc/apt/sources.list.d/winehq-bookworm.sources
    chmod 0644 /etc/apt/keyrings/winehq-archive.key /etc/apt/sources.list.d/winehq-bookworm.sources
    apt-get update -qq
    apt-get install -y -qq --install-recommends winehq-stable=11.0.0.0~bookworm-1 wine-stable=11.0.0.0~bookworm-1 wine-stable-amd64=11.0.0.0~bookworm-1 wine-stable-i386:i386=11.0.0.0~bookworm-1
    apt-get install -y -qq --no-install-recommends nodejs xvfb xauth xdotool p7zip-full procps util-linux
fi
server_uid=$(stat -c %u /mnt/server)
server_gid=$(stat -c %g /mnt/server)
if ! getent passwd "$server_uid" >/dev/null; then
    getent group "$server_gid" >/dev/null || groupadd -g "$server_gid" container
    useradd -u "$server_uid" -g "$server_gid" -d /home/container -M container
fi
# Existing Wine prefixes contain this absolute data symlink. Keep the same
# /home/container path in the installer instead of rewriting saved game paths.
if [ ! /home/container -ef /mnt/server ]; then
    [ ! -e /home/container.image-home ] || { echo '[fs25/install] Unexpected installer home directory.' >&2; exit 1; }
    mkdir -p /home
    if [ -e /home/container ]; then mv /home/container /home/container.image-home; fi
    ln -s /mnt/server /home/container
fi
mkdir -p installer dlc data/mods data/pdlc
chown "$server_uid:$server_gid" installer dlc data data/mods data/pdlc .voltra
chown -R "$server_uid:$server_gid" .voltra/fs25 .voltra/scripts
echo '[fs25/install] Reinstall: game first, then DLCs. Saves, mods and licences are retained.'
exec setpriv --reuid="$server_uid" --regid="$server_gid" --clear-groups \
    env HOME=/home/container USER=container LOGNAME=container \
    bash /home/container/.voltra/fs25/start.sh --install-only
