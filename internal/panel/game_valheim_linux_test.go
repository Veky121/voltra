//go:build linux

package panel

import (
	"context"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"syscall"
	"testing"
	"time"
)

// Exercise the stock image's eval/PID-1 shell behavior with a real subprocess.
// A fixture process replaces the downloaded game; no Docker or game is needed.
func TestValheimLauncherForwardsWingsStop(t *testing.T) {
	dir := t.TempDir()
	if err := os.Mkdir(filepath.Join(dir, ".voltra"), 0700); err != nil {
		t.Fatal(err)
	}
	files := map[string]string{
		".voltra/valheim-start.sh":   valheimLauncher,
		".voltra/valheim.properties": "name=$(touch injected)\npassword=quotes\"$()=safe\nworld=Dedicated\npublic=false\n",
		"valheim_server.x86_64":      "#!/bin/bash\nexec \"$VOLTRA_TEST_BINARY\" -test.run=^TestValheimSignalFixture$ -- \"$@\"\n",
	}
	for name, contents := range files {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(contents), 0700); err != nil {
			t.Fatal(err)
		}
	}
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "bash", "-c", `eval "$STARTUP"`)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), "STARTUP="+valheimStartup, "SERVER_PORT=23560", "VOLTRA_TEST_BINARY="+executable, "VOLTRA_SIGNAL_FIXTURE=1")
	if err = cmd.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() { _ = cmd.Process.Kill() }()
	ready := false
	for i := 0; i < 100; i++ {
		if _, err = os.Stat(filepath.Join(dir, "ready")); err == nil {
			ready = true
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if !ready {
		t.Fatal("fixture never reached ready")
	}
	if err = cmd.Process.Signal(syscall.SIGTERM); err != nil {
		t.Fatal(err)
	}
	_ = cmd.Wait()
	if _, err = os.Stat(filepath.Join(dir, "saved")); err != nil {
		t.Fatal("Wings TERM did not reach the game as INT")
	}
	if _, err = os.Stat(filepath.Join(dir, "injected")); !os.IsNotExist(err) {
		t.Fatal("settings were evaluated as shell")
	}
}

func TestValheimSignalFixture(t *testing.T) {
	if os.Getenv("VOLTRA_SIGNAL_FIXTURE") != "1" {
		t.Skip("subprocess fixture")
	}
	// Verify the launcher preserves argument boundaries and literal shell text.
	found := false
	for i, arg := range os.Args {
		if arg == "-name" && i+1 < len(os.Args) && os.Args[i+1] == "$(touch injected)" {
			found = true
		}
	}
	if !found {
		os.Exit(2)
	}
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, os.Interrupt)
	if err := os.WriteFile("ready", []byte("ready"), 0600); err != nil {
		os.Exit(3)
	}
	select {
	case <-signals:
		if err := os.WriteFile("saved", []byte("saved"), 0600); err != nil {
			os.Exit(4)
		}
	case <-time.After(8 * time.Second):
		os.Exit(5)
	}
}
