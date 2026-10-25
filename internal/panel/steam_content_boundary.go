package panel

import (
	"context"

	"github.com/jackc/pgx/v5"
)

type steamHistoryQuerier interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

// Retain this boundary even if an actor or credential profile was deleted.
// Private publication does not create a public SteamCMD installation receipt.
func blockPublicSteamOwnership(ctx context.Context, q steamHistoryQuerier, serverID int64) error {
	private, err := hasPrivateSteamOwnership(ctx, q, serverID)
	if err != nil {
		return err
	}
	if private {
		return APIError{409, "PrivateSteamOwnershipConflict", "Use this server's private Steam workflow or complete an explicit content migration before public maintenance or startup."}
	}
	return nil
}

func hasPrivateSteamOwnership(ctx context.Context, q steamHistoryQuerier, serverID int64) (bool, error) {
	var private bool
	err := q.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM steam_private_attempts WHERE server_id=$1) OR EXISTS(SELECT 1 FROM steam_private_publications WHERE server_id=$1) OR EXISTS(SELECT 1 FROM steam_jobs WHERE server_id=$1 AND executor='steamkit-depot-v1') OR EXISTS(SELECT 1 FROM servers s JOIN eggs e ON e.id=s.egg_id WHERE s.id=$1 AND (e.uuid::text=ANY($2::text[]) OR COALESCE(e.features,'[]'::jsonb) ? 'voltra:steam-private-prepared-v1'))`, serverID, privatePreparedEggUUIDs()).Scan(&private)
	return private, err
}
