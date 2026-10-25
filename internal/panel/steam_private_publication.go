package panel

import (
	"context"
	"encoding/json"

	"voltra/internal/steamapi"
)

// A validated publication is a filesystem fact, independent of whether the
// credential profile survives or the job subsequently loses authorization.
// It does not grant startup readiness or constitute a SteamCMD installation.
func (a *App) recordPrivatePublication(ctx context.Context, request steamapi.PrivateRequest, receipt json.RawMessage, token string) error {
	if err := request.CheckReceipt(receipt); err != nil {
		return err
	}
	tx, err := a.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	row, err := queryRowMap(tx.QueryRow(ctx, `UPDATE steam_private_jobs p SET receipt=$2,updated_at=now()
	 FROM steam_jobs j WHERE p.job_id=$1 AND j.id=p.job_id AND j.executor='steamkit-depot-v1'
	 AND j.lease_token=$3 AND j.status='running' AND j.lease_until>now() AND NOT p.cancel_requested
	 RETURNING json_build_object('server_id',j.server_id,'node_id',p.node_id,'server_owner_id',p.server_owner_id,'egg_id',p.egg_id,'installation_id',p.installation_id,'request',p.request)`, request.Job, receipt, token))
	if err != nil {
		return errPrivateCancelled
	}
	storedBytes, err := json.Marshal(row["request"])
	var stored steamapi.PrivateRequest
	if err != nil || json.Unmarshal(storedBytes, &stored) != nil || stored.CheckReceipt(receipt) != nil {
		return errPrivateCancelled
	}
	_, err = tx.Exec(ctx, `INSERT INTO steam_private_publications(server_id,job_id,node_id,server_owner_id,egg_id,installation_id,receipt)
	 VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(server_id) DO UPDATE SET
	 job_id=EXCLUDED.job_id,node_id=EXCLUDED.node_id,server_owner_id=EXCLUDED.server_owner_id,
	 egg_id=EXCLUDED.egg_id,installation_id=EXCLUDED.installation_id,receipt=EXCLUDED.receipt,updated_at=now()`,
		row["server_id"], request.Job, row["node_id"], row["server_owner_id"], row["egg_id"], str(row["installation_id"]), receipt)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}
