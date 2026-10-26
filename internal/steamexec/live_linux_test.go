//go:build linux

package steamexec

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

// Opt-in: temporary metadata helper only, no game mounts or existing services.
func TestLiveAnonymousMetadata(t *testing.T) {
	if os.Getenv("VOLTRA_STEAM_LIVE_METADATA") != "1" {
		t.Skip("set VOLTRA_STEAM_LIVE_METADATA=1 to exercise a temporary real Docker helper")
	}
	if !Supported() {
		t.Skip("native Linux amd64 required")
	}
	e := New()
	r := req("check")
	r.JobID = uuid.NewString()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	out := &cappedOutput{max: 4 << 20}
	if err := e.helper(ctx, r, "", false, out); err != nil {
		t.Fatal(err)
	}
	raw, cut := out.text()
	if cut {
		t.Fatal("live metadata truncated")
	}
	build, err := latestBuild(raw, r.AppID, r.Branch)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("real anonymous SteamCMD metadata: app=%d branch=%s build=%s", r.AppID, r.Branch, build)
}

func TestLivePersistentSteamClientCache(t *testing.T) {
	if os.Getenv("VOLTRA_STEAM_LIVE_METADATA") != "1" {
		t.Skip("opt-in real anonymous metadata helpers only")
	}
	if !Supported() {
		t.Skip("native Linux amd64 required")
	}
	e := New()
	e.journal = t.TempDir()
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
	defer cancel()
	for run := 0; run < 2; run++ {
		r := req("check")
		r.JobID = uuid.NewString()
		out := &cappedOutput{max: 4 << 20}
		if err := e.helper(ctx, r, "", false, out); err != nil {
			raw, _ := out.text()
			t.Fatalf("helper %d: %v\n%s", run, err, raw)
		}
		raw, cut := out.text()
		if cut {
			t.Fatal("metadata truncated")
		}
		build, err := latestBuild(raw, r.AppID, r.Branch)
		if err != nil {
			t.Fatal(err)
		}
		downloads := strings.Count(strings.ToLower(raw), "downloading update")
		t.Logf("run=%d build=%s client-download-lines=%d", run+1, build, downloads)
		if run == 1 && downloads != 0 {
			t.Fatal("second helper redownloaded SteamCMD")
		}
	}
	if _, err := os.Stat(filepath.Join(e.journal, "client-cache", "metadata", "steamcmd", "linux32", "steamcmd")); err != nil {
		t.Fatal("updated client not retained", err)
	}
}

func TestLivePersistentNonrootClientRuntime(t *testing.T) {
	if os.Getenv("VOLTRA_STEAM_LIVE_METADATA") != "1" {
		t.Skip("opt-in disposable SteamCMD runtime only")
	}
	if !Supported() {
		t.Skip("native Linux amd64 required")
	}
	e := New()
	e.journal = t.TempDir()
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
	defer cancel()
	r := req("install")
	for run := 0; run < 2; run++ {
		r.JobID = uuid.NewString()
		cache, unlock, err := e.clientCache(ctx, r, 1000, 1000, true)
		if err != nil {
			t.Fatal(err)
		}
		id := phaseID(r)
		args := []string{"run", "--name", helperName(id), "--label", helperLabel + "=" + id, "--rm", "--platform", "linux/amd64", "--user", "1000:1000", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--tmpfs", "/tmp:rw,exec,nosuid,size=1g", "--tmpfs", "/data:rw,uid=1000,gid=1000,size=512m", "--env", "HOME=/tmp", "--workdir", "/tmp", "--mount", "type=bind,src=" + cache + ",dst=/tmp/.local/share/Steam", "--entrypoint", "/bin/sh", helperImage, "-c", mutationScript + "test -s /data/.steam/sdk64/steamclient.so && test -s /data/linux64/steamclient.so\n", "probe", "+quit"}
		out := &cappedOutput{max: 64 << 10}
		err = e.docker.Run(ctx, args, out)
		cleanupErr := e.cleanup(id)
		unlock()
		raw, _ := out.text()
		if err != nil || cleanupErr != nil {
			t.Fatalf("non-root runtime %d: %v %v\n%s", run, err, cleanupErr, raw)
		}
		downloads := strings.Count(strings.ToLower(raw), "downloading update")
		t.Logf("non-root run=%d client-download-lines=%d; SDK copied only into disposable tmpfs", run+1, downloads)
		if run == 1 && downloads != 0 {
			t.Fatal("second non-root helper redownloaded SteamCMD")
		}
	}
}

func TestLiveNativeSDKLayout(t *testing.T) {
	if os.Getenv("VOLTRA_STEAM_LIVE_METADATA") != "1" {
		t.Skip("opt-in real temporary helper")
	}
	if !Supported() {
		t.Skip("native Linux amd64 required")
	}
	e := New()
	id := uuid.NewString() + "-install"
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	defer e.cleanup(id)
	args := []string{"run", "--name", helperName(id), "--label", helperLabel + "=" + id, "--rm", "--platform", "linux/amd64", "--user", "1000:1000", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--pids-limit", "256", "--memory", "2g", "--cpus", "2", "--log-driver", "none", "--tmpfs", "/tmp:rw,exec,nosuid,size=1g", "--tmpfs", "/data:rw,uid=1000,gid=1000,size=512m", "--env", "HOME=/tmp", "--workdir", "/tmp", "--entrypoint", "/bin/sh", helperImage, "-c", mutationScript + "test -s /data/.steam/sdk64/steamclient.so && test -s /data/linux64/steamclient.so && test -s /data/steamclient.so\n", "probe", "+quit"}
	out := &cappedOutput{max: 64 << 10}
	if err := e.docker.Run(ctx, args, out); err != nil {
		raw, _ := out.text()
		t.Fatalf("native SDK wrapper failed: %v\n%s", err, raw)
	}
	t.Log("real non-root SteamCMD SDK layout verified in ephemeral tmpfs, no game mount")
}
