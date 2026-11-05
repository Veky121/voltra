package panel

import (
	"context"
	"net/http/httptest"
	"testing"
	"time"
)

func TestReinstallBackupGate(t *testing.T) {
	for _, state := range []string{"pending", "failed", "successful", "deleted", "missing"} {
		t.Run(state, func(t *testing.T) {
			f := operationsFixtureNew(t)
			uuid := newUUID()
			if state != "missing" {
				row := M{"uuid": uuid, "server_id": f.server["id"], "name": "Reinstall Backup - test", "disk": "wings", "is_successful": state == "successful" || state == "deleted", "bytes": int64(0)}
				if state != "pending" {
					row["completed_at"] = time.Now().UTC()
				}
				if state == "deleted" {
					row["deleted_at"] = time.Now().UTC()
				}
				if _, err := f.a.insert(context.Background(), "backups", row); err != nil {
					t.Fatal(err)
				}
			}
			body := M{"create_backup": true, "backup_uuid": uuid}
			if state == "successful" {
				request := WithUser(httptest.NewRequest("POST", f.serverPath("/settings/reinstall"), nil), num(f.owner["id"]))
				if err := f.a.validateReinstallBackup(request, f.server, body); err != nil {
					t.Fatal(err)
				}
			} else {
				operationsExpect(t, f.request("POST", f.serverPath("/settings/reinstall"), body, f.owner), 422)
			}
			server, err := f.a.one(context.Background(), "SELECT status FROM servers WHERE id=$1", f.server["id"])
			if err != nil {
				t.Fatal(err)
			}
			if state != "successful" && str(server["status"]) != "" {
				t.Fatal("failed backup changed server state")
			}
		})
	}
	f := operationsFixtureNew(t)
	operationsExpect(t, f.request("POST", f.serverPath("/settings/reinstall"), M{"create_backup": true}, f.owner), 422)
	operationsExpect(t, f.request("POST", f.serverPath("/settings/reinstall"), M{"create_backup": "true"}, f.owner), 422)
}

func TestFS25ReinstallBackupScope(t *testing.T) {
	f := operationsFixtureNew(t)
	operationsExpect(t, f.request("POST", f.serverPath("/backups"), M{"scope": "reinstall_data"}, f.owner), 422)
	if _, err := f.a.update(context.Background(), "eggs", num(f.server["egg_id"]), M{"features": []string{"voltra_fs25"}}); err != nil {
		t.Fatal(err)
	}
	result := operationsExpect(t, f.request("POST", f.serverPath("/backups"), M{"scope": "reinstall_data", "ignored": "*.xml"}, f.owner), 200)
	got := opIgnored(asMap(result["attributes"])["ignored_files"])
	if len(got) != len(fs25ReinstallBackupIgnored) {
		t.Fatal(got)
	}
	for i := range got {
		if got[i] != fs25ReinstallBackupIgnored[i] {
			t.Fatal(got)
		}
	}
}

func TestReinstallFailureCanStartPreviousInstallation(t *testing.T) {
	for _, status := range []string{"reinstall_failed", "installing", "suspended"} {
		t.Run(status, func(t *testing.T) {
			f := operationsFixtureNew(t)
			if _, err := f.a.update(context.Background(), "servers", num(f.server["id"]), M{"status": status}); err != nil {
				t.Fatal(err)
			}
			response, err := f.a.unmanagedServerPower(context.Background(), f.server, "start")
			if response != nil {
				response.Body.Close()
			}
			if (err == nil) != (status == "reinstall_failed") {
				t.Fatalf("status %s: %v", status, err)
			}
		})
	}
}
