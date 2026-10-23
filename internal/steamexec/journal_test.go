package steamexec

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"voltra/internal/steamapi"
)

func putReceipt(t *testing.T, e *Executor, rec record, when time.Time) string {
	t.Helper()
	if err := os.MkdirAll(e.journal, 0700); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(e.journal, phaseID(rec.Request)+".json")
	data, err := json.Marshal(rec)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
	if err = os.Chtimes(path, when, when); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestCheckReceiptRetentionAgeAndProtectedRecords(t *testing.T) {
	e, _ := fixture(t)
	now := time.Now()
	old := now.Add(-checkReceiptAge - time.Hour)
	complete := &steamapi.Event{Type: "result", Stage: "complete"}
	check := req("check")
	expired := putReceipt(t, e, record{Request: check, Terminal: complete}, old)
	check.JobID = "33333333-3333-3333-3333-333333333333"
	recent := putReceipt(t, e, record{Request: check, Terminal: complete}, now)
	var protected []string
	for i, rec := range []record{
		{Request: req("update"), Terminal: complete, Mutating: true},
		{Request: req("install"), Terminal: complete}, // Mutation rejected before executing still retains its ID.
		{Request: req("verify"), RecoveryNeeded: true, Mutating: true},
		{Request: req("check")},
		{Request: req("check"), Terminal: complete, RecoveryNeeded: true},
		{Request: req("check"), Terminal: &steamapi.Event{Type: "error", FilesChanged: true}},
	} {
		rec.Request.JobID = fmt.Sprintf("%08x-4444-4444-4444-444444444444", i)
		rec.Request.ServerUUID = "77777777-7777-7777-7777-777777777777"
		protected = append(protected, putReceipt(t, e, rec, old))
	}
	check.JobID = "55555555-5555-5555-5555-555555555555"
	snapshotReceipt := putReceipt(t, e, record{Request: check, Terminal: complete}, old)
	snapshot := filepath.Join(e.journal, phaseID(check)+".configs")
	if err := os.WriteFile(snapshot, []byte("preserved configuration"), 0600); err != nil {
		t.Fatal(err)
	}
	protected = append(protected, snapshotReceipt, snapshot)
	orphan := filepath.Join(e.journal, "orphan.configs")
	_ = os.WriteFile(orphan, []byte("recovery data"), 0600)
	protected = append(protected, orphan)
	if count, err := e.maintainJournal(context.Background(), now); err != nil || count != 7 {
		t.Fatalf("protected=%d: %v", count, err)
	}
	if _, err := os.Stat(expired); !os.IsNotExist(err) {
		t.Fatal("expired read-only check was retained")
	}
	for _, path := range append(protected, recent) {
		if _, err := os.Stat(path); err != nil {
			t.Fatalf("protected record removed: %s", path)
		}
	}
	// Expiring a completed check permits safe fresh execution under the same ID.
	result := terminal(t, execute(e, req("check")))
	if result.Type != "result" || result.FilesChanged {
		t.Fatal(result)
	}
}

func TestHourlyChecksArePrunedByCountAndDoNotExhaustMutationCapacity(t *testing.T) {
	e, _ := fixture(t)
	now := time.Now()
	for i := 0; i < checkReceiptLimit+3; i++ {
		r := req("check")
		r.JobID = fmt.Sprintf("%08x-6666-6666-6666-666666666666", i)
		putReceipt(t, e, record{Request: r, Terminal: &steamapi.Event{Type: "result"}}, now.Add(time.Duration(i)*time.Millisecond))
	}
	count, err := e.maintainJournal(context.Background(), now)
	if err != nil || count != 0 {
		t.Fatalf("completed checks count against mutation capacity: %d %v", count, err)
	}
	entries, err := os.ReadDir(e.journal)
	if err != nil {
		t.Fatal(err)
	}
	receipts := 0
	for _, entry := range entries {
		if filepath.Ext(entry.Name()) == ".json" {
			receipts++
		}
	}
	if receipts != checkReceiptLimit {
		t.Fatalf("kept %d check receipts, limit %d", receipts, checkReceiptLimit)
	}
	result := terminal(t, execute(e, req("update")))
	if result.Type != "result" {
		t.Fatalf("hourly checks blocked maintenance: %+v", result)
	}
}
