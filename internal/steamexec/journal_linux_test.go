//go:build linux

package steamexec

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"voltra/internal/steamapi"
)

func TestCheckPruningSkipsLockedServer(t *testing.T) {
	e, _ := fixture(t)
	now := time.Now()
	path := putReceipt(t, e, record{Request: req("check"), Terminal: &steamapi.Event{Type: "result"}}, now.Add(-checkReceiptAge-time.Hour))
	release, err := lockServer(filepath.Join(e.journal, serverID+".lock"))
	if err != nil {
		t.Fatal(err)
	}
	_, err = e.maintainJournal(context.Background(), now)
	release()
	if err != nil {
		t.Fatal(err)
	}
	if _, err = os.Stat(path); err != nil {
		t.Fatal("pruning touched an active server receipt")
	}
	if _, err = e.maintainJournal(context.Background(), now); err != nil {
		t.Fatal(err)
	}
	if _, err = os.Stat(path); !os.IsNotExist(err) {
		t.Fatal("unlocked expired check was not pruned")
	}
}
