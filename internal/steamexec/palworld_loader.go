package steamexec

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"
	"voltra/internal/palworldloader"
	"voltra/internal/steamapi"
)

func windowsPalworld(request steamapi.Request) bool {
	return request.Platform == "windows" && request.AppID == 2394010
}

func palworldLoaderFailure(stage, output string) error {
	detail := "The reviewed Palworld loader " + stage + " failed; preserve its files and inspect loader conflicts before starting."
	switch {
	case strings.Contains(output, "Legacy/competing") || strings.Contains(output, "Legacy root Mods"):
		detail = "Legacy Palworld loader files require explicit reviewed migration; existing files were preserved."
	case strings.Contains(output, "DLL mod"):
		detail = "Existing Palworld C++ DLL mods require matching modern UE4SS ABI review before installation."
	case strings.Contains(output, "archive"):
		detail = "The fixed public Palworld loader archive could not be acquired or verified; no vanilla fallback is permitted."
	case strings.Contains(output, "checksum") || strings.Contains(output, "core changed") || strings.Contains(output, "receipt"):
		detail = "Palworld loader integrity or ownership verification failed; preserve existing files for operator review."
	}
	return errors.New(detail)
}

// This is a separate bounded helper, reusing the same durable job identity so
// crash recovery/cancellation can remove only its exact labelled container.
func (e *Executor) palworldLoader(ctx context.Context, request steamapi.Request, dir, stage string) (paths palworldProtectedPaths, result error) {
	if !windowsPalworld(request) {
		return paths, nil
	}
	if stage != "preflight" && stage != "install" {
		return paths, errors.New("unsupported Palworld loader operation")
	}
	state, err := e.inspect(ctx, request.ServerUUID)
	if err != nil || running(state) {
		return paths, errors.New("stop the game before Palworld loader maintenance")
	}
	info, err := os.Stat(dir)
	if err != nil {
		return paths, errors.New("Palworld game directory unavailable")
	}
	uid, gid, ok := e.owner(info)
	if !ok || uid == 0 {
		return paths, errors.New("Palworld helper requires the non-root game owner")
	}
	bundle, err := e.palworldPublicBundle(dir)
	if err != nil {
		return paths, errors.New("reviewed Palworld public bundle staging failed")
	}
	mount := "type=bind,src=" + dir + ",dst=/data"
	network := "bridge"
	if stage == "preflight" {
		mount += ",readonly"
		network = "none"
	}
	id := phaseID(request)
	args := []string{"run", "--name", helperName(id), "--label", helperLabel + "=" + id, "--rm", "--pull", "missing", "--platform", "linux/amd64", "--init", "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--pids-limit", "128", "--memory", "256m", "--cpus", "1", "--log-driver", "none", "--network", network, "--tmpfs", "/tmp:rw,nosuid,size=64m", "--env", "HOME=/tmp", "--env", "PYTHONDONTWRITEBYTECODE=1", "--user", ownerPair(uid, gid), "--workdir", "/data", "--mount", mount, "--mount", "type=bind,src=" + bundle + ",dst=/bundle,readonly", "--entrypoint", "python3", palworldloader.PythonImage, "-B", "/bundle/runtime.py", stage}
	runCtx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()
	watcherDone, watcherExit := make(chan struct{}), make(chan struct{})
	go func() {
		defer close(watcherExit)
		timer := time.NewTicker(e.pollInterval)
		defer timer.Stop()
		for {
			select {
			case <-watcherDone:
				return
			case <-runCtx.Done():
				_ = e.cleanup(id)
				return
			case <-timer.C:
				current, inspectErr := e.inspect(runCtx, request.ServerUUID)
				if inspectErr != nil || running(current) {
					cancel()
					_ = e.cleanup(id)
					return
				}
			}
		}
	}()
	output := &cappedOutput{max: 64 << 10}
	err = e.docker.Run(runCtx, args, output)
	close(watcherDone)
	<-watcherExit
	if cleanupErr := e.cleanup(id); cleanupErr != nil {
		return paths, cleanupErr
	}
	current, inspectErr := e.inspect(ctx, request.ServerUUID)
	if inspectErr != nil || running(current) {
		return paths, errors.New("game stopped state changed during Palworld loader maintenance")
	}
	if err != nil || runCtx.Err() != nil {
		raw, _ := output.text()
		return paths, palworldLoaderFailure(stage, raw)
	}
	if stage == "preflight" {
		raw, truncated := output.text()
		if truncated || json.Unmarshal([]byte(raw), &paths) != nil {
			return paths, errors.New("Palworld loader returned an invalid protected path inventory")
		}
	}
	return paths, nil
}

// dir has already passed the Wings UUID/mount/configuration checks. Unlike the
// private journal, this parent is the same absolute path in the node and Docker
// host namespaces. Public tools never enter a game upload directory.
func (e *Executor) palworldPublicBundle(dir string) (string, error) {
	parent := filepath.Dir(dir)
	validate := func(path string) error {
		info, err := os.Lstat(path)
		// Production maintenance supports Linux only; Windows test directories
		// expose synthetic 0777 directory modes rather than POSIX permissions.
		if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 || runtime.GOOS == "linux" && info.Mode().Perm()&0022 != 0 {
			return errors.New("secure node-owned public tool directory required")
		}
		uid, _, known := e.owner(info)
		if !known || uid != 0 {
			return errors.New("root-owned node public tool directory required")
		}
		return nil
	}
	if err := validate(parent); err != nil {
		return "", err
	}
	root := filepath.Join(parent, ".voltra-public-tools")
	if err := os.Mkdir(root, 0755); err != nil && !os.IsExist(err) {
		return "", err
	}
	if err := validate(root); err != nil {
		return "", err
	}
	bundle, err := palworldloader.Stage(root)
	if err != nil {
		return "", err
	}
	if err = validate(bundle); err != nil {
		return "", err
	}
	entries, err := os.ReadDir(bundle)
	if err != nil {
		return "", err
	}
	for _, entry := range entries {
		info, statErr := os.Lstat(filepath.Join(bundle, entry.Name()))
		if statErr != nil || !info.Mode().IsRegular() || info.Mode().Perm()&0222 != 0 {
			return "", errors.New("immutable public tool file required")
		}
		uid, _, known := e.owner(info)
		if !known || uid != 0 {
			return "", errors.New("node-owned public tool file required")
		}
	}
	return bundle, nil
}

// Kept separate from request fields: no caller can choose a root helper user.
func ownerPair(uid, gid uint32) string {
	return strconv.FormatUint(uint64(uid), 10) + ":" + strconv.FormatUint(uint64(gid), 10)
}
