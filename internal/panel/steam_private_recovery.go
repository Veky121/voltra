package panel

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"slices"

	"voltra/internal/steamapi"
)

// Offer only the latest retained unfinished attempt. Receipt presence is still
// unknown until the separate recovery worker validates the actual files.
func privateRecoveryCandidate(ctx context.Context, q steamHistoryQuerier, server M) (string, error) {
	row, err := queryRowMap(q.QueryRow(ctx, `SELECT row_to_json(t) FROM (
	 SELECT a.job_id,COALESCE(j.status,'') AS status,EXISTS(SELECT 1 FROM steam_private_publications p WHERE p.server_id=a.server_id AND p.job_id=a.job_id) AS accepted
	 FROM steam_private_attempts a LEFT JOIN steam_jobs j ON j.id=a.job_id WHERE a.server_id=$1 ORDER BY a.created_at DESC,a.job_id DESC LIMIT 1
	) t`, server["id"]))
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	if boolean(row["accepted"]) || str(row["status"]) == "queued" || str(row["status"]) == "running" || str(row["status"]) == "completed" {
		return "", nil
	}
	if _, err = privateRecoveryRequest(ctx, q, server, str(row["job_id"])); err != nil {
		var api APIError
		if errors.As(err, &api) {
			return "", nil
		}
		return "", err
	}
	return str(row["job_id"]), nil
}

// Select only the original durable request. A future authenticated recovery
// caller must hold the normal server mutation lock and recheck these bindings
// before recording its independently validated result. This grants no readiness
// and performs no node operation or publication mutation.
func privateRecoveryRequest(ctx context.Context, q steamHistoryQuerier, server M, jobID string) (steamapi.PrivateRequest, error) {
	var empty steamapi.PrivateRequest
	row, err := queryRowMap(q.QueryRow(ctx, `SELECT row_to_json(t) FROM (
	 SELECT original.*,EXISTS(
	  SELECT 1 FROM steam_private_publications p LEFT JOIN steam_private_attempts newer ON newer.job_id=p.job_id
	  WHERE p.server_id=original.server_id AND p.job_id<>original.job_id
	   AND (newer.job_id IS NULL OR newer.created_at>=original.created_at)
	 ) AS superseded FROM steam_private_attempts original WHERE original.server_id=$1 AND original.job_id=$2
	) t`, server["id"], jobID))
	if err != nil {
		return empty, err
	}
	changed := APIError{409, "PrivateSteamRecoveryScopeChanged", "The original private Steam attempt no longer matches this server or was superseded; review content migration before recovery."}
	if num(row["node_id"]) != num(server["node_id"]) || num(row["server_owner_id"]) != num(server["owner_id"]) || num(row["egg_id"]) != num(server["egg_id"]) || str(row["installation_id"]) != str(server["installation_id"]) || boolean(row["superseded"]) {
		return empty, changed
	}
	raw, err := json.Marshal(row["request"])
	var request steamapi.PrivateRequest
	if err != nil || json.Unmarshal(raw, &request) != nil || request.Validate() != nil || request.Job != jobID || request.Server != str(server["uuid"]) || request.Username != "" || request.Password != "" || request.Guard != "" || request.BetaPassword != "" {
		return empty, changed
	}
	profile, _, err := privateContentProfile(ctx, q, server)
	if err != nil || profile.AppID != request.Selection.App || profile.Platform != request.Selection.Platform || profile.Architecture != request.Selection.Architecture || !slices.Equal(profile.ProtectedPaths, request.Selection.Protected) {
		return empty, changed
	}
	return request, nil
}
