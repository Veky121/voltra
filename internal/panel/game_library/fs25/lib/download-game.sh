#!/bin/bash
set -eu
exec node "${FS25_LIB}/download-game.mjs" "$@"
