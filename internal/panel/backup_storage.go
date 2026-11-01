package panel

import "time"

// backupStorageSummary uses all retained records, before list pagination. It is
// accounting metadata, not a filesystem scan: unfinished/failed archives may
// occupy additional space that Wings has not reported.
func backupStorageSummary(backups []M) M {
	var local, remote, other, pending, failed int64
	var latest M
	var latestAt time.Time
	for _, b := range backups {
		size := max(int64(0), num(b["bytes"]))
		switch str(b["disk"]) {
		case "wings":
			local += size
		case "s3":
			remote += size
		default:
			other += size
		}
		if b["completed_at"] == nil {
			pending++
		} else if !boolean(b["is_successful"]) {
			failed++
		} else {
			completed, ok := b["completed_at"].(time.Time)
			if !ok {
				completed, _ = time.Parse(time.RFC3339Nano, str(b["completed_at"]))
			}
			if !completed.IsZero() && completed.After(latestAt) {
				latestAt = completed
				latest = M{"uuid": b["uuid"], "name": b["name"], "completed_at": completed, "bytes": size}
			}
		}
	}
	return M{"local_bytes": local, "remote_bytes": remote, "other_bytes": other,
		"total_bytes": local + remote + other, "pending_count": pending, "failed_count": failed, "latest_successful_backup": latest}
}
