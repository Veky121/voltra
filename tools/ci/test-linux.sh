#!/usr/bin/env bash
set -euo pipefail

# Installer tests enforce root ownership through every ancestor. /tmp and the
# hosted runner's home intentionally cannot satisfy that production constraint.
# Exercise the real checks in a disposable root-owned tree on the CI runner.
test_root=$(sudo mktemp -d /var/lib/voltra-ci.XXXXXX)
[[ "$test_root" == /var/lib/voltra-ci.* ]]
trap 'sudo rm -rf -- "$test_root"' EXIT
sudo env "TMPDIR=$test_root" "GOCACHE=$test_root/go-build" \
  "GOMODCACHE=$(go env GOMODCACHE)" "$(command -v go)" test "$@"
