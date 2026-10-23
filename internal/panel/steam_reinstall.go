package panel

import (
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"
)

// Managed Steam's ordinary Wings installer only prepares its launcher. Route
// native Reinstall through the existing Steam executor so it reinstalls the
// publisher files while retaining saves/configuration and leaving power off.
// The caller has already enforced the native route's permission.
func (a *App) managedSteamReinstall(w http.ResponseWriter, r *http.Request, server M, successStatus int) bool {
	_, err := a.one(r.Context(), "SELECT server_id FROM steam_servers WHERE server_id=$1", server["id"])
	if errors.Is(err, pgx.ErrNoRows) {
		return false
	}
	if err != nil {
		fail(w, err)
		return true
	}
	job, err := a.queueSteamJobPolicy(r.Context(), server, "install", false, true, false, true)
	if err != nil {
		fail(w, err)
		return true
	}
	a.opAudit(r, server, "server:reinstall", M{"job_id": job["id"], "managed_steam": true})
	w.WriteHeader(successStatus)
	return true
}
