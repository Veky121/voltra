package panel

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
)

// queueRevocationTx snapshots the exact daemon target in the same transaction
// as the permission change. A later membership deletion cannot erase this job.
func (a *App) queueRevocationTx(ctx context.Context, tx pgx.Tx, server, user M) error {
	if num(server["node_id"]) < 1 || str(server["uuid"]) == "" || str(user["uuid"]) == "" {
		return bad("A revocation requires a server, node, and user identity.")
	}
	_, err := tx.Exec(ctx, `INSERT INTO daemon_revocations(node_id,server_uuid,user_uuid) VALUES($1,$2,$3)
	 ON CONFLICT(node_id,server_uuid,user_uuid) WHERE completed_at IS NULL
	 DO UPDATE SET generation=daemon_revocations.generation+1,next_attempt_at=now(),updated_at=now()`, server["node_id"], server["uuid"], user["uuid"])
	return err
}

func (a *App) RunRevocations(ctx context.Context) {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		for i := 0; i < 32 && ctx.Err() == nil; i++ {
			ran, err := a.processRevocation(ctx)
			if err != nil {
				slog.Error("Daemon revocation worker failed", "error", err)
				break
			}
			if !ran {
				break
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func revocationBackoff(attempt int64) time.Duration {
	delay := 30 * time.Second
	for i := int64(1); i < attempt && delay < 15*time.Minute; i++ {
		delay *= 2
	}
	if delay > 15*time.Minute {
		return 15 * time.Minute
	}
	return delay
}

// processRevocation commits a short lease before making the network request.
// A crashed process leaves an expiring lease that another worker can resume.
func (a *App) processRevocation(ctx context.Context) (bool, error) {
	lease := randomToken(24)
	job, err := a.one(ctx, `WITH candidate AS (
	 SELECT id FROM daemon_revocations
	 WHERE completed_at IS NULL AND next_attempt_at<=now() AND (lease_until IS NULL OR lease_until<=now())
	 ORDER BY next_attempt_at,id FOR UPDATE SKIP LOCKED LIMIT 1
	) UPDATE daemon_revocations d SET lease_token=$1,lease_until=now()+interval '2 minutes',attempts=d.attempts+1,updated_at=now()
	FROM candidate WHERE d.id=candidate.id RETURNING d.*`, lease)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	node, actionErr := a.node(ctx, num(job["node_id"]))
	if actionErr == nil {
		response, e := a.daemon(ctx, node, "POST", "/api/deauthorize-user", M{"user": job["user_uuid"], "servers": []string{str(job["server_uuid"])}})
		actionErr = e
		if response != nil {
			response.Body.Close()
		}
	}
	// Persist an interrupted request with a bounded independent context, allowing
	// a normal shutdown to release its lease without delaying restart recovery.
	persistCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if actionErr == nil {
		err = a.exec(persistCtx, `UPDATE daemon_revocations SET
	 completed_at=CASE WHEN generation=$1 THEN now() ELSE NULL END,
	 next_attempt_at=CASE WHEN generation=$1 THEN next_attempt_at ELSE now() END,
	 lease_until=NULL,lease_token=NULL,last_error=NULL,updated_at=now()
	 WHERE id=$2 AND lease_token=$3`, job["generation"], job["id"], lease)
		return true, err
	}
	detail := actionErr.Error()
	if len(detail) > 2000 {
		detail = detail[:2000]
	}
	err = a.exec(persistCtx, `UPDATE daemon_revocations SET
	 next_attempt_at=CASE WHEN generation=$1 THEN now()+make_interval(secs=>$2) ELSE now() END,
	 lease_until=NULL,lease_token=NULL,last_error=$3,updated_at=now()
	 WHERE id=$4 AND lease_token=$5`, job["generation"], int64(revocationBackoff(num(job["attempts"]))/time.Second), detail, job["id"], lease)
	if err == nil {
		slog.Warn("Daemon revocation deferred for retry", "job_id", job["id"], "node_id", job["node_id"], "attempt", job["attempts"], "error", detail)
	}
	return true, err
}
