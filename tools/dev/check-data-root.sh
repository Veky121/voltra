#!/bin/sh
set -eu
expected=$1
marker=/state/.voltra-dev-workspace
if [ -f "$marker" ]; then
    [ "$(cat "$marker")" = "$expected" ] || { echo 'Local Wings data belongs to a different workspace.' >&2; exit 1; }
else
    [ -z "$(find /state -mindepth 1 -maxdepth 1 -print -quit)" ] || { echo 'Refusing to adopt existing unmarked Wings data.' >&2; exit 1; }
    printf '%s\n' "$expected" > "$marker"
fi
