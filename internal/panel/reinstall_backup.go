package panel

import "net/http"

// Verify the selected backup again at the mutation boundary, including managed
// Steam reinstalls. A pending, failed, deleted or other server's backup cannot
// authorize the protected reinstall requested by the dialog.
func (a *App) validateReinstallBackup(r *http.Request, server, data M) error {
	if v, ok := data["create_backup"]; ok {
		if _, valid := v.(bool); !valid {
			return bad("create_backup must be a boolean")
		}
	}
	uuid := str(data["backup_uuid"])
	if !boolean(data["create_backup"]) && uuid == "" {
		return nil
	}
	if uuid == "" {
		return bad("A successful backup is required before reinstalling")
	}
	user, err := a.user(r)
	if err != nil {
		return err
	}
	if !a.can(r.Context(), user, server, "backup.read") {
		return &APIError{Status: 403, Code: "Forbidden", Detail: "Permission to view backups is required"}
	}
	backup, err := a.one(r.Context(), `SELECT * FROM backups WHERE uuid=$1 AND server_id=$2 AND deleted_at IS NULL`, uuid, server["id"])
	if err != nil {
		return bad("The selected reinstall backup is unavailable")
	}
	if !boolean(backup["is_successful"]) || backup["completed_at"] == nil {
		return bad("The backup has not completed successfully. Reinstall was not started")
	}
	return nil
}

// FS25 stores persistent user data beneath data/. Keep every current save slot,
// player/world state, mod settings and licences, without installed content or
// copies of old automatic save backups. Negations include directory entries too,
// since Wings skips walking ignored directories.
var fs25ReinstallBackupIgnored = []string{
	"/*", "!/data", "/data/*", "!/data/savegame[0-9]*",
	"!/data/modSettings", "!/data/*.xml", "!/data/*.dat",
	"!/data/dedicated_server", "/data/dedicated_server/logs",
}

func (a *App) applyReinstallBackupScope(r *http.Request, server, data M) error {
	if str(data["scope"]) == "" {
		return nil
	}
	if str(data["scope"]) != "reinstall_data" {
		return bad("Unsupported backup scope")
	}
	egg, err := a.serverEffectiveEgg(r.Context(), server)
	if err != nil {
		return err
	}
	if !fs25Egg(egg) {
		return bad("A saved-data backup profile is not available for this game")
	}
	data["ignored"] = fs25ReinstallBackupIgnored
	return nil
}
