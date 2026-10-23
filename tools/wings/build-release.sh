#!/usr/bin/env bash
# Linux build only. Output is never installed or executed as a daemon.
set -euo pipefail
export LC_ALL=C TZ=UTC CGO_ENABLED=0 GOTOOLCHAIN=local
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
[[ $# == 3 ]] || { echo 'usage: build-release.sh CLEAN_WINGS_CHECKOUT OUTPUT_DIR vVERSION' >&2; exit 1; }
source=$(cd -- "$1" && pwd)
mkdir -p -- "$2"
output=$(cd -- "$2" && pwd)
version=$3
[[ $version =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z]+([.-][0-9A-Za-z]+)*)?$ ]] || exit 1
node "$root/tools/wings/apply-release.mjs" "$source"
cd -- "$source"
go test ./server -run 'TestVoltraInstall' -count=1
for arch in amd64 arm64; do
  GOOS=linux GOARCH=$arch go build -mod=readonly -trimpath -buildvcs=false \
    -ldflags "-s -w -buildid= -X github.com/pterodactyl/wings/system.Version=${version#v}-voltra-upstream1.13.3" \
    -o "$output/voltra-wings-linux-$arch" .
done
cp LICENSE "$output/WINGS-LICENSE"
cp voltra-provenance.json "$output/wings-provenance.json"
cp "$root/tools/install/node.sh" "$output/install-node.sh"
cd -- "$output"
sha256sum voltra-wings-linux-amd64 voltra-wings-linux-arm64 WINGS-LICENSE wings-provenance.json install-node.sh > WINGS-SHA256SUMS
