package panel

import (
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"
)

// Discovery never grants readiness: only the operator's production trust
// composition can enable privateReady. Credentials are not needed to inspect it.
func (a *App) privateSteamReadiness(w http.ResponseWriter, r *http.Request) {
	s, _, err := a.privateServer(r)
	if err != nil {
		fail(w, err)
		return
	}
	profile, branch, err := privateContentProfile(r.Context(), a.DB, s)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		fail(w, err)
		return
	}
	controls, controlErr := privateServerSteamControls(r.Context(), a.DB, s)
	if controlErr != nil {
		fail(w, controlErr)
		return
	}
	app := profile.AppID
	supported := err == nil
	ready := supported && a.privateReady(r.Context(), num(s["node_id"]), app)
	recoveryReady := supported && a.privateRecoveryReady(r.Context(), num(s["node_id"]), app)
	owned, err := hasPrivateSteamOwnership(r.Context(), a.DB, num(s["id"]))
	if err != nil {
		fail(w, err)
		return
	}
	reason := ""
	if !supported {
		reason = "This server has no reviewed private Steam content profile."
	} else if !ready {
		reason = "Private Steam installation is not enabled on this node."
	}
	w.Header().Set("Cache-Control", "no-store")
	recoveryReason := ""
	if !recoveryReady {
		recoveryReason = "Read-only receipt recovery is not enabled on this node."
	}
	recoveryJob := ""
	if supported {
		recoveryJob, err = privateRecoveryCandidate(r.Context(), a.DB, s)
		if err != nil {
			fail(w, err)
			return
		}
	}
	writeJSON(w, 200, item("steam_private_status", M{"supported": supported, "ready": ready, "reason": reason, "recovery_ready": recoveryReady, "recovery_reason": recoveryReason, "recovery_job_id": recoveryJob, "app_id": app, "branch": branch, "private_content": owned, "original_controls": controls}))
}
