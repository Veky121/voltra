//go:build linux

package steamexec

import (
	"context"
	"os"
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
