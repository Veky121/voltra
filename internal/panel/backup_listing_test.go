package panel

import (
	"context"
	"net/url"
	"testing"
)

func TestBackupListingOriginAndSorting(t *testing.T) {
	f := operationsFixtureNew(t)
	ctx := context.Background()
	for i, name := range []string{"Zulu", "Alpha", "Scheduled backup 9 at 2026-11-05T10:00:00Z"} {
		uuid := newUUID()
		_, err := f.a.insert(ctx, "backups", M{"uuid": uuid, "server_id": f.server["id"], "name": name, "bytes": (i + 1) * 100, "is_successful": true, "completed_at": "2026-11-05T11:00:00Z", "created_at": []string{"2026-11-01T00:00:00Z", "2026-11-02T00:00:00Z", "2026-11-03T00:00:00Z"}[i]})
		if err != nil {
			t.Fatal(err)
		}
		if i == 0 {
			err = f.a.audit(ctx, num(f.owner["id"]), num(f.server["id"]), "server:backup.start", M{"backup": uuid})
		}
		if i == 1 {
			err = f.a.audit(ctx, 0, num(f.server["id"]), "server:backup.start", M{"backup": uuid, "source": "scheduled", "schedule_id": 9, "schedule_name": "Nightly"})
		}
		if err != nil {
			t.Fatal(err)
		}
	}
	for _, tc := range []struct{ sort, want string }{
		{"newest", "Scheduled backup 9 at 2026-11-05T10:00:00Z"}, {"oldest", "Zulu"}, {"largest", "Scheduled backup 9 at 2026-11-05T10:00:00Z"}, {"smallest", "Zulu"}, {"name", "Alpha"}, {"invalid;DROP TABLE backups", "Scheduled backup 9 at 2026-11-05T10:00:00Z"},
	} {
		response := operationsExpect(t, f.request("GET", f.serverPath("/backups?per_page=1&sort="+url.QueryEscape(tc.sort)), nil, f.sub), 200)
		data := asSlice(response["data"])
		if len(data) != 1 || str(asMap(asMap(data[0])["attributes"])["name"]) != tc.want {
			t.Fatalf("sort %s: %#v", tc.sort, response)
		}
		if num(asMap(asMap(response["meta"])["pagination"])["total"]) != 3 {
			t.Fatal("sort lost records")
		}
	}
	for _, tc := range []struct{ origin, name, creator string }{
		{"manual", "Zulu", "owner"}, {"scheduled", "Alpha", ""}, {"unknown", "Scheduled backup 9 at 2026-11-05T10:00:00Z", ""},
	} {
		response := operationsExpect(t, f.request("GET", f.serverPath("/backups?origin="+tc.origin), nil, f.sub), 200)
		data := asSlice(response["data"])
		if len(data) != 1 {
			t.Fatalf("filter %s: %#v", tc.origin, response)
		}
		b := asMap(asMap(data[0])["attributes"])
		origin := asMap(b["origin"])
		if str(b["name"]) != tc.name || str(origin["type"]) != tc.origin || str(origin["created_by"]) != tc.creator {
			t.Fatalf("wrong origin: %#v", b)
		}
		if tc.origin == "scheduled" && str(origin["schedule_name"]) != "Nightly" {
			t.Fatal("missing schedule name")
		}
		if str(b["disk"]) != "wings" {
			t.Fatal("storage adapter missing")
		}
		meta := asMap(response["meta"])
		if num(meta["backup_count"]) != 3 || num(asMap(meta["storage"])["total_bytes"]) != 600 {
			t.Fatal("filter changed global storage summary")
		}
	}
}
