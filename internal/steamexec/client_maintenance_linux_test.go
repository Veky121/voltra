//go:build linux

package steamexec

import (
	"context"
	"os"
	"path/filepath"
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
