package panel

import (
	"context"
	"errors"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// Hold both existing mutation locks across route cleanup, committed writes and
// the daemon request. Try rather than queue a destructive action behind a long
// running installer or configuration operation.
func (a *App) serverDeleteMutationLock(ctx context.Context, server M) (func(), error) {
	tx, err := a.DB.Begin(ctx)
	if err != nil {
		return nil, err
	}
	release := func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = tx.Rollback(cleanup)
	}
	var acquired bool
	err = tx.QueryRow(ctx, "SELECT pg_try_advisory_xact_lock($1)", num(server["id"])).Scan(&acquired)
	if err == nil && acquired {
		err = tx.QueryRow(ctx, "SELECT pg_try_advisory_xact_lock(hashtextextended($1,0))", "voltra:server-mutation:"+str(server["uuid"])).Scan(&acquired)
	}
	if err != nil || !acquired {
		release()
		if err != nil {
			return nil, err
		}
		return nil, APIError{409, "ServerStateConflict", "A server update or configuration change is in progress. Wait for it to finish before deleting the server."}
	}
	return release, nil
}

func lockServerForDeletion(ctx context.Context, tx pgx.Tx, id any) (M, error) {
	rows, err := tx.Query(ctx, "SELECT * FROM servers WHERE id=$1 FOR UPDATE", id)
	if err != nil {
		return nil, err
	}
	server, err := pgx.CollectOneRow(rows, pgx.RowToMap)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, notFound()
	}
	if err != nil {
		return nil, err
	}
	var transferring bool
	if err = tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM server_transfers WHERE server_id=$1 AND successful IS NULL)", id).Scan(&transferring); err != nil {
		return nil, err
	}
	if transferring {
		return nil, APIError{409, "ServerStateConflict", "Finish or cancel the active transfer before deleting this server."}
	}
	return server, nil
}

// A route creator can hold an allocation while waiting for its server foreign
// key. Detect that conflict before deleting the daemon, not at the final UPDATE.
func lockDeletionAllocations(ctx context.Context, tx pgx.Tx, id any) error {
	_, err := tx.Exec(ctx, "SELECT id FROM allocations WHERE server_id=$1 ORDER BY id FOR UPDATE NOWAIT", id)
	var conflict *pgconn.PgError
	if errors.As(err, &conflict) && conflict.Code == "55P03" {
		return proxyConflict("Port assignments are being updated. The server has been kept; retry deletion shortly.")
	}
	return err
}

// Persist removal intent before contacting FRPC. A failed deletion or panel
// interruption must never cause reconciliation to recreate a removed mapping.
func (a *App) cleanupServerProxyRoutes(ctx context.Context, server M) error {
	ctx, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()
	intent, err := a.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer intent.Rollback(ctx)
	if _, err = lockServerForDeletion(ctx, intent, server["id"]); err != nil {
		return err
	}
	id := num(server["id"])
	if _, err = lockServerProxyCleanup(ctx, intent, id); err != nil {
		return err
	}
	if _, err = intent.Exec(ctx, "UPDATE proxy_routes SET desired_present=false,status='pending',last_error='',updated_at=now() WHERE server_id=$1", id); err != nil {
		return err
	}
	if err = intent.Commit(ctx); err != nil {
		return err
	}

	tx, err := a.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = lockServerForDeletion(ctx, tx, id); err != nil {
		return err
	}
	routes, err := lockServerProxyCleanup(ctx, tx, id)
	if err != nil {
		return err
	}
	for _, route := range routes {
		if boolean(route["desired_present"]) {
			return proxyConflict("Public ports changed during cleanup. The server has been kept; retry deletion.")
		}
	}
	failed := false
	for _, route := range routes {
		if err = a.proxyApply(ctx, tx, route); err != nil {
			failed = true
			_, err = tx.Exec(ctx, "UPDATE proxy_routes SET status='error',last_error=$2,updated_at=now() WHERE id=$1", route["id"], err.Error())
		} else {
			_, err = tx.Exec(ctx, "DELETE FROM proxy_routes WHERE id=$1", route["id"])
		}
		if err != nil {
			return err
		}
	}
	if err = tx.Commit(ctx); err != nil {
		return err
	}
	if failed {
		return proxyConflict("Automatic public port cleanup could not be confirmed by the gateway. The server and unresolved port reservations have been kept. Retry deletion when the gateway is reachable.")
	}
	return nil
}

// The caller holds the server row. Try gateway locks rather than waiting in
// reverse lock order against a creator/reconciler that needs the same server.
func lockServerProxyCleanup(ctx context.Context, tx pgx.Tx, id int64) ([]map[string]any, error) {
	rows, err := tx.Query(ctx, "SELECT * FROM proxy_routes WHERE server_id=$1 ORDER BY gateway_id,id", id)
	if err != nil {
		return nil, err
	}
	routes, err := pgx.CollectRows(rows, pgx.RowToMap)
	if err != nil {
		return nil, err
	}
	var gateway int64
	for _, route := range routes {
		gid := num(route["gateway_id"])
		if gateway == gid {
			continue
		}
		var acquired bool
		if err = tx.QueryRow(ctx, "SELECT pg_try_advisory_xact_lock(hashtextextended(current_schema()||$1,0))", "proxy-wizard-"+strconv.FormatInt(gid, 10)).Scan(&acquired); err != nil {
			return nil, err
		}
		if !acquired {
			return nil, proxyConflict("Public port cleanup is busy. The server has been kept; retry deletion shortly.")
		}
		gateway = gid
	}
	rows, err = tx.Query(ctx, "SELECT * FROM proxy_routes WHERE server_id=$1 ORDER BY gateway_id,id FOR UPDATE", id)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToMap)
}
