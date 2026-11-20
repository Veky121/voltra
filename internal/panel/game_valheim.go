package panel

import (
	"context"
	"voltra/internal/gamesettings"
)

// The stock image evaluates STARTUP in its PID 1 shell. Install the trap in
// that shell so Wings' TERM reaches Valheim as INT and waits for its save.
const valheimStartup = `bash .voltra/valheim-start.sh & trap 'kill -INT "$!"; wait "$!"' TERM INT; wait "$!"`

// Values are read as data, never sourced or evaluated as shell. The fixed
// launcher keeps passwords out of the stored startup command and console UI.
const valheimLauncher = `#!/bin/bash
set -eu
name=Voltra
world=Dedicated
password=
public=false
while IFS='=' read -r key value || [ -n "$key" ]; do
 case "$key" in
  name) name=$value ;;
  world) world=$value ;;
  password) password=$value ;;
  public) public=$value ;;
 esac
done < .voltra/valheim.properties
test "${#password}" -ge 5
test "${#password}" -le 20
visibility=0
if [ "$public" = true ]; then visibility=1; fi
export LD_LIBRARY_PATH="./linux64:${LD_LIBRARY_PATH:-}"
exec ./valheim_server.x86_64 -nographics -batchmode -name "$name" -port "$SERVER_PORT" -world "$world" -password "$password" -public "$visibility" -savedir /home/container/saves
`

func (a *App) valheimAfterInstall(ctx context.Context, server, settings M) error {
	if err := a.quickSetupMkdirAll(ctx, server, "/.voltra"); err != nil {
		return err
	}
	// Restore the application launcher on repair; retain operator settings.
	if err := a.quickSetupWrite(ctx, server, "/.voltra/valheim-start.sh", []byte(valheimLauncher)); err != nil {
		return err
	}
	_, exists, err := a.quickSetupRead(ctx, server, gamesettings.ValheimSettingsPath)
	if err != nil || exists {
		return err
	}
	password, err := a.unseal(str(settings["password_encrypted"]))
	if err != nil {
		return err
	}
	patch, err := quickValidateSettings("valheim", M{"name": settings["name"], "password": password, "world": "Dedicated", "public": false})
	if err != nil {
		return err
	}
	content, err := gamesettings.ValheimPatch(nil, patch)
	if err != nil {
		return err
	}
	if err = a.quickSetupMkdirAll(ctx, server, "/saves"); err != nil {
		return err
	}
	return a.quickSetupWrite(ctx, server, gamesettings.ValheimSettingsPath, content)
}
