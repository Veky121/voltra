package panel

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func steamPowerUnlock(connection *pgxpool.Conn, key string) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	var unlocked bool
	if err := connection.QueryRow(ctx, "SELECT pg_advisory_unlock(hashtextextended($1,0))", key).Scan(&unlocked); err != nil || !unlocked {
		// An uncertain session lock must never return to the shared pool.
		raw := connection.Hijack()
		closeCtx, closeCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer closeCancel()
		_ = raw.Close(closeCtx)
		return
	}
	connection.Release()
}

func (a *App) steamSatisfactoryStartup(ctx context.Context, server M) (string, error) {
	state, err := a.one(ctx, "SELECT game FROM steam_servers WHERE server_id=$1", server["id"])
	if err != nil || str(state["game"]) != "satisfactory" {
		return str(server["startup"]), err
	}
	configuration, _, err := a.steamCatalogLoad(ctx, server)
	if err != nil {
		return "", err
	}
	return steamCatalogPlayersStartup(str(server["startup"]), configuration.Players)
}

func (a *App) steamRestoreStartup(server M, published string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	tag, err := a.DB.Exec(ctx, `UPDATE servers SET startup=$2,updated_at=now() WHERE id=$1 AND startup=$3 AND node_id=$4 AND installation_id IS NOT DISTINCT FROM $5`, server["id"], server["startup"], published, server["node_id"], server["installation_id"])
	if err != nil || tag.RowsAffected() != 1 {
		var unchanged bool
		if err == nil && a.DB.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM servers WHERE id=$1 AND startup=$2 AND node_id=$3 AND installation_id IS NOT DISTINCT FROM $4)`, server["id"], server["startup"], server["node_id"], server["installation_id"]).Scan(&unchanged) == nil && unchanged {
			return nil
		}
		return errors.New("Startup restoration was superseded; inspect the server before starting.")
	}
	if err = a.syncServer(ctx, server); err != nil {
		return errors.New("Startup restoration could not be synchronized; inspect the server before starting.")
	}
	return nil
}
