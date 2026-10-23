#!/bin/bash
set -euo pipefail
if [[ "${EULA_ACCEPTED:-false}" != "true" ]]; then
    echo "Accept the Minecraft EULA before installing."
    exit 1
fi
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends python3 ca-certificates
mkdir -p /mnt/server
cd /mnt/server
python3 - <<'VOLTRA_MINECRAFT_PY'
# VOLTRA_PYTHON
VOLTRA_MINECRAFT_PY
