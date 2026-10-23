package panel

import (
	"context"
	"fmt"
)

const sevenDaysSettingsPath = "/serverconfig.xml"
const sevenDaysStartup = "exec bash .voltra/sevendays-start.sh"

// The game does not consume console commands on stdin. Keep its telnet console
// private inside the container and bridge Wings stdin to it. PID 1 waits for
// the game to finish saving after the console connection closes.
const sevenDaysLauncher = `#!/bin/bash
set -eu
mkdir -p logs saves
export LD_LIBRARY_PATH=".:${LD_LIBRARY_PATH:-}"
./7DaysToDieServer.x86_64 -configfile=/home/container/serverconfig.xml -UserDataFolder=/home/container/saves -quit -batchmode -nographics -dedicated -logfile /home/container/logs/latest.log &
game_pid=$!
console_pid=
shutdown_game() {
 trap - TERM INT
 if kill -0 "$game_pid" 2>/dev/null; then
  if ! printf 'shutdown\r\n' | timeout 10 nc 127.0.0.1 8081 >/dev/null; then
   kill -INT "$game_pid" 2>/dev/null || true
  fi
 fi
 wait "$game_pid" || true
 if [ -n "$console_pid" ]; then kill "$console_pid" 2>/dev/null || true; fi
}
trap shutdown_game TERM INT
console_ready() {
 awk '$2 == "0100007F:1F91" && $4 == "0A" {found=1} END {exit !found}' /proc/net/tcp
}
for attempt in $(seq 1 240); do
 if ! kill -0 "$game_pid" 2>/dev/null; then wait "$game_pid"; exit 1; fi
 if console_ready; then break; fi
 sleep 1
done
if ! console_ready; then shutdown_game; exit 1; fi
echo VOLTRA_7DAYS_CONSOLE_READY
telnet -E 127.0.0.1 8081 <&0 &
console_pid=$!
wait "$console_pid" || true
wait "$game_pid"
`

func (a *App) sevenDaysAfterInstall(ctx context.Context, server, settings M) error {
	_, initialized, err := a.quickSetupRead(ctx, server, "/.voltra/sevendays-initialized.txt")
	if err != nil || initialized {
		return err
	}
	content, exists, err := a.quickSetupRead(ctx, server, sevenDaysSettingsPath)
	if err != nil {
		return err
	}
	if !exists {
		return bad("Steam did not install serverconfig.xml. Verify the game before starting.")
	}
	allocation, err := a.one(ctx, "SELECT port FROM allocations WHERE id=$1", server["allocation_id"])
	if err != nil {
		return err
	}
	password := ""
	if encrypted := str(settings["password_encrypted"]); encrypted != "" {
		password, err = a.unseal(encrypted)
		if err != nil {
			return err
		}
	}
	patch := map[string]string{"ServerName": str(settings["name"]), "ServerPassword": password, "ServerMaxPlayerCount": fmt.Sprint(num(settings["max_players"])), "ServerPort": str(allocation["port"]), "ServerVisibility": "0", "TelnetEnabled": "true", "TelnetPort": "8081", "TelnetPassword": "", "WebDashboardEnabled": "false"}
	content, err = quickPatchXMLProperties(content, "ServerSettings", patch)
	if err != nil {
		return err
	}
	for _, folder := range []string{"/.voltra", "/saves", "/logs"} {
		if err = a.quickSetupMkdirAll(ctx, server, folder); err != nil {
			return err
		}
	}
	if err = a.quickSetupWrite(ctx, server, "/.voltra/sevendays-start.sh", []byte(sevenDaysLauncher)); err != nil {
		return err
	}
	if err = a.quickSetupWrite(ctx, server, sevenDaysSettingsPath, content); err != nil {
		return err
	}
	configuration, _, err := a.steamCatalogLoad(ctx, server)
	if err != nil {
		return err
	}
	if err = a.steamCatalogApplyConfiguration(ctx, server, configuration, nil); err != nil {
		return err
	}
	return a.quickSetupWrite(ctx, server, "/.voltra/sevendays-initialized.txt", []byte("initialized\n"))
}
