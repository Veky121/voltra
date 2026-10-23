#!/usr/bin/env bash
# Compatibility entry point. See WINGS.md for versioned, verified releases.
set -euo pipefail
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
exec bash "$root/tools/install/node.sh" "$@"
