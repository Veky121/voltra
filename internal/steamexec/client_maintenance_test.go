package steamexec

import (
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

type clientDocker struct {
	mu             sync.Mutex
	calls          [][]string
	output         string
	runErr         error
	block          chan struct{}
	active         bool
	cleanupFailure bool
}

func (d *clientDocker) Run(ctx context.Context, args []string, out io.Writer) error {
	d.mu.Lock()
	d.calls = append(d.calls, append([]string(nil), args...))
	d.mu.Unlock()
	if args[0] == "run" {
		if d.block != nil {
			select {
			case <-d.block:
			case <-ctx.Done():
				return ctx.Err()
			}
		}
		_, _ = io.WriteString(out, d.output)
		return d.runErr
	}
	if args[0] == "ps" {
		if strings.Contains(strings.Join(args, " "), "name=^") && d.cleanupFailure {
			return errors.New("unavailable")
		}
		if d.active && strings.Contains(strings.Join(args, " "), clientCacheLabel) {
			_, _ = io.WriteString(out, "another-helper")
		}
	}
	return nil
}
func clientTestExecutor(t *testing.T, d *clientDocker) *Executor {
	t.Helper()
	e := New()
	e.supported = true
	e.journal = t.TempDir()
	_ = os.Chmod(e.journal, 0700)
	e.docker = d
	e.cacheOwner = func(string, uint32, uint32, bool) error { return nil }
	return e
}
func awaitClient(t *testing.T, e *Executor) ClientStatus {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		s := e.ClientStatus()
		if !s.Busy {
			return s
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatal("client check did not finish")
	return ClientStatus{}
}
func TestClientVersionRequiresRealMarker(t *testing.T) {
	for _, raw := range []string{"", "version 1234567890", "Steam Console Client (c) Valve Corporation - version 1234567890\nERROR! Failed"} {
		if _, err := parseClientVersion(raw); err == nil {
			t.Fatalf("accepted %q", raw)
		}
	}
	version, err := parseClientVersion("Steam Console Client (c) Valve Corporation - version 1234567890\r\nLoading Steam API...OK\r\n")
	if err != nil || version != "1234567890" {
		t.Fatalf("%q %v", version, err)
	}
}
func TestClientMaintenanceIsExplicitAndPersistsSchedule(t *testing.T) {
	d := &clientDocker{output: "Steam Console Client (c) Valve Corporation - version 1234567890\n"}
	e := clientTestExecutor(t, d)
	stop := e.StartClientMaintenance(context.Background())
	defer stop()
	if s := e.ClientStatus(); s.Initialized || s.NextCheckAt != nil || s.Version != "" {
		t.Fatalf("fresh state %#v", s)
	}
	if err := e.RequestClientCheck(); err != nil {
		t.Fatal(err)
	}
	s := awaitClient(t, e)
	if s.LastError != "" || s.Version != "1234567890" || s.LastCheckedAt == nil || s.NextCheckAt == nil || s.NextCheckAt.Sub(*s.LastCheckedAt) != 24*time.Hour {
		t.Fatalf("result %#v", s)
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	for _, args := range d.calls {
		if args[0] == "run" {
			joined := strings.Join(args, " ")
			for _, forbidden := range []string{"+login", "+app_update", "server-", "dst=/data"} {
				if strings.Contains(joined, forbidden) {
					t.Fatal(joined)
				}
			}
			if !strings.Contains(joined, "--pull missing") || !strings.Contains(joined, "+quit") {
				t.Fatal(joined)
			}
		}
	}
	again := New()
	again.supported = true
	again.journal = e.journal
	if got := again.ClientStatus(); got.Version != s.Version || got.NextCheckAt == nil || !got.NextCheckAt.Equal(*s.NextCheckAt) {
		t.Fatalf("reloaded %#v", got)
	}
}
func TestClientMaintenanceRejectsOverlapAndPreservesSuccessOnFailure(t *testing.T) {
	d := &clientDocker{output: "Steam Console Client (c) Valve Corporation - version 1234567890\n", block: make(chan struct{})}
	e := clientTestExecutor(t, d)
	stop := e.StartClientMaintenance(context.Background())
	defer stop()
	if err := e.RequestClientCheck(); err != nil {
		t.Fatal(err)
	}
	if err := e.RequestClientCheck(); !errors.Is(err, ErrClientBusy) {
		t.Fatal(err)
	}
	close(d.block)
	first := awaitClient(t, e)
	d.block = nil
	d.output = "no version"
	if err := e.RequestClientCheck(); err != nil {
		t.Fatal(err)
	}
	failed := awaitClient(t, e)
	if failed.LastError == "" || failed.Version != first.Version || !failed.LastCheckedAt.Equal(*first.LastCheckedAt) {
		t.Fatalf("failed %#v", failed)
	}
}
func TestClientMaintenanceRefusesActiveCacheAndCleanupFailure(t *testing.T) {
	for _, which := range []string{"active", "cleanup", "truncated"} {
		t.Run(which, func(t *testing.T) {
			d := &clientDocker{active: which == "active", cleanupFailure: which == "cleanup"}
			if which == "truncated" {
				d.output = strings.Repeat("x", 300<<10)
			}
			e := clientTestExecutor(t, d)
			stop := e.StartClientMaintenance(context.Background())
			defer stop()
			if err := e.RequestClientCheck(); err != nil {
				t.Fatal(err)
			}
			s := awaitClient(t, e)
			if s.LastError == "" || s.Version != "" || s.LastCheckedAt != nil {
				t.Fatalf("false success %#v", s)
			}
		})
	}
}
func TestClientMaintenanceUnsupportedAndCorruptState(t *testing.T) {
	e := New()
	e.supported = false
	if err := e.RequestClientCheck(); !errors.Is(err, ErrClientUnsupported) {
		t.Fatal(err)
	}
	e = clientTestExecutor(t, &clientDocker{})
	dir := filepath.Join(e.journal, "client-maintenance")
	_ = os.Mkdir(dir, 0700)
	_ = os.WriteFile(filepath.Join(dir, "state"), []byte("garbage"), 0600)
	stop := e.StartClientMaintenance(context.Background())
	defer stop()
	if err := e.RequestClientCheck(); err == nil {
		t.Fatal("accepted corrupt state")
	}
}
func TestClientMaintenanceCancellationHasNoSuccess(t *testing.T) {
	d := &clientDocker{block: make(chan struct{})}
	e := clientTestExecutor(t, d)
	ctx, cancel := context.WithCancel(context.Background())
	stop := e.StartClientMaintenance(ctx)
	if err := e.RequestClientCheck(); err != nil {
		t.Fatal(err)
	}
	cancel()
	stop()
	s := e.ClientStatus()
	if s.Busy || s.LastError == "" || s.LastCheckedAt != nil {
		t.Fatalf("cancel state %#v", s)
	}
}

func TestClientMaintenanceResumesDueSchedule(t *testing.T) {
	d := &clientDocker{output: "Steam Console Client (c) Valve Corporation - version 1234567890\n"}
	e := clientTestExecutor(t, d)
	dir := filepath.Join(e.journal, "client-maintenance")
	if err := os.Mkdir(dir, 0700); err != nil {
		t.Fatal(err)
	}
	past := time.Now().Add(-time.Hour)
	if err := writePrivate(filepath.Join(dir, "state"), ClientStatus{Scope: "metadata", Initialized: true, ScheduleEnabled: true, NextCheckAt: &past}); err != nil {
		t.Fatal(err)
	}
	stop := e.StartClientMaintenance(context.Background())
	defer stop()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		s := e.ClientStatus()
		if s.LastCheckedAt != nil {
			if s.Version != "1234567890" || s.NextCheckAt == nil {
				t.Fatalf("state %#v", s)
			}
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatal("persisted due schedule did not execute")
}

func TestClientMaintenanceScheduleCanBeDisabledDuringCheck(t *testing.T) {
	d := &clientDocker{output: "Steam Console Client (c) Valve Corporation - version 1234567890\n", block: make(chan struct{})}
	e := clientTestExecutor(t, d)
	stop := e.StartClientMaintenance(context.Background())
	defer stop()
	if err := e.SetClientSchedule(true); err == nil {
		t.Fatal("enabled before first explicit check")
	}
	if err := e.RequestClientCheck(); err != nil {
		t.Fatal(err)
	}
	if err := e.SetClientSchedule(false); err != nil {
		t.Fatal(err)
	}
	if !e.ClientStatus().Busy {
		t.Fatal("disable cancelled the running check")
	}
	close(d.block)
	s := awaitClient(t, e)
	if s.ScheduleEnabled || s.NextCheckAt != nil || s.LastCheckedAt == nil {
		t.Fatalf("disabled schedule %#v", s)
	}
	d.block = nil
	if err := e.RequestClientCheck(); err != nil {
		t.Fatal(err)
	}
	if s = awaitClient(t, e); s.ScheduleEnabled || s.NextCheckAt != nil {
		t.Fatal("manual check re-enabled schedule")
	}
	if err := e.SetClientSchedule(true); err != nil {
		t.Fatal(err)
	}
	if s = e.ClientStatus(); !s.ScheduleEnabled || s.NextCheckAt == nil {
		t.Fatal("schedule not enabled")
	}
	again := New()
	again.supported = true
	again.journal = e.journal
	if !again.ClientStatus().ScheduleEnabled {
		t.Fatal("schedule not persisted")
	}
}

func TestClientMaintenanceSharesSteamCapacity(t *testing.T) {
	e := clientTestExecutor(t, &clientDocker{})
	stop := e.StartClientMaintenance(context.Background())
	defer stop()
	r1, err := e.reserveMaintenance("one")
	if err != nil {
		t.Fatal(err)
	}
	defer r1()
	r2, err := e.reserveMaintenance("two")
	if err != nil {
		t.Fatal(err)
	}
	defer r2()
	if err = e.RequestClientCheck(); err == nil {
		t.Fatal("ignored occupied Steam capacity")
	}
	if e.ClientStatus().Busy {
		t.Fatal("failed admission marked busy")
	}
}

func TestClientMaintenanceStaleSchedulerRechecksPersistedDueTime(t *testing.T) {
	d := &clientDocker{output: "Steam Console Client (c) Valve Corporation - version 1234567890\n"}
	e := clientTestExecutor(t, d)
	stop := e.StartClientMaintenance(context.Background())
	defer stop()
	if err := e.RequestClientCheck(); err != nil {
		t.Fatal(err)
	}
	awaitClient(t, e)
	d.mu.Lock()
	before := len(d.calls)
	d.mu.Unlock()
	m := e.clientManager()
	m.mu.Lock()
	past := time.Now().Add(-time.Hour)
	m.state.NextCheckAt = &past
	m.mu.Unlock()
	if err := e.requestClientCheck(true); err != nil {
		t.Fatal(err)
	}
	d.mu.Lock()
	after := len(d.calls)
	d.mu.Unlock()
	if before != after || e.ClientStatus().Busy {
		t.Fatal("stale schedule ran a duplicate check")
	}
	if err := e.SetClientSchedule(false); err != nil {
		t.Fatal(err)
	}
	if err := e.requestClientCheck(true); err != nil {
		t.Fatal(err)
	}
	if e.ClientStatus().Busy {
		t.Fatal("disabled schedule started a check")
	}
}

func TestClientMaintenanceInterruptedStateRequiresExplicitRecovery(t *testing.T) {
	e := clientTestExecutor(t, &clientDocker{})
	dir := filepath.Join(e.journal, "client-maintenance")
	_ = os.Mkdir(dir, 0700)
	past := time.Now().Add(-time.Hour)
	if err := writePrivate(filepath.Join(dir, "state"), ClientStatus{Scope: "metadata", Busy: true, NextCheckAt: &past}); err != nil {
		t.Fatal(err)
	}
	stop := e.StartClientMaintenance(context.Background())
	defer stop()
	s := e.ClientStatus()
	if s.Busy || s.NextCheckAt != nil || !strings.Contains(s.LastError, "interrupted") {
		t.Fatalf("state %#v", s)
	}
}
