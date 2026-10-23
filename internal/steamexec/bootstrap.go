package steamexec

import (
	"context"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"gopkg.in/yaml.v3"
	"voltra/internal/steamapi"
)

type wingsStorage struct {
	System struct {
		Data string `yaml:"data"`
		User struct {
			UID      int64 `yaml:"uid"`
			GID      int64 `yaml:"gid"`
			Rootless struct {
				Enabled bool `yaml:"enabled"`
			} `yaml:"rootless"`
		} `yaml:"user"`
	} `yaml:"system"`
}

func (e *Executor) configuredDataPath(id string) (string, error) {
	if !filepath.IsAbs(e.wingsConfig) {
		return "", errors.New("Wings configuration must be an absolute local path")
	}
	resolved, err := filepath.EvalSymlinks(e.wingsConfig)
	if err != nil || resolved != e.wingsConfig {
		return "", errors.New("Wings configuration must exist without symlink components")
	}
	info, err := os.Stat(e.wingsConfig)
	if err != nil || !info.Mode().IsRegular() || info.Size() > 1<<20 {
		return "", errors.New("safe Wings configuration unavailable")
	}
	uid, _, ok := e.owner(info)
	if !ok || uid != 0 || info.Mode().Perm()&0022 != 0 {
		return "", errors.New("Wings configuration must be root-owned and not group or world writable")
	}
	data, err := os.ReadFile(e.wingsConfig)
	if err != nil {
		return "", errors.New("Wings configuration unreadable")
	}
	var config wingsStorage
	if yaml.Unmarshal(data, &config) != nil || !filepath.IsAbs(config.System.Data) || filepath.Clean(config.System.Data) != config.System.Data {
		return "", errors.New("absolute Wings system.data required before first Steam installation")
	}
	root := config.System.Data
	resolved, err = filepath.EvalSymlinks(root)
	if err != nil || resolved != root {
		return "", errors.New("Wings data root must exist without symlink components")
	}
	info, err = os.Stat(root)
	if err != nil || !info.IsDir() {
		return "", errors.New("Wings data root unavailable")
	}
	uid, _, ok = e.owner(info)
	if !ok || uid != 0 || info.Mode().Perm()&0022 != 0 {
		return "", errors.New("Wings data root must be root-owned and not group or world writable")
	}
	dir := filepath.Join(root, id)
	info, err = os.Lstat(dir)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return "", errors.New("wait for Wings to create the UUID data volume")
	}
	return dir, nil
}

// Only initial install may prepare the top-level volume. The data root and
// config are independently trusted even when Docker already has a container.
// Existing files are never recursively chowned.
func (e *Executor) prepareGameOwner(ctx context.Context, r steamapi.Request, dir string) error {
	info, err := os.Lstat(dir)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return errors.New("safe game directory unavailable")
	}
	uid, _, ok := e.owner(info)
	if !ok {
		return errors.New("game directory ownership unavailable")
	}
	if uid != 0 {
		return nil
	}
	if r.Operation != "install" {
		return errors.New("root-owned game directory requires initial install or operator ownership repair")
	}
	configured, err := e.configuredDataPath(r.ServerUUID)
	if err != nil {
		return err
	}
	if configured != dir {
		return errors.New("bootstrap directory disagrees with trusted Wings system.data")
	}
	data, err := os.ReadFile(e.wingsConfig)
	if err != nil {
		return errors.New("Wings ownership configuration unreadable")
	}
	var config wingsStorage
	if yaml.Unmarshal(data, &config) != nil {
		return errors.New("Wings ownership configuration invalid")
	}
	user := config.System.User
	if user.Rootless.Enabled || user.UID <= 0 || user.GID <= 0 || user.UID > 2147483647 || user.GID > 2147483647 {
		return errors.New("initial Steam install needs trusted Wings system.user.uid and gid; finish Wings setup or configure its actual non-root user")
	}
	root, err := os.OpenRoot(dir)
	if err != nil {
		return errors.New("bootstrap directory unavailable")
	}
	defer root.Close()
	files, err := fs.ReadDir(root.FS(), "steamapps")
	if err == nil {
		for _, f := range files {
			if strings.HasPrefix(f.Name(), "appmanifest_") && strings.HasSuffix(f.Name(), ".acf") {
				return errors.New("existing Steam installation requires operator ownership repair")
			}
		}
	} else if !os.IsNotExist(err) {
		return errors.New("bootstrap Steam state unreadable")
	}
	state, err := e.inspect(ctx, r.ServerUUID)
	if err != nil {
		return err
	}
	if running(state) {
		return errors.New("stop the game before preparing initial Steam directory ownership")
	}
	if err = chownBootstrap(dir, info, uint32(user.UID), uint32(user.GID)); err != nil {
		return err
	}
	return nil
}
