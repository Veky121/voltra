package panel

import "context"

// Only fixed SQL fragments are accepted. Sorting happens before pagination.
func backupOrder(sort string) string {
	switch sort {
	case "oldest":
		return "b.created_at ASC,b.id ASC"
	case "largest":
		return "b.bytes DESC,b.created_at DESC,b.id DESC"
	case "smallest":
		return "b.bytes ASC,b.created_at DESC,b.id DESC"
	case "name":
		return "lower(b.name) ASC,b.created_at DESC,b.id DESC"
	default:
		return "b.created_at DESC,b.id DESC"
	}
}

func (a *App) listBackups(ctx context.Context, serverID int64, sort string) ([]M, error) {
	return a.query(ctx, `SELECT b.*, jsonb_build_object(
 'type', CASE WHEN history.properties->>'source'='scheduled' THEN 'scheduled'
              WHEN history.actor_id IS NOT NULL THEN 'manual' ELSE 'unknown' END,
 'created_by', u.username,
 'schedule_id', history.properties->'schedule_id',
 'schedule_name', history.properties->>'schedule_name') AS origin
 FROM backups b
 LEFT JOIN LATERAL (
   SELECT l.actor_id,l.properties FROM activity_logs l
   WHERE l.server_id=b.server_id AND l.event='server:backup.start'
     AND l.properties->>'backup'=b.uuid
   ORDER BY l.id ASC LIMIT 1
 ) history ON true
 LEFT JOIN users u ON u.id=history.actor_id
 WHERE b.server_id=$1 AND b.deleted_at IS NULL ORDER BY `+backupOrder(sort), serverID)
}

func backupMatchesOrigin(b M, filter string) bool {
	switch filter {
	case "manual", "scheduled", "unknown":
		return str(asMap(b["origin"])["type"]) == filter
	default:
		return true
	}
}
