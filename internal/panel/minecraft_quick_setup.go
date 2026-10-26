package panel

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
)

// Wings reapplies property mappings at startup. Save the corresponding editable
// variables along with the file, otherwise a successful Quick setup save is
// silently replaced by the values chosen during installation.
func (a *App) minecraftQuickUpdate(ctx context.Context, server M, file, revision string, patch map[string]string) error {
	conn, err := a.DB.Acquire(ctx)
	if err != nil {
		return err
	}
	defer steamUnlock(conn)
	if err = steamSessionLock(ctx, conn, "voltra:server-mutation:"+str(server["uuid"])); err != nil {
		return err
	}
	if err = a.quickSetupStopped(ctx, server); err != nil {
		return err
	}
	content, exists, err := a.quickSetupRead(ctx, server, file)
	if err != nil {
		return err
	}
	if revision != quickRevision("minecraft", file, content, exists) {
		return APIError{409, "QuickSetupRevisionConflict", "These settings changed since you opened Quick setup. Reload before saving."}
	}
	if !exists {
		return APIError{409, "QuickSetupConfigMissing", "The game has not created its configuration yet. Start it once, stop it, then reload Quick setup."}
	}
	egg, err := a.serverEffectiveEgg(ctx, server)
	if err != nil {
		return err
	}
	env, err := a.serverEnvironment(ctx, server)
	if err != nil {
		return err
	}
	filePatch := patch
	if minecraftManagedLegacyEnums(egg, env, str(server["image"])) {
		filePatch = map[string]string{}
		for key, value := range patch {
			filePatch[key] = minecraftPropertyEnumNumber(key, value)
		}
	}
	updated, err := quickPatchProperties(content, filePatch)
	if err != nil {
		return err
	}
	find := asMap(asMap(asMap(egg["config_files"])[strings.TrimPrefix(file, "/")])["find"])
	mapping := map[string]string{"max-players": "MAX_PLAYERS", "gamemode": "GAME_MODE", "difficulty": "DIFFICULTY"}
	changes := M{}
	for key, value := range patch {
		if configured, mapped := find[key]; mapped {
			variable := mapping[key]
			if variable == "" || str(configured) != "{{server.build.env."+variable+"}}" {
				return bad("This setting is controlled by the server template. Change its startup setting or ask an administrator to update the template.")
			}
			changes[variable] = value
		}
	}
	variables := []M{}
	if len(changes) > 0 {
		variables, err = a.query(ctx, `SELECT ev.id,ev.env_variable,ev.rules,ev.user_editable,sv.id IS NOT NULL AS overridden,sv.variable_value FROM egg_variables ev LEFT JOIN server_variables sv ON sv.variable_id=ev.id AND sv.server_id=$1 WHERE ev.egg_id=$2 ORDER BY ev.id`, server["id"], server["egg_id"])
		if err != nil {
			return err
		}
		for key, value := range changes {
			env[key] = value
		}
		selected := []M{}
		found := map[string]bool{}
		for _, variable := range variables {
			key := str(variable["env_variable"])
			if value, changing := changes[key]; changing {
				if !boolean(variable["user_editable"]) {
					return bad("This setting is locked by the server template.")
				}
				if err = a.validateEggValue(ctx, value, true, str(variable["rules"]), env, key); err != nil {
					return err
				}
				found[key] = true
				selected = append(selected, variable)
			}
		}
		if len(found) != len(changes) {
			return bad("The server template is missing a startup variable required by these settings.")
		}
		variables = selected
	}
	tx, err := conn.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(context.Background())
	for _, variable := range variables {
		if _, err = tx.Exec(ctx, `INSERT INTO server_variables(server_id,variable_id,variable_value) VALUES($1,$2,$3) ON CONFLICT(server_id,variable_id) DO UPDATE SET variable_value=EXCLUDED.variable_value,updated_at=now()`, server["id"], variable["id"], changes[str(variable["env_variable"])]); err != nil {
			return err
		}
	}
	if err = a.quickSetupStopped(ctx, server); err != nil {
		return err
	}
	restoreFile := func() error {
		cleanup, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		return a.quickSetupWrite(cleanup, server, file, content)
	}
	if err = a.quickSetupWrite(ctx, server, file, updated); err != nil {
		return errors.Join(err, restoreFile())
	}
	if err = tx.Commit(ctx); err != nil {
		return errors.Join(err, restoreFile())
	}
	if len(variables) == 0 {
		return nil
	}
	// Keep the session lock through sync and rollback so a start cannot observe
	// a new file paired with the old daemon environment.
	if err = a.syncServer(ctx, server); err == nil {
		return nil
	}
	cleanup, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	restore, restoreErr := conn.Begin(cleanup)
	if restoreErr == nil {
		defer restore.Rollback(context.Background())
		for _, variable := range variables {
			if boolean(variable["overridden"]) {
				_, restoreErr = restore.Exec(cleanup, `UPDATE server_variables SET variable_value=$3,updated_at=now() WHERE server_id=$1 AND variable_id=$2`, server["id"], variable["id"], variable["variable_value"])
			} else {
				_, restoreErr = restore.Exec(cleanup, "DELETE FROM server_variables WHERE server_id=$1 AND variable_id=$2", server["id"], variable["id"])
			}
			if restoreErr != nil {
				break
			}
		}
		if restoreErr == nil {
			restoreErr = restore.Commit(cleanup)
		}
	}
	fileErr := restoreFile()
	var syncErr error
	if restoreErr == nil && fileErr == nil {
		syncErr = a.syncServer(cleanup, server)
	}
	if restoreErr != nil || fileErr != nil || syncErr != nil {
		return errors.Join(err, fmt.Errorf("Minecraft settings could not be fully restored; check the file and startup settings before starting: %w", errors.Join(restoreErr, fileErr, syncErr)))
	}
	return err
}
