#!/bin/bash

CURRENT_DIRECTORY=$(pwd)

# Add the current directory to the LD_LIBRARY_PATH
export LD_LIBRARY_PATH="${CURRENT_DIRECTORY}:${LD_LIBRARY_PATH}"

# Resolve executable — Windows builds append .x86_64, Linux builds do not
if [[ -f "${CURRENT_DIRECTORY}/Puck.x86_64" ]]; then
    EXECUTABLE="${CURRENT_DIRECTORY}/Puck.x86_64"
else
    EXECUTABLE="${CURRENT_DIRECTORY}/Puck"
fi

# Set executable permissions
chmod +x "${EXECUTABLE}"

exec "${EXECUTABLE}" "$@"
