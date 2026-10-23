package steamexec

import (
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"voltra/internal/steamapi"
)

// SteamCMD validate restores shipped defaults too. Snapshot existing configs
// durably before mutation, then restore even after failure or process restart.
// Saves/unmanaged files are never deleted; no app_uninstall or directory reset.
type savedFile struct {
	Path     string
	Data     []byte
	Mode     fs.FileMode
	UID, GID uint32
	Owner    bool
}

func configFile(path string) bool {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".ini", ".cfg", ".conf", ".config", ".json", ".xml", ".yaml", ".yml", ".toml", ".properties", ".txt":
		return true
	}
	return false
}
func protectedTrees(app int64) []string {
	profile, _ := steamapi.Profile(app)
	return profile.ProtectedPaths
}

func backupConfigs(dir, dest string, app int64) error {
	trees := protectedTrees(app)
	if len(trees) == 0 {
		return errors.New("Steam app has no configuration preservation policy; add a reviewed game policy before maintenance")
	}
	root, err := os.OpenRoot(dir)
	if err != nil {
		return errors.New("cannot open game directory")
	}
	defer root.Close()
	var files []savedFile
	var total int64
	count := 0
	err = fs.WalkDir(root.FS(), ".", func(path string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		count++
		if count > 200000 {
			return errors.New("game file count exceeds preservation limit")
		}
		if d.IsDir() {
			keep := path == "."
			for _, tree := range trees {
				if path == tree || strings.HasPrefix(tree, path+"/") || strings.HasPrefix(path, tree+"/") {
					keep = true
				}
			}
			if !keep || d.Name() == "Logs" || d.Name() == "Crashes" {
				return fs.SkipDir
			}
			return nil
		}
		protected := false
		for _, tree := range trees {
			if path == tree || strings.HasPrefix(path, tree+"/") {
				protected = true
			}
		}
		if !protected || !configFile(path) {
			return nil
		}
		if d.Type()&os.ModeSymlink != 0 {
			return errors.New("configuration symlink requires operator review")
		}
		info, err := d.Info()
		if err != nil {
			return err
		}
		if !info.Mode().IsRegular() {
			return errors.New("configuration is not a regular file")
		}
		if len(files) >= 4096 || info.Size() > 8<<20 || total+info.Size() > 64<<20 {
			return errors.New("configuration backup exceeds safety limit")
		}
		f, err := root.Open(path)
		if err != nil {
			return err
		}
		b, readErr := io.ReadAll(io.LimitReader(f, 8<<20+1))
		f.Close()
		if readErr != nil || len(b) > 8<<20 {
			return errors.New("configuration read exceeds safety limit")
		}
		total += int64(len(b))
		uid, gid, owned := fileOwner(info)
		files = append(files, savedFile{Path: path, Data: b, Mode: info.Mode().Perm(), UID: uid, GID: gid, Owner: owned})
		return nil
	})
	if err != nil {
		return errors.New("cannot safely preserve game configuration; inspect permissions, symlinks and backup limits")
	}
	return writePrivate(dest, files)
}
func restoreConfigs(dir, src string) error {
	f, err := os.Open(src)
	if err != nil {
		return errors.New("preserved game configuration unavailable")
	}
	defer f.Close()
	var files []savedFile
	if json.NewDecoder(io.LimitReader(f, 96<<20)).Decode(&files) != nil {
		return errors.New("preserved game configuration invalid")
	}
	root, err := os.OpenRoot(dir)
	if err != nil {
		return errors.New("cannot restore game configuration")
	}
	defer root.Close()
	for _, saved := range files {
		if !filepath.IsLocal(saved.Path) {
			return errors.New("unsafe preserved configuration path")
		}
		// OpenRoot prevents escape through symlinks. Reject the final symlink
		// too so a depot cannot redirect restoration to a different game file.
		if info, err := root.Lstat(saved.Path); err == nil && (!info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0) {
			return errors.New("configuration target changed type; operator recovery required")
		}
		f, err := root.OpenFile(saved.Path, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, saved.Mode)
		if err != nil {
			return errors.New("configuration restore failed; preserved backup retained")
		}
		_, writeErr := f.Write(saved.Data)
		syncErr := f.Sync()
		closeErr := f.Close()
		if writeErr != nil || syncErr != nil || closeErr != nil {
			return errors.New("configuration restore failed; preserved backup retained")
		}
		if err = root.Chmod(saved.Path, saved.Mode); err != nil {
			return errors.New("configuration permissions could not be restored")
		}
		if saved.Owner {
			if err = root.Chown(saved.Path, int(saved.UID), int(saved.GID)); err != nil {
				return errors.New("configuration ownership could not be restored")
			}
		}
	}
	return nil
}

func writePrivate(path string, value any) error {
	f, err := os.CreateTemp(filepath.Dir(path), ".steam-*")
	if err != nil {
		return errors.New("Steam journal unavailable")
	}
	name := f.Name()
	defer os.Remove(name)
	if err = f.Chmod(0600); err == nil {
		err = json.NewEncoder(f).Encode(value)
	}
	if err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err == nil {
		err = closeErr
	}
	if err == nil {
		err = os.Rename(name, path)
	}
	if err == nil {
		err = syncDirectory(filepath.Dir(path))
	}
	if err != nil {
		return errors.New("Steam journal could not be persisted")
	}
	return nil
}
