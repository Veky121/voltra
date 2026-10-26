// Package steamexec runs bounded SteamCMD maintenance on a locally owned Wings
// server. It has no Panel dependencies and accepts no caller-supplied paths.
package steamexec

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"time"

	"voltra/internal/steamapi"
)

type Executor struct {
	docker               Docker
	wingsConfig, journal string
	supported            bool
	mu                   sync.Mutex
	active               map[string]bool
	slots                chan struct{}
	// Test seams remain package private, never protocol or Config settings.
	pollInterval, timeLimit time.Duration
	owner                   func(os.FileInfo) (uint32, uint32, bool)
	modSpace                func(string) (uint64, error)
	cacheOwner              func(string, uint32, uint32, bool) error
}

func New() *Executor {
	return &Executor{docker: localDocker{}, wingsConfig: "/etc/voltra/wings.yml", journal: "/var/lib/voltra/steam-jobs", supported: Supported(), active: map[string]bool{}, slots: make(chan struct{}, 2), pollInterval: time.Second, timeLimit: 2 * time.Hour, owner: fileOwner, modSpace: palworldDiskAvailable, cacheOwner: prepareClientCacheOwner}
}

type record struct {
	Request        steamapi.Request
	Terminal       *steamapi.Event
	Mutating       bool
	RecoveryNeeded bool
	PalworldMods   bool `json:",omitempty"`
}

func phaseID(r steamapi.Request) string { return r.JobID + "-" + r.Operation }

func (e *Executor) Run(ctx context.Context, r steamapi.Request, emit func(steamapi.Event) error) {
	terminal := steamapi.Event{Type: "error", Stage: "failed"}
	fail := func(err error) { terminal.Error = err.Error(); terminal.Detail = err.Error(); _ = emit(terminal) }
	if err := r.Normalize(); err != nil {
		fail(err)
		return
	}
	if r.BetaPassword != "" {
		fail(errors.New("private branch credentials are not enabled in this node build"))
		return
	}
	if !e.supported {
		fail(errors.New("Steam maintenance requires a native Linux amd64 node"))
		return
	}
	releaseReservation, err := e.reserveMaintenance(r.ServerUUID)
	if err != nil {
		fail(err)
		return
	}
	defer releaseReservation()
	ctx, cancel := context.WithTimeout(ctx, e.timeLimit)
	defer cancel()
	if err := os.MkdirAll(e.journal, 0700); err != nil {
		fail(errors.New("Steam journal unavailable"))
		return
	}
	protected, maintenanceErr := e.maintainJournal(ctx, time.Now())
	if maintenanceErr != nil {
		fail(maintenanceErr)
		return
	}
	release, lockErr := lockServer(filepath.Join(e.journal, r.ServerUUID+".lock"))
	if lockErr != nil {
		fail(lockErr)
		return
	}
	defer release()
	journal := filepath.Join(e.journal, phaseID(r)+".json")
	backup := filepath.Join(e.journal, phaseID(r)+".configs")
	var old record
	if f, err := os.Open(journal); err == nil {
		decodeErr := json.NewDecoder(io.LimitReader(f, 16384)).Decode(&old)
		f.Close()
		if decodeErr != nil {
			fail(errors.New("Steam journal invalid; operator recovery required"))
			return
		}
		if old.Request.WithoutCredentials() != r.WithoutCredentials() {
			fail(errors.New("job_id was already used with different inputs"))
			return
		}
		if old.Terminal != nil && !old.RecoveryNeeded {
			_ = emit(*old.Terminal)
			return
		}
		terminal.FilesChanged = old.Mutating
		if err := e.cleanup(phaseID(r)); err != nil {
			fail(err)
			return
		}
		if old.Mutating {
			dir, state, err := e.gamePath(ctx, r)
			if err != nil {
				fail(err)
				return
			}
			if running(state) {
				fail(errors.New("stop the game before restoring interrupted maintenance configuration"))
				return
			}
			if err = restoreConfigs(dir, backup); err != nil {
				fail(err)
				return
			}
			if old.PalworldMods {
				if err = restorePalworldMods(dir, filepath.Join(e.journal, phaseID(r)+".palworld-mods")); err != nil {
					fail(err)
					return
				}
			}
		}
		terminal.Error = "previous execution interrupted; use a new job ID to check or repair while stopped"
		terminal.Detail = terminal.Error
		old.Terminal = &terminal
		old.RecoveryNeeded = false
		if err := writePrivate(journal, old); err != nil {
			fail(err)
			return
		}
		if old.PalworldMods {
			removePalworldModBackup(filepath.Join(e.journal, phaseID(r)+".palworld-mods"))
		}
		_ = emit(terminal)
		return
	} else if !os.IsNotExist(err) {
		fail(errors.New("Steam journal unreadable"))
		return
	}
	if err := e.recoverServer(ctx, r); err != nil {
		terminal.FilesChanged = r.Operation != "check"
		fail(err)
		return
	}
	// Read-only checks remain usable even when mutation receipts need archiving.
	// Never evict mutation IDs or pending/recovery records to make room.
	if r.Operation != "check" && protected >= protectedReceiptLimit {
		fail(errors.New("Steam mutation receipt capacity reached; operator must archive completed mutation receipts, retaining IDs if replay protection is required; never remove pending jobs or recovery backups"))
		return
	}
	f, err := os.OpenFile(journal, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		fail(errors.New("Steam job claim failed; retry after current execution"))
		return
	}
	rec := record{Request: r.WithoutCredentials()}
	err = json.NewEncoder(f).Encode(rec)
	if err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err == nil {
		err = closeErr
	}
	if err == nil {
		err = syncDirectory(e.journal)
	}
	if err != nil {
		fail(errors.New("Steam job claim could not be persisted"))
		return
	}
	// All outcomes after claiming are durable. A failed terminal write becomes
	// an interrupted receipt, never permission to replay the mutation.
	defer func() {
		rec.Terminal = &terminal
		if err := writePrivate(journal, rec); err != nil {
			terminal.Type = "error"
			terminal.Error = err.Error()
			terminal.Detail = err.Error()
		} else if !rec.RecoveryNeeded {
			_ = os.Remove(backup)
			removePalworldModBackup(filepath.Join(e.journal, phaseID(r)+".palworld-mods"))
		}
		_ = emit(terminal)
	}()
	progress := func(stage, detail string) error {
		return emit(steamapi.Event{Type: "progress", Stage: stage, Detail: detail, FilesChanged: terminal.FilesChanged})
	}
	finishError := func(err error) {
		terminal.Type = "error"
		terminal.Stage = "failed"
		terminal.Error = err.Error()
		terminal.Detail = err.Error()
	}
	if err = progress("preflight", "Checking Wings game mount and Docker state."); err != nil {
		finishError(errors.New("Steam stream disconnected"))
		return
	}
	dir, c, err := e.gamePath(ctx, r)
	if err != nil {
		finishError(err)
		return
	}
	mutation := r.Operation != "check"
	if mutation && running(c) {
		finishError(errors.New("stop the game before Steam install, update or verify"))
		return
	}
	if mutation {
		if err = e.prepareGameOwner(ctx, r, dir); err != nil {
			finishError(err)
			return
		}
	}
	var palworldPaths palworldProtectedPaths
	if mutation && windowsPalworld(r) {
		if palworldPaths, err = e.palworldLoader(ctx, r, dir, "preflight"); err != nil {
			finishError(err)
			return
		}
	}
	installed, readErr := readInstalledRequest(dir, r)
	if readErr != nil && r.Operation == "check" {
		finishError(readErr)
		return
	}
	terminal.InstalledBuild = installed
	if err = progress("metadata", "Retrieving Steam branch build metadata."); err != nil {
		finishError(errors.New("Steam stream disconnected"))
		return
	}
	meta := &cappedOutput{max: 4 << 20}
	var metadataWriter io.Writer = meta
	var metadataStream *consoleOutput
	if r.StreamOutput {
		metadataStream = &consoleOutput{captured: meta, emit: emit, metadata: true}
		metadataWriter = metadataStream
	}
	err = e.helper(ctx, r, "", false, metadataWriter)
	if metadataStream != nil {
		if streamErr := metadataStream.finish(); err == nil && streamErr != nil {
			err = errors.New("Steam console stream disconnected")
		}
	}
	if err != nil {
		finishError(err)
		return
	}
	raw, truncated := meta.text()
	if truncated {
		finishError(errors.New("Steam metadata output exceeds limit"))
		return
	}
	latest, err := latestBuild(raw, r.AppID, r.Branch)
	if err != nil {
		finishError(err)
		return
	}
	terminal.LatestBuild = latest
	terminal.UpdateAvailable = installed != latest
	if !mutation {
		terminal.Type = "result"
		terminal.Stage = "complete"
		terminal.Detail = "Steam build check complete."
		if installed == latest {
			terminal.Detail = "Game is up to date (build " + installed + ")."
		} else {
			terminal.Detail = "Game update available (installed " + installed + ", latest " + latest + ")."
		}
		return
	}
	// State may have changed during the metadata network request.
	c, err = e.inspect(ctx, r.ServerUUID)
	if err != nil {
		finishError(err)
		return
	}
	if running(c) {
		finishError(errors.New("game started before maintenance; stop it and retry"))
		return
	}
	if err = backupConfigs(dir, backup, r.AppID); err != nil {
		finishError(err)
		return
	}
	if windowsPalworld(r) {
		if err = backupPalworldMods(dir, filepath.Join(e.journal, phaseID(r)+".palworld-mods"), palworldPaths, e.modSpace); err != nil {
			finishError(err)
			return
		}
		rec.PalworldMods = true
	}
	rec.Mutating = true
	rec.RecoveryNeeded = true
	if err = writePrivate(journal, rec); err != nil {
		finishError(err)
		return
	}
	terminal.FilesChanged = true
	if err = progress("executing", "Running SteamCMD; existing saves and configuration are retained."); err != nil {
		finishError(errors.New("Steam stream disconnected"))
		return
	}
	runCtx, stop := context.WithCancel(ctx)
	monitorDone := make(chan struct{})
	monitorExit := make(chan error, 1)
	go func() {
		t := time.NewTicker(e.pollInterval)
		defer t.Stop()
		for {
			select {
			case <-monitorDone:
				monitorExit <- nil
				return
			case <-runCtx.Done():
				monitorExit <- nil
				return
			case <-t.C:
				state, err := e.inspect(runCtx, r.ServerUUID)
				if err != nil || running(state) {
					stop()
					monitorExit <- errors.New("game started or its stopped state could not be verified; maintenance interrupted")
					return
				}
			}
		}
	}()
	output := &cappedOutput{max: 64 << 10}
	var writer io.Writer = output
	var stream *consoleOutput
	if r.StreamOutput {
		stream = &consoleOutput{captured: output, emit: emit}
		writer = stream
	}
	err = e.helper(runCtx, r, dir, true, writer)
	if stream != nil {
		if streamErr := stream.finish(); err == nil && streamErr != nil {
			err = errors.New("Steam console stream disconnected")
		}
	}
	close(monitorDone)
	monitorErr := <-monitorExit
	stop()
	if errors.Is(err, errCleanup) {
		finishError(err)
		return
	}
	// Never restore configuration while an external actor has started the game.
	restoreCtx, restoreCancel := context.WithTimeout(context.Background(), 15*time.Second)
	state, stateErr := e.inspect(restoreCtx, r.ServerUUID)
	restoreCancel()
	if stateErr != nil || running(state) {
		finishError(errors.New("game stopped state unavailable; stop the game and retry to restore preserved configuration"))
		return
	}
	if restoreErr := restoreConfigs(dir, backup); restoreErr != nil {
		finishError(restoreErr)
		return
	}
	if rec.PalworldMods {
		if restoreErr := restorePalworldMods(dir, filepath.Join(e.journal, phaseID(r)+".palworld-mods")); restoreErr != nil {
			finishError(restoreErr)
			return
		}
	}
	if err != nil {
		rec.RecoveryNeeded = false
		finishError(err)
		return
	}
	if monitorErr != nil {
		rec.RecoveryNeeded = false
		finishError(monitorErr)
		return
	}
	if windowsPalworld(r) {
		_, loaderErr := e.palworldLoader(ctx, r, dir, "install")
		cleanup, cleanupCancel := context.WithTimeout(context.Background(), 15*time.Second)
		current, stateErr := e.inspect(cleanup, r.ServerUUID)
		cleanupCancel()
		if stateErr != nil || running(current) {
			finishError(errors.New("stop the game to recover protected Palworld mods after loader maintenance"))
			return
		}
		if restoreErr := restorePalworldMods(dir, filepath.Join(e.journal, phaseID(r)+".palworld-mods")); restoreErr != nil {
			finishError(restoreErr)
			return
		}
		rec.RecoveryNeeded = false
		if loaderErr != nil {
			finishError(loaderErr)
			return
		}
	}
	rec.RecoveryNeeded = false
	installed, err = readInstalledRequest(dir, r)
	if err != nil || installed == "" {
		finishError(errors.New("SteamCMD did not produce a complete installed manifest; run verify while stopped"))
		return
	}
	terminal.InstalledBuild = installed
	terminal.UpdateAvailable = installed != latest
	if terminal.UpdateAvailable {
		finishError(errors.New("installed build differs from requested branch metadata; check again before starting"))
		return
	}
	terminal.Type = "result"
	terminal.Stage = "complete"
	terminal.Detail = "Steam maintenance complete; existing configuration restored."
}

func readInstalled(dir string, app int64) (string, error) {
	root, err := os.OpenRoot(dir)
	if err != nil {
		return "", errors.New("game directory unavailable")
	}
	defer root.Close()
	f, err := root.Open("steamapps/appmanifest_" + strconv.FormatInt(app, 10) + ".acf")
	if os.IsNotExist(err) {
		return "", nil
	}
	if err != nil {
		return "", errors.New("installed Steam manifest unreadable")
	}
	defer f.Close()
	raw, err := io.ReadAll(io.LimitReader(f, 1<<20+1))
	if err != nil || len(raw) > 1<<20 {
		return "", fmt.Errorf("installed Steam manifest exceeds read limit")
	}
	return installedBuild(string(raw), app)
}
