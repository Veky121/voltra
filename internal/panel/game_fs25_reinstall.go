package panel

import (
	"context"
	"time"
)

// Only a newly completed managed FS25 reinstall may request automatic startup.
// Re-read the cycle before each attempt so a later reinstall, suspension, or
// transfer cannot be started by an older completion callback.
func (a *App) startFS25AfterReinstall(serverID int64, cycle string) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	timer := time.NewTicker(2 * time.Second)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			_ = a.audit(context.Background(), 0, serverID, "server:reinstall.start_failed", M{"reason": "startup_timeout"})
			return
		case <-timer.C:
		}
		server, err := a.one(ctx, "SELECT * FROM servers WHERE id=$1", serverID)
		if err != nil || str(server["installation_id"]) != cycle || str(server["status"]) != "" {
			return
		}
		node, err := a.node(ctx, num(server["node_id"]))
		if err != nil || boolean(node["maintenance_mode"]) {
			return
		}
		transfers, err := a.query(ctx, "SELECT id FROM server_transfers WHERE server_id=$1 AND successful IS NULL", serverID)
		if err != nil || len(transfers) > 0 {
			return
		}
		snapshot, err := a.clientResourceSnapshot(ctx, server)
		if err != nil {
			continue
		}
		state := str(snapshot["state"])
		if state == "running" || state == "starting" {
			return
		}
		if state != "offline" && state != "stopped" {
			continue
		}
		response, err := a.daemonServer(ctx, server, "POST", "/power", M{"action": "start"})
		if err != nil {
			continue
		}
		response.Body.Close()
		_ = a.audit(ctx, 0, serverID, "server:reinstall.start_requested", M{"installation_id": cycle})
		return
	}
}
