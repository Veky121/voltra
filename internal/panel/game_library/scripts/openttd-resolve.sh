#!/bin/sh
set -eu
# Publisher manifests use an intentionally small, flat subset of YAML. Match
# the exact archive ID and reject missing, duplicate or malformed SHA-256 data.
resolve_release() {
  category=$1 version=$2 archive=$3 default_version=$4 pinned=$5
  case "$version" in ''|*[!0-9A-Za-z.-]*|.*|*..*) echo 'Invalid release version' >&2; return 1;; esac
  case "$version" in [0-9]*) ;; *) echo 'Release version must begin with a digit' >&2; return 1;; esac
  test "${#version}" -le 40 || return 1
  if [ "$version" = "$default_version" ]; then printf '%s\n' "$pinned"; return; fi
  manifest=$(mktemp)
  if ! curl --fail --location --proto '=https' --proto-redir '=https' --max-time 60 --max-filesize 1048576 --retry 3 "https://cdn.openttd.org/${category}-releases/${version}/manifest.yaml" -o "$manifest"; then rm -f "$manifest"; return 1; fi
  digest=$(awk -v target="$archive" '
    /^- id: / {selected=($3==target); if(selected) matches++}
    selected && /^  sha256sum: / {digest=$2; found++}
    END {if(matches==1 && found==1) print digest; else exit 1}
  ' "$manifest") || { rm -f "$manifest"; return 1; }
  rm -f "$manifest"
  test "${#digest}" -eq 64 || return 1
  case "$digest" in *[!a-f0-9]*) return 1;; esac
  printf '%s\n' "$digest"
}
