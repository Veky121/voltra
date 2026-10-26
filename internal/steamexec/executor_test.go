package steamexec

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"voltra/internal/steamapi"
)

const serverID = "22222222-2222-2222-2222-222222222222"
const jobID = "11111111-1111-1111-1111-111111111111"
const appID int64 = 2394010
const appMetadata = `SteamCMD startup chatter
"2394010" { "depots" { "123" { "buildid" "777" } "branches" {
"public" { "buildid" "200" "timeupdated" "1" }
"preview" { "buildid" "300" }
"private" { "buildid" "400" "pwdrequired" "1" }
} } }
Steam>quit`

func manifest(build string) string {
	return fmt.Sprintf(`"AppState" { "appid" "2394010" "buildid" "%s" "StateFlags" "4" }`, build)
}

type fakeDocker struct {
	mu                                    sync.Mutex
	dir                                   string
	running, active                       bool
	missing, unavailable, installerActive bool
	calls                                 [][]string
	metadata                              string
	mutate                                func(context.Context, io.Writer) error
	afterMetadata                         func()
}

func (f *fakeDocker) Run(ctx context.Context, args []string, out io.Writer) error {
	f.mu.Lock()
	f.calls = append(f.calls, append([]string{}, args...))
	f.mu.Unlock()
	switch args[0] {
	case "inspect":
		if f.missing || f.unavailable {
			return errors.New("missing or unavailable")
		}
		f.mu.Lock()
		dir, isRunning := f.dir, f.running
		f.mu.Unlock()
		return json.NewEncoder(out).Encode([]any{map[string]any{"Name": "/" + args[len(args)-1], "ID": "game-id", "State": map[string]any{"Running": isRunning, "Status": "exited"}, "Mounts": []any{map[string]any{"Type": "bind", "Source": dir, "Destination": "/home/container", "RW": true}}}})
	case "ps":
		if f.unavailable {
			return errors.New("daemon unavailable")
		}
		if !strings.Contains(strings.Join(args, " "), helperLabel) {
			if f.installerActive && strings.Contains(strings.Join(args, " "), "_installer") {
				_, _ = io.WriteString(out, "installer-id")
			}
			return nil
		}
		f.mu.Lock()
		active := f.active
		f.mu.Unlock()
		if active {
			_, _ = io.WriteString(out, "abc123\n")
		}
		return nil
	case "rm":
		f.mu.Lock()
		f.active = false
		f.mu.Unlock()
		return nil
	case "run":
		if contains(args, "+app_update") {
			f.mu.Lock()
			f.active = true
			fn := f.mutate
			f.mu.Unlock()
			if fn != nil {
				return fn(ctx, out)
			}
			_ = os.WriteFile(filepath.Join(f.dir, "Pal/Saved/Config/LinuxServer/PalWorldSettings.ini"), []byte("vendor default"), 0600)
			return os.WriteFile(filepath.Join(f.dir, "steamapps", "appmanifest_2394010.acf"), []byte(manifest("200")), 0600)
		}
		if _, err := io.WriteString(out, f.metadata); err != nil {
			return err
		}
		if f.afterMetadata != nil {
			f.afterMetadata()
		}
		return nil
	}
	return errors.New("unexpected fake Docker command")
}
func contains(args []string, key string) bool {
	for _, a := range args {
		if a == key {
			return true
		}
	}
	return false
}
func (f *fakeDocker) snapshot() [][]string {
	f.mu.Lock()
	defer f.mu.Unlock()
	result := make([][]string, len(f.calls))
	copy(result, f.calls)
	return result
}
func (f *fakeDocker) setRunning(v bool) { f.mu.Lock(); f.running = v; f.mu.Unlock() }
func fixture(t *testing.T) (*Executor, *fakeDocker) {
	t.Helper()
	base := t.TempDir()
	dir := filepath.Join(base, serverID)
	if err := os.MkdirAll(filepath.Join(dir, "steamapps"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(dir, "Pal/Saved/Config/LinuxServer"), 0700); err != nil {
		t.Fatal(err)
	}
	for path, body := range map[string]string{"steamapps/appmanifest_2394010.acf": manifest("100"), "Pal/Saved/Config/LinuxServer/PalWorldSettings.ini": "password=PRIVATE_CONFIG", "world.sav": "SAVE_DATA"} {
		if err := os.WriteFile(filepath.Join(dir, filepath.FromSlash(path)), []byte(body), 0600); err != nil {
			t.Fatal(err)
		}
	}
	f := &fakeDocker{dir: dir, metadata: appMetadata}
	e := New()
	e.docker = f
	e.wingsConfig = filepath.Join(base, "wings.yml")
	e.journal = filepath.Join(base, "jobs")
	e.supported = true
	e.owner = func(os.FileInfo) (uint32, uint32, bool) { return 1000, 1000, true }
	e.cacheOwner = func(string, uint32, uint32, bool) error { return nil }
	e.pollInterval = 5 * time.Millisecond
	e.timeLimit = 2 * time.Second
	return e, f
}
func req(op string) steamapi.Request {
	return steamapi.Request{JobID: jobID, Operation: op, ServerUUID: serverID, AppID: appID, Branch: "public"}
}
func execute(e *Executor, r steamapi.Request) []steamapi.Event {
	var events []steamapi.Event
	e.Run(context.Background(), r, func(ev steamapi.Event) error { events = append(events, ev); return nil })
	return events
}
func terminal(t *testing.T, events []steamapi.Event) steamapi.Event {
	t.Helper()
	count := 0
	var result steamapi.Event
	for _, ev := range events {
		if ev.Type == "error" || ev.Type == "result" {
			count++
			result = ev
		}
	}
	if count != 1 {
		t.Fatalf("terminal count %d: %+v", count, events)
	}
	return result
}

func TestCheckRunningReadOnlyAndExactBranch(t *testing.T) {
	e, f := fixture(t)
	f.running = true
	before := map[string]string{}
	_ = filepath.WalkDir(f.dir, func(path string, d os.DirEntry, err error) error {
		if err == nil && !d.IsDir() {
			b, _ := os.ReadFile(path)
			before[path] = string(b)
		}
		return err
	})
	r := req("check")
	r.Branch = "preview"
	result := terminal(t, execute(e, r))
	if result.Type != "result" || result.InstalledBuild != "100" || result.LatestBuild != "300" || !result.UpdateAvailable || result.FilesChanged {
		t.Fatalf("bad check %+v", result)
	}
	for path, want := range before {
		got, _ := os.ReadFile(path)
		if string(got) != want {
			t.Fatalf("check changed %s", path)
		}
	}
	for _, args := range f.snapshot() {
		if args[0] == "run" && (contains(args, "type=bind,src="+f.dir+",dst=/data") || contains(args, "+app_update") || contains(args, "+force_install_dir")) {
			t.Fatalf("check can mutate %v", args)
		}
	}
}
func TestPhaseIdempotencyAndConfigPreservation(t *testing.T) {
	e, f := fixture(t)
	if result := terminal(t, execute(e, req("check"))); result.Type != "result" {
		t.Fatal(result)
	}
	result := terminal(t, execute(e, req("update")))
	if result.Type != "result" || !result.FilesChanged || result.InstalledBuild != "200" || result.UpdateAvailable {
		t.Fatalf("update: %+v", result)
	}
	for path, want := range map[string]string{"Pal/Saved/Config/LinuxServer/PalWorldSettings.ini": "password=PRIVATE_CONFIG", "world.sav": "SAVE_DATA"} {
		got, _ := os.ReadFile(filepath.Join(f.dir, path))
		if string(got) != want {
			t.Fatalf("lost %s: %s", path, got)
		}
	}
	before := len(f.snapshot())
	again := terminal(t, execute(e, req("update")))
	if !reflect.DeepEqual(result, again) || len(f.snapshot()) != before {
		t.Fatal("completed mutation was not replayed exactly")
	}
	check := terminal(t, execute(e, req("check")))
	if check.InstalledBuild != "100" || len(f.snapshot()) != before {
		t.Fatal("completed check phase lost or rerun")
	}
	r := req("update")
	r.Branch = "preview"
	conflict := terminal(t, execute(e, r))
	if conflict.Type != "error" || len(f.snapshot()) != before {
		t.Fatal("changed phase inputs accepted")
	}
	for _, args := range f.snapshot() {
		if contains(args, "+app_update") {
			if contains(args, "validate") || !contains(args, "1000:1000") || !contains(args, "--log-driver") || !contains(args, helperImage) {
				t.Fatalf("unsafe mutation %v", args)
			}
		}
	}
}
func TestMutationsRequireStoppedAndRecheckAfterMetadata(t *testing.T) {
	for _, op := range []string{"install", "update", "verify"} {
		t.Run(op, func(t *testing.T) {
			e, f := fixture(t)
			f.running = true
			result := terminal(t, execute(e, req(op)))
			if result.Type != "error" || result.FilesChanged {
				t.Fatal(result)
			}
			for _, a := range f.snapshot() {
				if a[0] == "run" {
					t.Fatal("launched helper while running")
				}
			}
		})
	}
	e, f := fixture(t)
	f.afterMetadata = func() { f.setRunning(true) }
	result := terminal(t, execute(e, req("update")))
	if result.Type != "error" || result.FilesChanged {
		t.Fatal(result)
	}
	for _, a := range f.snapshot() {
		if contains(a, "+app_update") {
			t.Fatal("mutated game started during metadata lookup")
		}
	}
}
func TestVerifyAndFailureRestoreConfigsAndSafeOutput(t *testing.T) {
	for _, fails := range []bool{false, true} {
		t.Run(fmt.Sprint(fails), func(t *testing.T) {
			e, f := fixture(t)
			f.mutate = func(context.Context, io.Writer) error {
				_ = os.WriteFile(filepath.Join(f.dir, "Pal/Saved/Config/LinuxServer/PalWorldSettings.ini"), []byte("changed"), 0600)
				if fails {
					return errors.New("PRIVATE_CONFIG /host/path")
				}
				return os.WriteFile(filepath.Join(f.dir, "steamapps", "appmanifest_2394010.acf"), []byte(manifest("200")), 0600)
			}
			result := terminal(t, execute(e, req("verify")))
			if (result.Type == "error") != fails || !result.FilesChanged {
				t.Fatal(result)
			}
			if strings.Contains(result.Error, "PRIVATE") || strings.Contains(result.Error, "/host") {
				t.Fatal("raw tool error leaked")
			}
			b, _ := os.ReadFile(filepath.Join(f.dir, "Pal/Saved/Config/LinuxServer/PalWorldSettings.ini"))
			if string(b) != "password=PRIVATE_CONFIG" {
				t.Fatal("config lost on failure")
			}
			found := false
			for _, a := range f.snapshot() {
				if contains(a, "+app_update") {
					found = true
					if !contains(a, "validate") {
						t.Fatal("verify omitted validate")
					}
				}
			}
			if !found {
				t.Fatal("no real mutation command")
			}
		})
	}
}
func TestCancellationJoinsHelperAndRestoresConfiguration(t *testing.T) {
	e, f := fixture(t)
	started := make(chan struct{})
	exited := make(chan struct{})
	f.mutate = func(ctx context.Context, _ io.Writer) error {
		defer close(exited)
		_ = os.WriteFile(filepath.Join(f.dir, "Pal/Saved/Config/LinuxServer/PalWorldSettings.ini"), []byte("changed"), 0600)
		close(started)
		<-ctx.Done()
		return ctx.Err()
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan []steamapi.Event, 1)
	go func() {
		var events []steamapi.Event
		e.Run(ctx, req("update"), func(ev steamapi.Event) error { events = append(events, ev); return nil })
		done <- events
	}()
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("helper did not start")
	}
	cancel()
	select {
	case events := <-done:
		result := terminal(t, events)
		if result.Type != "error" || !result.FilesChanged {
			t.Fatal(result)
		}
	case <-time.After(time.Second):
		t.Fatal("cancel did not join")
	}
	select {
	case <-exited:
	default:
		t.Fatal("helper leaked")
	}
	f.mu.Lock()
	active := f.active
	f.mu.Unlock()
	if active {
		t.Fatal("daemon helper not removed")
	}
	b, _ := os.ReadFile(filepath.Join(f.dir, "Pal/Saved/Config/LinuxServer/PalWorldSettings.ini"))
	if string(b) != "password=PRIVATE_CONFIG" {
		t.Fatal("cancel lost config")
	}
}
func TestExternalStartCancelsAndDefersRestorationUntilStopped(t *testing.T) {
	e, f := fixture(t)
	f.mutate = func(ctx context.Context, _ io.Writer) error {
		_ = os.WriteFile(filepath.Join(f.dir, "Pal/Saved/Config/LinuxServer/PalWorldSettings.ini"), []byte("vendor"), 0600)
		f.setRunning(true)
		<-ctx.Done()
		return ctx.Err()
	}
	result := terminal(t, execute(e, req("update")))
	if result.Type != "error" || !result.FilesChanged {
		t.Fatal(result)
	}
	b, _ := os.ReadFile(filepath.Join(f.dir, "Pal/Saved/Config/LinuxServer/PalWorldSettings.ini"))
	if string(b) != "vendor" {
		t.Fatal("wrote config while running")
	}
	f.setRunning(false)
	r := req("check")
	r.JobID = "33333333-3333-3333-3333-333333333333"
	result = terminal(t, execute(e, r))
	if result.Type != "error" || result.FilesChanged {
		t.Fatal(result)
	}
	b, _ = os.ReadFile(filepath.Join(f.dir, "Pal/Saved/Config/LinuxServer/PalWorldSettings.ini"))
	if string(b) != "vendor" {
		t.Fatal("read-only check restored interrupted config")
	}
	f.mutate = nil
	r.Operation = "verify"
	result = terminal(t, execute(e, r))
	if result.Type != "result" {
		t.Fatal(result)
	}
	b, _ = os.ReadFile(filepath.Join(f.dir, "Pal/Saved/Config/LinuxServer/PalWorldSettings.ini"))
	if string(b) != "password=PRIVATE_CONFIG" {
		t.Fatal("new phase bypassed restoration")
	}
}
func TestInterruptedPhaseNeverReexecutesAndNewPhaseRecovers(t *testing.T) {
	for _, same := range []bool{true, false} {
		t.Run(fmt.Sprint(same), func(t *testing.T) {
			e, f := fixture(t)
			r := req("update")
			_ = os.MkdirAll(e.journal, 0700)
			backup := filepath.Join(e.journal, phaseID(r)+".configs")
			if err := backupConfigs(f.dir, backup, appID); err != nil {
				t.Fatal(err)
			}
			_ = os.WriteFile(filepath.Join(f.dir, "Pal/Saved/Config/LinuxServer/PalWorldSettings.ini"), []byte("interrupted"), 0600)
			if err := writePrivate(filepath.Join(e.journal, phaseID(r)+".json"), record{Request: r, Mutating: true, RecoveryNeeded: true}); err != nil {
				t.Fatal(err)
			}
			if !same {
				r.JobID = "33333333-3333-3333-3333-333333333333"
				r.Operation = "verify"
			}
			result := terminal(t, execute(e, r))
			if same && (result.Type != "error" || !result.FilesChanged) {
				t.Fatal(result)
			}
			if !same && result.Type != "result" {
				t.Fatal(result)
			}
			for _, args := range f.snapshot() {
				if same && contains(args, "+app_update") {
					t.Fatal("interrupted mutation reran")
				}
			}
			b, _ := os.ReadFile(filepath.Join(f.dir, "Pal/Saved/Config/LinuxServer/PalWorldSettings.ini"))
			if string(b) != "password=PRIVATE_CONFIG" {
				t.Fatal("interrupted config not restored")
			}
		})
	}
}
func TestBoundsUnsupportedAndMountValidation(t *testing.T) {
	e, f := fixture(t)
	e.supported = false
	result := terminal(t, execute(e, req("check")))
	if result.Type != "error" || len(f.snapshot()) != 0 {
		t.Fatal("unsupported platform ran Docker")
	}
	e, f = fixture(t)
	f.dir = filepath.Dir(f.dir)
	result = terminal(t, execute(e, req("check")))
	if result.Type != "error" {
		t.Fatal("unsafe mount accepted")
	}
	e, f = fixture(t)
	f.metadata = strings.Repeat("x", (4<<20)+1)
	result = terminal(t, execute(e, req("check")))
	if result.Type != "error" || !strings.Contains(result.Error, "limit") {
		t.Fatal(result)
	}
	b := &cappedOutput{max: 16}
	n, err := b.Write(make([]byte, 1<<20))
	raw, cut := b.text()
	if n != 1<<20 || err != nil || len(raw) != 16 || !cut {
		t.Fatal("output is not bounded and drained")
	}
}
func TestConcurrentSameServerRejected(t *testing.T) {
	e, f := fixture(t)
	started := make(chan struct{})
	release := make(chan struct{})
	f.mutate = func(context.Context, io.Writer) error {
		close(started)
		<-release
		return errors.New("deliberate failure")
	}
	done := make(chan []steamapi.Event, 1)
	go func() { done <- execute(e, req("update")) }()
	<-started
	r := req("check")
	r.JobID = "33333333-3333-3333-3333-333333333333"
	result := terminal(t, execute(e, r))
	if result.Type != "error" || !strings.Contains(result.Error, "active") {
		t.Fatal(result)
	}
	close(release)
	terminal(t, <-done)
}
func TestMetadataMalformedPrivateAndManifestIncomplete(t *testing.T) {
	for _, branch := range []string{"public", "preview"} {
		id, err := latestBuild(appMetadata, appID, branch)
		if err != nil || id == "777" {
			t.Fatalf("selected depot instead of branch: %q %v", id, err)
		}
	}
	for _, branch := range []string{"private", "absent"} {
		if _, err := latestBuild(appMetadata, appID, branch); err == nil {
			t.Fatal("missing/private branch accepted")
		}
	}
	for _, raw := range []string{`"2394010" {`, `"2394010" { "depots" { "branches" { "public" { "buildid" "2" "buildid" "3" } } } }`, `"other" {}`} {
		if _, err := latestBuild(raw, appID, "public"); err == nil {
			t.Fatal("malformed metadata accepted")
		}
	}
	if _, err := installedBuild(strings.Replace(manifest("100"), `"StateFlags" "4"`, `"StateFlags" "6"`, 1), appID); err == nil {
		t.Fatal("incomplete install accepted")
	}
}
