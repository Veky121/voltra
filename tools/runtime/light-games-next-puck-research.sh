#!/bin/bash
set -euo pipefail
export DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_ROLL_FORWARD=Major DOTNET_NOLOGO=1
if [ ! -f /research/ilspy/ilspycmd ]; then dotnet tool install ilspycmd --tool-path /research/ilspy --version 9.1.0.7988; fi
mkdir -p /research/api
for name in IPuckPlugin ServerConfig ServerManager ServerManagerController ModManager Plugin TimeoutManager PhysicsManager PhysicsManagerController PlayerInput PlayerInputController ApplicationManager SettingsManager TCPServer TCPServerPreviewRequest TCPServerPreviewResponse TCPServerMessage TCPServerMessageType; do
 /research/ilspy/ilspycmd --disable-updatecheck -r /volume/Puck_Data/Managed -t "$name" /volume/Puck_Data/Managed/Puck.dll > "/research/api/$name.cs" || exit 1
done
/research/ilspy/ilspycmd --disable-updatecheck -l c /volume/Puck_Data/Managed/Puck.dll > /research/api/classes.txt
printf 'Publisher API inspection complete; no game process started.\n'
