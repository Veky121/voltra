package steamexec

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"voltra/internal/steamapi"
)

// ClientStatus describes only the root-owned metadata client. Game-owned and
// private authenticated clients are intentionally outside this service.
type ClientStatus struct {
	Supported         bool       `json:"supported"`
	Scope             string     `json:"scope"`
	HelperImage       string     `json:"helper_image"`
	Version           string     `json:"version"`
	VersionObservedAt *time.Time `json:"version_observed_at"`
	LastAttemptAt     *time.Time `json:"last_attempt_at"`
	LastCheckedAt     *time.Time `json:"last_checked_at"`
	NextCheckAt       *time.Time `json:"next_check_at"`
	LastError         string     `json:"last_error"`
	Busy              bool       `json:"busy"`
	Initialized       bool       `json:"initialized"`
	ScheduleEnabled   bool       `json:"schedule_enabled"`
	RecoveryRequired  bool       `json:"recovery_required"`
}

var ErrClientBusy = errors.New("SteamCMD client maintenance is already running")
var ErrClientUnsupported = errors.New("SteamCMD client maintenance requires a native Linux amd64 node")

const clientMaintenanceID = "client-maintenance"
const clientCheckInterval = 24 * time.Hour

type clientMaintenance struct {
	mu        sync.Mutex
	state     ClientStatus
	loadError error
	ctx       context.Context
	wg        sync.WaitGroup
}

func (e *Executor) clientManager() *clientMaintenance {
	e.clientMaintenanceMu.Lock()
	defer e.clientMaintenanceMu.Unlock()
	if e.clientMaintenance != nil {
		return e.clientMaintenance
	}
	e.clientMaintenance = e.loadClientMaintenance()
	return e.clientMaintenance
}

func (e *Executor) loadClientMaintenance() *clientMaintenance {
	m := &clientMaintenance{state: ClientStatus{Supported: e.supported, Scope: "metadata", HelperImage: helperImage}}
	if !e.supported {
		return m
	}
	p := filepath.Join(e.journal, "client-maintenance", "state")
	if _, err := os.Lstat(p); os.IsNotExist(err) {
		return m
	}
	if err := e.clientStateDir(false); err != nil {
		m.loadError = err
		m.state.LastError = err.Error()
		m.state.RecoveryRequired = true
		return m
	}
	info, err := os.Lstat(p)
	if err != nil || !info.Mode().IsRegular() || info.Size() > 16384 {
		m.loadError = errors.New("SteamCMD maintenance state is invalid; operator recovery required")
	} else {
		f, openErr := os.Open(p)
		if openErr != nil {
			m.loadError = openErr
		} else {
			dec := json.NewDecoder(io.LimitReader(f, 16385))
			var saved struct {
				ClientStatus
				ScheduleEnabled *bool `json:"schedule_enabled"`
			}
			var extra any
			if dec.Decode(&saved) != nil || dec.Decode(&extra) != io.EOF || saved.Scope != "metadata" || saved.Version != "" && !clientVersionDigits.MatchString(saved.Version) {
				m.loadError = errors.New("SteamCMD maintenance state is invalid; operator recovery required")
			} else {
				m.state = saved.ClientStatus
				m.state.ScheduleEnabled = saved.NextCheckAt != nil
				if saved.ScheduleEnabled != nil {
					m.state.ScheduleEnabled = *saved.ScheduleEnabled
				}
				if !m.state.ScheduleEnabled {
					m.state.NextCheckAt = nil
				}
				m.state.Supported = e.supported
				m.state.HelperImage = helperImage
			}
			f.Close()
		}
	}
	if m.loadError != nil {
		m.state.LastError = "SteamCMD maintenance state is unreadable; operator recovery required"
		m.state.RecoveryRequired = true
	}
	if m.state.Busy {
		m.state.Busy = false
		m.state.NextCheckAt = nil
		m.state.ScheduleEnabled = false
		m.state.RecoveryRequired = true
		m.state.LastError = "Previous SteamCMD check was interrupted. Run a new check to recover its owned helper."
	}
	return m
}

// StartClientMaintenance is called once for the connector lifetime, outside its
// reconnect loop. A new node does not download anything until an admin checks it.
func (e *Executor) StartClientMaintenance(ctx context.Context) func() {
	m := e.clientManager()
	m.mu.Lock()
	if !e.supported || m.ctx != nil {
		m.mu.Unlock()
		return func() {}
	}
	runCtx, cancel := context.WithCancel(ctx)
	m.ctx = runCtx
	m.wg.Add(1)
	m.mu.Unlock()
	go func() {
		defer m.wg.Done()
		ticker := time.NewTicker(time.Minute)
		defer ticker.Stop()
		for {
			m.mu.Lock()
			due := m.state.ScheduleEnabled && m.state.NextCheckAt != nil && !time.Now().Before(*m.state.NextCheckAt) && !m.state.Busy && m.loadError == nil
			m.mu.Unlock()
			if due {
				_ = e.requestClientCheck(true)
			}
			select {
			case <-runCtx.Done():
				return
			case <-ticker.C:
			}
		}
	}()
	return func() { cancel(); m.mu.Lock(); m.mu.Unlock(); m.wg.Wait() }
}

func (e *Executor) ClientStatus() ClientStatus {
	m := e.clientManager()
	m.mu.Lock()
	defer m.mu.Unlock()
	status := m.state
	if e.supported && !status.Busy {
		if err := e.clientStoragePreflight(); err != nil {
			status.LastError = err.Error()
		}
	}
	return status
}

// Disabling the schedule leaves any current helper running to completion.
func (e *Executor) SetClientSchedule(enabled bool) error {
	m := e.clientManager()
	m.mu.Lock()
	defer m.mu.Unlock()
	if !e.supported {
		return ErrClientUnsupported
	}
	if m.loadError != nil {
		return errors.New(m.state.LastError)
	}
	if enabled && (!m.state.Initialized || m.state.RecoveryRequired) {
		return errors.New("Run a successful manual SteamCMD check before enabling its schedule")
	}
	if m.ctx == nil || m.ctx.Err() != nil {
		return errors.New("SteamCMD maintenance scheduler is unavailable")
	}
	if err := e.clientStateDir(true); err != nil {
		return err
	}
	if !m.state.Busy {
		lockCtx, cancel := context.WithTimeout(m.ctx, 100*time.Millisecond)
		release, err := lockClientCache(lockCtx, filepath.Join(e.journal, "client-maintenance", "check.lock"))
		cancel()
		if err != nil {
			return ErrClientBusy
		}
		defer release()
		fresh := e.loadClientMaintenance()
		if fresh.loadError != nil {
			return errors.New(fresh.state.LastError)
		}
		m.state = fresh.state
	}
	if enabled && (!m.state.Initialized || m.state.RecoveryRequired) {
		return errors.New("Run a successful manual SteamCMD check before enabling its schedule")
	}
	before := m.state
	m.state.ScheduleEnabled = enabled
	m.state.NextCheckAt = nil
	if enabled && !m.state.Busy {
		next := time.Now().UTC().Add(clientCheckInterval)
		m.state.NextCheckAt = &next
	}
	if err := writePrivate(filepath.Join(e.journal, "client-maintenance", "state"), m.state); err != nil {
		m.state = before
		return err
	}
	return nil
}

func (e *Executor) clientStateDir(create bool) error {
	dir := filepath.Join(e.journal, "client-maintenance")
	if err := e.clientStoragePreflight(); err != nil {
		return err
	}
	if create {
		// Reject an existing redirected journal before creating a child in it.
		if _, err := os.Lstat(e.journal); err == nil {
			resolved, resolveErr := filepath.EvalSymlinks(e.journal)
			if resolveErr != nil || resolved != e.journal {
				return errors.New("SteamCMD maintenance storage must not contain symlinks")
			}
		}
		if err := os.MkdirAll(dir, 0700); err != nil {
			return errors.New("SteamCMD maintenance storage unavailable")
		}
	}
	for _, p := range []string{e.journal, dir} {
		resolved, err := filepath.EvalSymlinks(p)
		if err != nil || resolved != p {
			return errors.New("SteamCMD maintenance storage must not contain symlinks")
		}
		info, err := os.Stat(p)
		if err != nil || !info.IsDir() {
			return errors.New("SteamCMD maintenance storage unavailable")
		}
		if uid, _, ok := fileOwner(info); ok && (uid != uint32(os.Geteuid()) || info.Mode().Perm()&0077 != 0) {
			return errors.New("SteamCMD maintenance storage must be private and node-owned")
		}
	}
	return nil
}

// Status reads must expose unusable existing storage even before the first
// check creates its state file. A fresh node with no storage is still ready.
func (e *Executor) clientStoragePreflight() error {
	for _, path := range []string{e.journal, filepath.Join(e.journal, "client-maintenance")} {
		info, err := os.Lstat(path)
		if os.IsNotExist(err) {
			continue
		}
		if err != nil || !info.IsDir() {
			return errors.New("SteamCMD maintenance storage unavailable; repair the node's Steam journal directory")
		}
		resolved, err := filepath.EvalSymlinks(path)
		if err != nil || resolved != path {
			return errors.New("SteamCMD maintenance storage must not contain symlinks")
		}
		if uid, _, ok := fileOwner(info); ok && (uid != uint32(os.Geteuid()) || info.Mode().Perm()&0077 != 0) {
			return errors.New("SteamCMD maintenance storage must be private and node-owned; repair its ownership and set directory permissions to 0700")
		}
	}
	return nil
}

func (e *Executor) RequestClientCheck() error {
	return e.requestClientCheck(false)
}

func (e *Executor) requestClientCheck(scheduled bool) error {
	m := e.clientManager()
	m.mu.Lock()
	defer m.mu.Unlock()
	if !e.supported {
		return ErrClientUnsupported
	}
	if m.loadError != nil {
		return errors.New(m.state.LastError)
	}
	if m.ctx == nil || m.ctx.Err() != nil {
		return errors.New("SteamCMD maintenance scheduler is unavailable")
	}
	if m.state.Busy {
		return ErrClientBusy
	}
	// Recheck under the same mutex as schedule edits. A tick selected before
	// Disable was saved cannot start a new download afterwards.
	if scheduled && (!m.state.ScheduleEnabled || m.state.NextCheckAt == nil || time.Now().Before(*m.state.NextCheckAt) || m.state.RecoveryRequired) {
		return nil
	}
	if err := e.clientStateDir(true); err != nil {
		return err
	}
	// The private directory and no-follow lock prevent cross-process overlap.
	lockCtx, lockCancel := context.WithTimeout(m.ctx, 100*time.Millisecond)
	release, err := lockClientCache(lockCtx, filepath.Join(e.journal, "client-maintenance", "check.lock"))
	lockCancel()
	if err != nil {
		return ErrClientBusy
	}
	// Another node process may have completed a check or changed the schedule
	// since our last snapshot. Reload only after obtaining its shared lock.
	fresh := e.loadClientMaintenance()
	if fresh.loadError != nil {
		release()
		return errors.New(fresh.state.LastError)
	}
	m.state = fresh.state
	if scheduled && (!m.state.ScheduleEnabled || m.state.NextCheckAt == nil || time.Now().Before(*m.state.NextCheckAt) || m.state.RecoveryRequired) {
		release()
		return nil
	}
	releaseSlot, err := e.reserveMaintenance(clientMaintenanceID)
	if err != nil {
		release()
		return err
	}
	started := time.Now().UTC()
	before := m.state
	m.state.Busy = true
	m.state.LastAttemptAt = &started
	m.state.NextCheckAt = nil
	m.state.LastError = ""
	if !m.state.Initialized {
		m.state.ScheduleEnabled = true
	}
	m.state.Initialized = true
	if err = writePrivate(filepath.Join(e.journal, "client-maintenance", "state"), m.state); err != nil {
		m.state = before
		release()
		releaseSlot()
		return err
	}
	m.wg.Add(1)
	go func() {
		defer m.wg.Done()
		ctx, cancel := context.WithTimeout(m.ctx, 6*time.Minute)
		defer cancel()
		version, checkErr := e.checkClient(ctx)
		finished := time.Now().UTC()
		next := finished.Add(clientCheckInterval)
		m.mu.Lock()
		defer m.mu.Unlock()
		defer release()
		defer releaseSlot()
		m.state.Busy = false
		m.state.NextCheckAt = nil
		if m.state.ScheduleEnabled {
			m.state.NextCheckAt = &next
		}
		if checkErr != nil {
			m.state.LastError = checkErr.Error()
			if errors.Is(checkErr, errCleanup) || ctx.Err() != nil {
				// An interrupted helper needs explicit recovery, not an automatic
				// retry after a process restart or uncertain Docker cleanup.
				m.state.NextCheckAt = nil
				m.state.ScheduleEnabled = false
				m.state.RecoveryRequired = true
			}
		} else {
			m.state.Version = version
			m.state.VersionObservedAt = &finished
			m.state.LastCheckedAt = &finished
			m.state.LastError = ""
			m.state.RecoveryRequired = false
		}
		if err := writePrivate(filepath.Join(e.journal, "client-maintenance", "state"), m.state); err != nil {
			m.state.LastError = "SteamCMD check ended but its result could not be saved; operator recovery required"
			m.state.NextCheckAt = nil
			m.state.RecoveryRequired = true
			m.loadError = err
		}
	}()
	return nil
}

var clientVersionMarker = regexp.MustCompile(`(?m)^Steam Console Client \(c\) Valve Corporation - version ([0-9]{6,20})\s*$`)
var clientVersionDigits = regexp.MustCompile(`^[0-9]{6,20}$`)

func parseClientVersion(raw string) (string, error) {
	lower := strings.ToLower(raw)
	if strings.Contains(lower, "error!") || strings.Contains(lower, "fatal error") || strings.Contains(lower, "steamupdater: error") {
		return "", errors.New("SteamCMD update failed; check node disk space and Steam connectivity")
	}
	matches := clientVersionMarker.FindAllStringSubmatch(raw, -1)
	if len(matches) == 0 {
		return "", errors.New("SteamCMD completed without a verified client version")
	}
	return matches[len(matches)-1][1], nil
}

func (e *Executor) checkClient(ctx context.Context) (string, error) {
	id, cacheScope := clientMaintenanceID, "metadata"
	if e.clientMaintenanceTestID != "" {
		id, cacheScope = e.clientMaintenanceTestID, e.clientMaintenanceTestID
	}
	cache, release, err := e.clientCache(ctx, steamapi.Request{ServerUUID: "00000000-0000-0000-0000-000000000000"}, 0, 0, false)
	if err != nil {
		return "", err
	}
	defer release()
	if err = e.cleanup(id); err != nil {
		return "", err
	}
	active := &cappedOutput{max: 4096}
	if err = e.docker.Run(ctx, []string{"ps", "-q", "--filter", "label=" + clientCacheLabel + "=" + cacheScope}, active); err != nil {
		return "", errors.New("SteamCMD cache usage could not be checked")
	}
	if raw, cut := active.text(); cut || strings.TrimSpace(raw) != "" {
		return "", errors.New("SteamCMD metadata cache is in use by another helper; retry after it stops")
	}
	args := []string{"run", "--name", helperName(id), "--label", helperLabel + "=" + id, "--label", clientCacheLabel + "=" + cacheScope, "--rm", "--pull", "missing", "--platform", "linux/amd64", "--init", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--pids-limit", "128", "--memory", "1g", "--cpus", "1", "--log-driver", "none", "--tmpfs", "/tmp:rw,exec,nosuid,size=1g", "--env", "HOME=/tmp", "--workdir", "/tmp", "--mount", "type=bind,src=" + cache + ",dst=/tmp/.local/share/Steam", "--entrypoint", "/usr/bin/timeout", helperImage, "--signal=TERM", "--kill-after=30s", "300s", "/usr/bin/steamcmd", "+@ShutdownOnFailedCommand", "1", "+@NoPromptForPassword", "1", "+quit"}
	output := &cappedOutput{max: 256 << 10}
	done, exited := make(chan struct{}), make(chan struct{})
	go func() {
		defer close(exited)
		select {
		case <-ctx.Done():
			_ = e.cleanup(id)
		case <-done:
		}
	}()
	runErr := e.docker.Run(ctx, args, output)
	close(done)
	<-exited
	if err = e.cleanup(id); err != nil {
		return "", err
	}
	if ctx.Err() != nil {
		return "", errors.New("SteamCMD check cancelled or timed out")
	}
	if runErr != nil {
		return "", errors.New("SteamCMD check failed; check node disk space, Docker and Steam connectivity")
	}
	raw, cut := output.text()
	if cut {
		return "", errors.New("SteamCMD check output exceeded its safety limit")
	}
	return parseClientVersion(raw)
}
