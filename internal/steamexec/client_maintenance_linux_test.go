//go:build linux

package steamexec

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestClientMaintenanceRejectsSymlinkBeforeWriting(t *testing.T) {
	base := t.TempDir()
	outside := t.TempDir()
	link := filepath.Join(base, "journal")
	if err := os.Symlink(outside, link); err != nil {
		t.Fatal(err)
	}
	e := clientTestExecutor(t, &clientDocker{})
	e.journal = link
	stop := e.StartClientMaintenance(context.Background())
	defer stop()
	if err := e.RequestClientCheck(); err == nil {
		t.Fatal("accepted redirected journal")
	}
	if _, err := os.Stat(filepath.Join(outside, "client-maintenance")); !os.IsNotExist(err) {
		t.Fatal("created maintenance state through symlink")
	}
}

func TestClientMaintenanceReportsLegacyJournalPermissionsBeforeFirstCheck(t *testing.T) {
	e := clientTestExecutor(t, &clientDocker{output: "Steam Console Client (c) Valve Corporation - version 1234567890\n"})
	if err := os.Chmod(e.journal, 0755); err != nil {
		t.Fatal(err)
	}
	stop := e.StartClientMaintenance(context.Background())
	defer stop()
	status := e.ClientStatus()
	if status.Initialized || !strings.Contains(status.LastError, "0700") {
		t.Fatalf("unusable storage looked ready: %+v", status)
	}
	if err := e.RequestClientCheck(); err == nil {
		t.Fatal("accepted check with public journal")
	}
	if _, err := os.Stat(filepath.Join(e.journal, "client-maintenance")); !os.IsNotExist(err) {
		t.Fatal("created state before rejecting public journal")
	}
	if err := os.Chmod(e.journal, 0700); err != nil {
		t.Fatal(err)
	}
	if status := e.ClientStatus(); status.LastError != "" {
		t.Fatalf("repaired storage retained stale failure: %+v", status)
	}
	if err := e.RequestClientCheck(); err != nil {
		t.Fatal(err)
	}
	if status := awaitClient(t, e); status.Version != "1234567890" || status.LastCheckedAt == nil || status.LastError != "" {
		t.Fatalf("check did not recover after permissions repair: %+v", status)
	}
}

func TestClientMaintenanceRejectsPublicStateDirectory(t *testing.T) {
	e := clientTestExecutor(t, &clientDocker{})
	dir := filepath.Join(e.journal, "client-maintenance")
	if err := os.Mkdir(dir, 0755); err != nil {
		t.Fatal(err)
	}
	stop := e.StartClientMaintenance(context.Background())
	defer stop()
	if err := e.RequestClientCheck(); err == nil {
		t.Fatal("accepted public maintenance directory")
	}
}
