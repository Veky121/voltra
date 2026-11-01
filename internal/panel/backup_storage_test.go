package panel

import (
	"context"
	"testing"
	"time"
)

func TestBackupStorageSummary(t *testing.T) {
	result := backupStorageSummary([]M{
		{"disk": "wings", "bytes": int64(100), "is_successful": true, "completed_at": "done"},
		{"disk": "s3", "bytes": int64(200), "is_successful": true, "completed_at": "done"},
		{"disk": "other", "bytes": int64(30), "is_successful": true, "completed_at": "done"},
		{"disk": "wings", "bytes": int64(10)},
		{"disk": "wings", "bytes": int64(-1), "completed_at": "failed"},
	})
	for key, want := range map[string]int64{"local_bytes": 110, "remote_bytes": 200, "other_bytes": 30, "total_bytes": 340, "pending_count": 1, "failed_count": 1} {
		if num(result[key]) != want {
			t.Fatalf("%s = %v, want %d", key, result[key], want)
		}
	}
	if num(backupStorageSummary(nil)["total_bytes"]) != 0 {
		t.Fatal("no retained backups should have a known zero size")
	}
}

func TestBackupStorageLatestSuccessUsesCompletionAcrossAllRecords(t *testing.T) {
	latestAt := time.Date(2026, 11, 1, 12, 0, 0, 0, time.UTC)
	result := backupStorageSummary([]M{
		{"uuid": "failed", "is_successful": false, "completed_at": latestAt.Add(time.Hour)},
		{"uuid": "pending", "is_successful": true},
		{"uuid": "older", "is_successful": true, "completed_at": "2026-10-31T12:00:00Z"},
		{"uuid": "latest", "name": "Nightly", "is_successful": true, "completed_at": latestAt},
	})
	latest := asMap(result["latest_successful_backup"])
	if str(latest["uuid"]) != "latest" || latest["completed_at"] != latestAt {
		t.Fatalf("incorrect latest successful backup: %#v", latest)
	}
	if backupStorageSummary(nil)["latest_successful_backup"] != nil {
		// A typed nil map is intentionally encoded as JSON null.
		if len(asMap(backupStorageSummary(nil)["latest_successful_backup"])) != 0 {
			t.Fatal("unexpected backup for empty history")
		}
	}
}

func TestBackupStorageIncludesAllPagesAndRespectsAccess(t *testing.T) {
	f := operationsFixtureNew(t)
	ctx := context.Background()
	for i, disk := range []string{"wings", "s3", "wings"} {
		_, err := f.a.insert(ctx, "backups", M{"uuid": newUUID(), "server_id": f.server["id"], "name": disk, "disk": disk, "bytes": int64((i + 1) * 100), "is_successful": true, "completed_at": now()})
		if err != nil {
			t.Fatal(err)
		}
	}
	// Deleted archives must not count.
	if err := f.a.exec(ctx, `UPDATE backups SET deleted_at=now() WHERE server_id=$1 AND bytes=300`, f.server["id"]); err != nil {
		t.Fatal(err)
	}
	for _, page := range []string{"1", "2"} {
		body := operationsExpect(t, f.request("GET", f.serverPath("/backups?per_page=1&page="+page), nil, f.owner), 200)
		meta := asMap(body["meta"])
		storage := asMap(meta["storage"])
		if num(storage["total_bytes"]) != 300 || num(storage["local_bytes"]) != 100 || num(storage["remote_bytes"]) != 200 || num(meta["backup_count"]) != 2 {
			t.Fatalf("pagination changed storage accounting: %#v", meta)
		}
	}
	if err := f.a.exec(ctx, `UPDATE subusers SET permissions='[]'::jsonb WHERE server_id=$1`, f.server["id"]); err != nil {
		t.Fatal(err)
	}
	operationsExpect(t, f.request("GET", f.serverPath("/backups"), nil, f.sub), 403)
}
