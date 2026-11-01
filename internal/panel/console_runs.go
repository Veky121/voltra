package panel

import (
	"context"
	"fmt"
)

const consolePreviousRunLines = 250

// Initial attachment, repeated status and starting -> running are not new runs.
// Rotation waits for an observed start, never merely a requested power action.
func consoleNewRun(previous, next string) bool {
	return next == "starting" && (previous == "offline" || previous == "stopping" || previous == "running") ||
		next == "running" && (previous == "offline" || previous == "stopping")
}

func (a *App) beginConsoleRun(ctx context.Context, serverID int64, owner string, state consoleLogEntry) error {
	tx, err := a.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtextextended('voltra:console-history:'||$1::bigint::text,0))", serverID); err != nil {
		return err
	}
	var valid bool
	if err = tx.QueryRow(ctx, "SELECT lease_owner=$2 AND lease_until>now() FROM console_log_collectors WHERE server_id=$1 FOR UPDATE", serverID, owner).Scan(&valid); err != nil {
		return err
	}
	if !valid {
		return fmt.Errorf("console capture lease expired")
	}
	// Reserve two entries for the boundary and observed state, even under a
	// deliberately small configured history limit.
	keep := min(consolePreviousRunLines, max(0, a.consoleLogLimit()-2))
	if _, err = tx.Exec(ctx, `DELETE FROM console_log_entries WHERE server_id=$1 AND id NOT IN
	 (SELECT id FROM console_log_entries WHERE server_id=$1 ORDER BY id DESC LIMIT $2)`, serverID, keep); err != nil {
		return err
	}
	var boundary int64
	message := fmt.Sprintf("\x1b[0m\x1b[94m[Voltra]: New run. Keeping up to %d lines from the previous output.\x1b[0m", keep)
	if err = tx.QueryRow(ctx, "INSERT INTO console_log_entries(server_id,event,line) VALUES($1,'panel message',$2) RETURNING id", serverID, message).Scan(&boundary); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, "INSERT INTO console_log_entries(server_id,event,line) VALUES($1,$2,$3)", serverID, state.Event, state.Line); err != nil {
		return err
	}
	if a.consoleLogLimit() < 2 {
		if _, err = tx.Exec(ctx, "DELETE FROM console_log_entries WHERE server_id=$1 AND id=$2", serverID, boundary); err != nil {
			return err
		}
	}
	if _, err = tx.Exec(ctx, "UPDATE console_log_collectors SET run_start_id=$2,last_event_at=now() WHERE server_id=$1", serverID, boundary); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
