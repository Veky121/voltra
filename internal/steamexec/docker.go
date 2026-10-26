package steamexec

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"gopkg.in/yaml.v3"
	"voltra/internal/steamapi"
)

const helperImage = "ghcr.io/steamcmd/steamcmd:ubuntu-24@sha256:1aefa09cbcdf75a54c7400f02098340db975536f4972036b166e7265da2b5806"
const helperLabel = "io.voltra.steam-job"
const clientCacheLabel = "io.voltra.steam-client-cache"

// A fixed wrapper supplies the Steam runtime expected by launch-only eggs.
// All arguments still come from the validated typed request, never shell text.
const mutationScript = `set -eu
timeout --signal=TERM --kill-after=30s 7200s /usr/bin/steamcmd "$@"
sdk=/tmp/.local/share/Steam/steamcmd/linux64/steamclient.so
test -s "$sdk"
for p in /data/.steam /data/.steam/sdk64 /data/linux64 /data/.steam/sdk64/steamclient.so /data/linux64/steamclient.so /data/steamclient.so; do
  if [ -L "$p" ]; then exit 71; fi
done
mkdir -p /data/.steam/sdk64 /data/linux64
for dest in /data/.steam/sdk64/steamclient.so /data/linux64/steamclient.so /data/steamclient.so; do
  staged=$(mktemp "$dest.voltra-XXXXXX")
  cp "$sdk" "$staged"
  chmod 755 "$staged"
  mv -f "$staged" "$dest"
done
`

var errCleanup = errors.New("Steam helper cleanup unconfirmed; operator recovery required")

// Docker is an execution seam for focused tests. Production invokes only the
// local Docker socket, never DOCKER_HOST or a caller-provided executable.
type Docker interface {
	Run(context.Context, []string, io.Writer) error
}
type localDocker struct{}

func (localDocker) Run(ctx context.Context, args []string, out io.Writer) error {
	cmd := exec.CommandContext(ctx, "docker", append([]string{"--host", "unix:///var/run/docker.sock"}, args...)...)
	cmd.Stdout, cmd.Stderr = out, out
	cmd.WaitDelay = 3 * time.Second
	if err := cmd.Run(); err != nil {
		return errors.New("local Docker command failed")
	}
	return nil
}

// cappedOutput keeps draining noisy subprocesses without unbounded memory or
// scanner deadlocks. Metadata truncation is an explicit failure.
type cappedOutput struct {
	mu        sync.Mutex
	b         bytes.Buffer
	max       int
	truncated bool
}

func (b *cappedOutput) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	n := len(p)
	remaining := max(0, b.max-b.b.Len())
	if n > remaining {
		b.truncated = true
	}
	_, _ = b.b.Write(p[:min(n, remaining)])
	return n, nil
}
func (b *cappedOutput) text() (string, bool) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.b.String(), b.truncated
}

type container struct {
	ID    string
	Name  string
	State struct {
		Running    bool
		Paused     bool
		Restarting bool
		Status     string
	}
	Mounts []struct {
		Type, Source, Destination string
		RW                        bool
	}
}

func (e *Executor) inspect(ctx context.Context, id string) (container, error) {
	out := &cappedOutput{max: 128 << 10}
	call, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	if err := e.docker.Run(call, []string{"inspect", "--type", "container", id}, out); err != nil {
		// Docker errors alone cannot mean absent. Confirm the daemon responds
		// and no exact UUID container exists before allowing a volume fallback.
		list := &cappedOutput{max: 4096}
		if err = e.docker.Run(call, []string{"ps", "-aq", "--filter", "name=^/" + id + "$"}, list); err != nil {
			return container{}, errors.New("local Docker state unavailable")
		}
		ids, cut := list.text()
		if cut || strings.TrimSpace(ids) != "" {
			return container{}, errors.New("game container state could not be verified")
		}
		installers := &cappedOutput{max: 4096}
		if err = e.docker.Run(call, []string{"ps", "-q", "--filter", "name=^/" + id + "_installer$"}, installers); err != nil {
			return container{}, errors.New("Wings installer state unavailable")
		}
		ids, cut = installers.text()
		if cut || strings.TrimSpace(ids) != "" {
			return container{}, errors.New("wait for Wings bootstrap installation to finish")
		}
		return container{Name: "/" + id}, nil
	}
	raw, truncated := out.text()
	var list []container
	if truncated || json.Unmarshal([]byte(raw), &list) != nil || len(list) != 1 || list[0].Name != "/"+id {
		return container{}, errors.New("game container identity could not be verified")
	}
	if list[0].ID == "" || list[0].State.Status == "" {
		return container{}, errors.New("game container state is incomplete")
	}
	installers := &cappedOutput{max: 4096}
	if err := e.docker.Run(call, []string{"ps", "-q", "--filter", "name=^/" + id + "_installer$"}, installers); err != nil {
		return container{}, errors.New("Wings installer state unavailable")
	}
	ids, cut := installers.text()
	if cut || strings.TrimSpace(ids) != "" {
		return container{}, errors.New("wait for Wings bootstrap installation to finish")
	}
	return list[0], nil
}
func running(c container) bool {
	return c.State.Running || c.State.Paused || c.State.Restarting || c.State.Status == "restarting"
}

func (e *Executor) gamePath(ctx context.Context, r steamapi.Request) (string, container, error) {
	c, err := e.inspect(ctx, r.ServerUUID)
	if err != nil {
		return "", c, err
	}
	var dir string
	for _, m := range c.Mounts {
		if m.Destination == "/home/container" && m.Type == "bind" && m.RW {
			if dir != "" {
				return "", c, errors.New("ambiguous game mount")
			}
			dir = m.Source
		}
	}
	if dir == "" && c.ID == "" && len(c.Mounts) == 0 {
		// Stock Wings uses UUID_installer for installation and can leave only
		// the data volume until first boot. Trust only root-owned local config.
		configured, err := e.configuredDataPath(r.ServerUUID)
		if err != nil {
			return "", c, err
		}
		dir = configured
	}
	// Require the matching container's UUID-named directory. If a configured
	// Wings data root is available it must agree, including recovery setups.
	if !filepath.IsAbs(dir) || filepath.Clean(dir) != dir || filepath.Base(dir) != r.ServerUUID || strings.ContainsAny(dir, ",\r\n") {
		return "", c, errors.New("safe Wings game mount unavailable")
	}
	if raw, err := os.ReadFile(e.wingsConfig); err == nil {
		if len(raw) > 1<<20 {
			return "", c, errors.New("Wings configuration exceeds limit")
		}
		var config struct {
			System struct {
				Data string `yaml:"data"`
			} `yaml:"system"`
		}
		if yaml.Unmarshal(raw, &config) != nil {
			return "", c, errors.New("Wings configuration invalid")
		}
		if config.System.Data != "" && filepath.Join(config.System.Data, r.ServerUUID) != dir {
			return "", c, errors.New("game mount disagrees with Wings configuration")
		}
	} else if !os.IsNotExist(err) {
		return "", c, errors.New("Wings configuration unreadable")
	}
	resolved, err := filepath.EvalSymlinks(dir)
	if err != nil || resolved != dir {
		return "", c, errors.New("game mount must be an existing directory without symlink components")
	}
	info, err := os.Stat(dir)
	if err != nil || !info.IsDir() {
		return "", c, errors.New("game directory unavailable")
	}
	return dir, c, nil
}

func helperName(id string) string { return "voltra-steam-" + id }

func (e *Executor) cleanup(id string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	// A missing helper is success. Only the exact name bearing our job label
	// can be deleted, including recovery after a node process crash.
	out := &cappedOutput{max: 4096}
	if err := e.docker.Run(ctx, []string{"ps", "-aq", "--filter", "name=^/" + helperName(id) + "$", "--filter", "label=" + helperLabel + "=" + id}, out); err != nil {
		return errCleanup
	}
	ids, truncated := out.text()
	if truncated {
		return errCleanup
	}
	if strings.TrimSpace(ids) == "" {
		return nil
	}
	if err := e.docker.Run(ctx, []string{"rm", "-f", helperName(id)}, io.Discard); err != nil {
		return errCleanup
	}
	return nil
}

func (e *Executor) helper(ctx context.Context, r steamapi.Request, dir string, mutation bool, out io.Writer) (err error) {
	if r.BetaPassword != "" {
		return errors.New("private branch credentials are not enabled in this node build")
	}
	name := helperName(phaseID(r))
	args := []string{"run", "--name", name, "--label", helperLabel + "=" + phaseID(r), "--rm", "--pull", "missing", "--platform", "linux/amd64", "--init", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--pids-limit", "256", "--memory", "2g", "--cpus", "2", "--log-driver", "none", "--tmpfs", "/tmp:rw,exec,nosuid,size=1g", "--env", "HOME=/tmp", "--workdir", "/tmp"}
	var cacheUID, cacheGID uint32
	if mutation {
		state, stateErr := e.inspect(ctx, r.ServerUUID)
		if stateErr != nil {
			return stateErr
		}
		if running(state) {
			return errors.New("game started before SteamCMD; stop it and retry")
		}
		info, statErr := os.Stat(dir)
		if statErr != nil {
			return errors.New("game directory unavailable")
		}
		uid, gid, ok := e.owner(info)
		if !ok || uid == 0 {
			return errors.New("game directory must have a non-root Wings owner")
		}
		cacheUID, cacheGID = uid, gid
		args = append(args, "--user", strconv.FormatUint(uint64(uid), 10)+":"+strconv.FormatUint(uint64(gid), 10), "--mount", "type=bind,src="+dir+",dst=/data")
	}
	cache, releaseCache, cacheErr := e.clientCache(ctx, r, cacheUID, cacheGID, mutation)
	if cacheErr != nil {
		return cacheErr
	}
	defer releaseCache()
	// A killed node process can leave a daemon-side helper running after its
	// host lock is released. Never reuse that client's files until it stops.
	cacheUse := &cappedOutput{max: 4096}
	if err = e.docker.Run(ctx, []string{"ps", "-q", "--filter", "label=" + clientCacheLabel + "=" + filepath.Base(cache)}, cacheUse); err != nil {
		return errors.New("SteamCMD cache usage could not be checked")
	}
	if active, truncated := cacheUse.text(); truncated || strings.TrimSpace(active) != "" {
		return errors.New("SteamCMD client cache is still in use by an earlier helper; operator recovery required")
	}
	args = append(args, "--label", clientCacheLabel+"="+filepath.Base(cache))
	args = append(args, "--mount", "type=bind,src="+cache+",dst=/tmp/.local/share/Steam")
	if mutation {
		args = append(args, "--entrypoint", "/bin/sh", helperImage, "-c", mutationScript, "voltra-steam")
	} else {
		args = append(args, "--entrypoint", "/usr/bin/timeout", helperImage, "--signal=TERM", "--kill-after=30s", "300s", "/usr/bin/steamcmd")
	}
	args = append(args, "+@ShutdownOnFailedCommand", "1", "+@NoPromptForPassword", "1")
	if mutation {
		args = append(args, "+force_install_dir", "/data")
	}
	if r.Platform == "windows" {
		args = append(args, "+@sSteamCmdForcePlatformType", "windows")
	}
	args = append(args, "+login", "anonymous")
	if mutation {
		// Metadata was checked in a separate isolated client cache. Refresh alone
		// need not populate this session's target app; fetch it explicitly before
		// app_update to avoid cold anonymous "Missing configuration" failures.
		args = append(args, "+app_info_update", "1", "+app_info_print", strconv.FormatInt(r.AppID, 10))
		args = append(args, "+app_update", strconv.FormatInt(r.AppID, 10), "-beta", r.Branch)
		if r.Operation == "verify" || r.Validate {
			args = append(args, "validate")
		}
	} else {
		args = append(args, "+app_info_update", "1", "+app_info_print", strconv.FormatInt(r.AppID, 10))
	}
	args = append(args, "+quit")
	// Killing the Docker client alone leaves the daemon-side container alive.
	// Cancellation removes it while run is still joined, then retries cleanup
	// after the client has exited to cover container-creation races.
	watchDone := make(chan struct{})
	watchExit := make(chan struct{})
	go func() {
		defer close(watchExit)
		select {
		case <-ctx.Done():
			_ = e.cleanup(phaseID(r))
		case <-watchDone:
		}
	}()
	err = e.docker.Run(ctx, args, out)
	close(watchDone)
	<-watchExit
	if cleanupErr := e.cleanup(phaseID(r)); cleanupErr != nil {
		return cleanupErr
	}
	if ctx.Err() != nil {
		return errors.New("Steam execution cancelled or timed out")
	}
	if err != nil {
		// Anonymous SteamCMD output is kept only on the operator's private node
		// journal, never returned to browser clients. Bound it like the command
		// buffer so a failed download remains diagnosable without unbounded logs.
		captured, ok := out.(*cappedOutput)
		if stream, streaming := out.(*consoleOutput); streaming {
			captured, ok = stream.captured, true
		}
		if ok {
			raw, _ := captured.text()
			if r.BetaPassword != "" {
				raw = strings.ReplaceAll(raw, r.BetaPassword, "[redacted]")
			}
			if len(raw) > 64<<10 {
				raw = raw[len(raw)-(64<<10):]
			}
			_ = os.WriteFile(filepath.Join(e.journal, phaseID(r)+".log"), []byte(raw), 0600)
		}
		return errors.New("SteamCMD failed; check anonymous app access, disk space and outbound Steam connectivity")
	}
	return nil
}

func Supported() bool { return runtime.GOOS == "linux" && runtime.GOARCH == "amd64" }
