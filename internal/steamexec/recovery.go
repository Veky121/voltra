package steamexec

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"

	"voltra/internal/steamapi"
)

// A new phase cannot bypass an orphaned older helper or an unrestored config
// backup. Only the current server is recovered, under its active-server lock.
func (e *Executor) recoverServer(ctx context.Context, r steamapi.Request) error {
	entries, err := os.ReadDir(e.journal)
	if err != nil {
		return errors.New("Steam journal recovery unavailable")
	}
	for _, entry := range entries {
		if !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		path := filepath.Join(e.journal, entry.Name())
		f, err := os.Open(path)
		if err != nil {
			return errors.New("Steam journal recovery unreadable")
		}
		var rec record
		err = json.NewDecoder(io.LimitReader(f, 16384)).Decode(&rec)
		f.Close()
		if err != nil {
			return errors.New("Steam journal recovery invalid; operator review required")
		}
		if rec.Request.ServerUUID != r.ServerUUID || (rec.Terminal != nil && !rec.RecoveryNeeded) {
			continue
		}
		if rec.Request.Normalize() != nil || entry.Name() != phaseID(rec.Request)+".json" {
			return errors.New("Steam journal recovery identity invalid")
		}
		if err = e.cleanup(phaseID(rec.Request)); err != nil {
			return err
		}
		if rec.Mutating && r.Operation == "check" {
			return errors.New("interrupted Steam mutation requires update or verify while stopped before checking")
		}
		backup := filepath.Join(e.journal, phaseID(rec.Request)+".configs")
		if rec.Mutating {
			dir, state, err := e.gamePath(ctx, rec.Request)
			if err != nil {
				return err
			}
			if running(state) {
				return errors.New("stop the game to recover interrupted Steam configuration before continuing")
			}
			if err = restoreConfigs(dir, backup); err != nil {
				return err
			}
			if rec.PalworldMods {
				if err = restorePalworldMods(dir, filepath.Join(e.journal, phaseID(rec.Request)+".palworld-mods")); err != nil {
					return err
				}
			}
		}
		rec.RecoveryNeeded = false
		rec.Terminal = &steamapi.Event{Type: "error", Stage: "interrupted", Error: "previous execution interrupted; run a new repair job while stopped", Detail: "Previous execution interrupted; configuration restored where necessary.", FilesChanged: rec.Mutating}
		if err = writePrivate(path, rec); err != nil {
			return err
		}
		_ = os.Remove(backup)
		removePalworldModBackup(filepath.Join(e.journal, phaseID(rec.Request)+".palworld-mods"))
	}
	return nil
}
