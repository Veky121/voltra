package steamexec

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const checkReceiptLimit = 2048
const checkReceiptAge = 7 * 24 * time.Hour
const protectedReceiptLimit = 20000

type checkReceipt struct {
	name, server string
	completed    time.Time
}

func readReceipt(path string) (record, error) {
	f, err := os.Open(path)
	if err != nil {
		return record{}, err
	}
	defer f.Close()
	var rec record
	dec := json.NewDecoder(io.LimitReader(f, 16385))
	if err = dec.Decode(&rec); err != nil {
		return rec, err
	}
	var extra any
	if dec.Decode(&extra) != io.EOF {
		return rec, errors.New("invalid Steam receipt")
	}
	return rec, nil
}

func disposableCheck(rec record, name string) bool {
	return rec.Request.Operation == "check" && rec.Request.Normalize() == nil && name == phaseID(rec.Request)+".json" && !rec.Mutating && !rec.RecoveryNeeded && rec.Terminal != nil && !rec.Terminal.FilesChanged && (rec.Terminal.Type == "result" || rec.Terminal.Type == "error")
}

// Only terminal read-only checks can expire. A replay of an expired check is
// safe; mutation IDs and interrupted work remain durable until operator action.
// This runs before taking the current server lock, then locks each candidate's
// server and revalidates it before unlinking. It cannot erase a recreated claim.
func (e *Executor) maintainJournal(ctx context.Context, now time.Time) (int, error) {
	entries, err := os.ReadDir(e.journal)
	if err != nil {
		return 0, errors.New("Steam journal unavailable")
	}
	var checks []checkReceipt
	protected := 0
	for _, entry := range entries {
		if ctx.Err() != nil {
			return protected, ctx.Err()
		}
		if !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		info, err := entry.Info()
		if err != nil || !info.Mode().IsRegular() {
			protected++
			continue
		}
		rec, err := readReceipt(filepath.Join(e.journal, entry.Name()))
		if err != nil || !disposableCheck(rec, entry.Name()) {
			protected++
			continue
		}
		// Even an unexpected snapshot paired with a check is protected.
		if _, err = os.Lstat(filepath.Join(e.journal, phaseID(rec.Request)+".configs")); !os.IsNotExist(err) {
			protected++
			continue
		}
		checks = append(checks, checkReceipt{name: entry.Name(), server: rec.Request.ServerUUID, completed: info.ModTime()})
	}
	sort.Slice(checks, func(i, j int) bool { return checks[i].completed.Before(checks[j].completed) })
	excess := max(0, len(checks)-checkReceiptLimit)
	removed := false
	for i, candidate := range checks {
		if i >= excess && !candidate.completed.Before(now.Add(-checkReceiptAge)) {
			continue
		}
		if ctx.Err() != nil {
			return protected, ctx.Err()
		}
		release, err := lockServer(filepath.Join(e.journal, candidate.server+".lock"))
		if err != nil {
			continue
		}
		path := filepath.Join(e.journal, candidate.name)
		rec, readErr := readReceipt(path)
		_, snapshotErr := os.Lstat(strings.TrimSuffix(path, ".json") + ".configs")
		info, statErr := os.Lstat(path)
		if readErr == nil && statErr == nil && info.Mode().IsRegular() && disposableCheck(rec, candidate.name) && os.IsNotExist(snapshotErr) {
			if err = os.Remove(path); err != nil && !os.IsNotExist(err) {
				release()
				return protected, errors.New("completed Steam check receipts could not be pruned")
			}
			_ = os.Remove(strings.TrimSuffix(path, ".json") + ".log")
			removed = true
		}
		release()
	}
	if removed {
		if err = syncDirectory(e.journal); err != nil {
			return protected, errors.New("Steam journal pruning could not be persisted")
		}
	}
	return protected, nil
}
