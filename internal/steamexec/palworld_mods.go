package steamexec

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

type palworldProtectedPaths struct {
	Mods   []string `json:"mod_roots"`
	Orders []string `json:"order_files"`
}
type palworldSavedMod struct {
	Path, Blob, SHA256 string
	Size               int64
	Mode               fs.FileMode
	UID, GID           uint32
	Owner              bool
	Modified           int64
}
type palworldModManifest struct {
	Version int
	Files   []palworldSavedMod
	Dirs    []palworldSavedMod
}

func palworldSafeModPath(root *os.Root, name string) error {
	if !filepath.IsLocal(name) || path.Clean(name) != name || strings.ContainsAny(name, "\\:") || name == "." || name == "Pal/Content/Paks" || strings.HasPrefix("Pal/Content/Paks", name+"/") {
		return errors.New("custom Palworld mod paths must be confined and cannot select publisher base PAKs")
	}
	current := ""
	for _, part := range strings.Split(name, "/") {
		if current != "" {
			current += "/"
		}
		current += part
		info, err := root.Lstat(current)
		if os.IsNotExist(err) {
			return nil
		}
		if err != nil || info.Mode()&os.ModeSymlink != 0 {
			return errors.New("custom Palworld mod path contains a link or unreadable parent")
		}
	}
	return nil
}

func backupPalworldMods(dir, dest string, paths palworldProtectedPaths, available func(string) (uint64, error)) error {
	root, err := os.OpenRoot(dir)
	if err != nil {
		return err
	}
	defer root.Close()
	names := append(append([]string{}, paths.Mods...), paths.Orders...)
	names = append(names, "Pal/Binaries/Win64/ue4ss/UE4SS-settings.ini", "Pal/Binaries/Win64/ue4ss/UE4SS_SDK_Backends", "Pal/Content/Paks/~mods", "Pal/Content/Paks/LogicMods", "Pal/Content/Paks/Mods")
	seen := map[string]bool{}
	seenDirs := map[string]bool{}
	manifest := palworldModManifest{Version: 1}
	var total, largest uint64
	for _, base := range names {
		if err = palworldSafeModPath(root, base); err != nil {
			return err
		}
		if _, err = root.Lstat(base); os.IsNotExist(err) {
			continue
		} else if err != nil {
			return err
		}
		err = fs.WalkDir(root.FS(), base, func(name string, entry fs.DirEntry, walkErr error) error {
			if walkErr != nil {
				return walkErr
			}
			if err := palworldSafeModPath(root, name); err != nil {
				return err
			}
			if entry.IsDir() {
				if !seenDirs[name] {
					info, err := entry.Info()
					if err != nil {
						return err
					}
					uid, gid, owner := fileOwner(info)
					manifest.Dirs = append(manifest.Dirs, palworldSavedMod{Path: name, Mode: info.Mode().Perm(), UID: uid, GID: gid, Owner: owner, Modified: info.ModTime().UnixNano()})
					seenDirs[name] = true
				}
				if len(manifest.Dirs) > 100000 {
					return errors.New("custom Palworld mod directory count exceeds safe inventory bound")
				}
				return nil
			}
			if seen[name] {
				return nil
			}
			seen[name] = true
			info, err := entry.Info()
			if err != nil || !info.Mode().IsRegular() {
				return errors.New("custom Palworld mods contain a special file")
			}
			if len(manifest.Files) >= 100000 {
				return errors.New("custom Palworld mod file count exceeds the safe inventory bound")
			}
			size := uint64(info.Size())
			if info.Size() < 0 || total+size < total {
				return errors.New("custom mod size overflow")
			}
			total += size
			if size > largest {
				largest = size
			}
			uid, gid, owner := fileOwner(info)
			manifest.Files = append(manifest.Files, palworldSavedMod{Path: name, Size: info.Size(), Mode: info.Mode().Perm(), UID: uid, GID: gid, Owner: owner, Modified: info.ModTime().UnixNano()})
			return nil
		})
		if err != nil {
			return err
		}
	}
	// Inventory and real disk admission finish before creating backup files or
	// permitting Steam mutation. Large custom PAKs have no 8MiB config ceiling.
	const margin = 16 << 20
	free, err := available(filepath.Dir(dest))
	if err != nil || total+margin < total || free < total+margin {
		return errors.New("insufficient real disk space to preserve custom Palworld mods before Steam mutation")
	}
	free, err = available(dir)
	if err != nil || largest+margin < largest || free < largest+margin {
		return errors.New("insufficient real disk space for atomic Palworld mod restoration")
	}
	if err = os.Mkdir(dest, 0o700); err != nil {
		return errors.New("private Palworld mod backup already exists or cannot be created")
	}
	complete := false
	defer func() {
		if !complete {
			_ = os.RemoveAll(dest)
		}
	}()
	sort.Slice(manifest.Files, func(i, j int) bool { return manifest.Files[i].Path < manifest.Files[j].Path })
	for index := range manifest.Files {
		saved := &manifest.Files[index]
		if err = palworldSafeModPath(root, saved.Path); err != nil {
			return err
		}
		source, err := root.Open(saved.Path)
		if err != nil {
			return err
		}
		info, err := source.Stat()
		if err != nil || info.Size() != saved.Size || !info.Mode().IsRegular() {
			source.Close()
			return errors.New("custom Palworld mod changed during snapshot")
		}
		saved.Blob = fmt.Sprintf("blob-%06d", index)
		target, err := os.OpenFile(filepath.Join(dest, saved.Blob), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
		if err != nil {
			source.Close()
			return err
		}
		hash := sha256.New()
		copied, copyErr := io.Copy(io.MultiWriter(target, hash), source)
		after, statErr := source.Stat()
		source.Close()
		syncErr := target.Sync()
		closeErr := target.Close()
		if errors.Join(copyErr, statErr, syncErr, closeErr) != nil || copied != saved.Size || after.Size() != saved.Size || after.ModTime().UnixNano() != saved.Modified {
			return errors.New("custom Palworld mod could not be snapshotted consistently")
		}
		saved.SHA256 = hex.EncodeToString(hash.Sum(nil))
	}
	if err = writePrivate(filepath.Join(dest, "manifest.json"), manifest); err != nil {
		return err
	}
	if err = syncDirectory(dest); err != nil {
		return err
	}
	complete = true
	return nil
}

func restorePalworldMods(dir, src string) error {
	backup, err := os.OpenRoot(src)
	if err != nil {
		return errors.New("private Palworld mod backup unavailable")
	}
	defer backup.Close()
	file, err := backup.Open("manifest.json")
	if err != nil {
		return err
	}
	var manifest palworldModManifest
	err = json.NewDecoder(io.LimitReader(file, 128<<20)).Decode(&manifest)
	file.Close()
	if err != nil || manifest.Version != 1 || len(manifest.Files) > 100000 || len(manifest.Dirs) > 100000 {
		return errors.New("private Palworld mod manifest invalid")
	}
	root, err := os.OpenRoot(dir)
	if err != nil {
		return err
	}
	defer root.Close()
	// Verify all private backup streams and current target paths before writes.
	for index, saved := range manifest.Files {
		if saved.Blob != fmt.Sprintf("blob-%06d", index) || len(saved.SHA256) != 64 || saved.Size < 0 {
			return errors.New("private Palworld mod record invalid")
		}
		if err = palworldSafeModPath(root, saved.Path); err != nil {
			return err
		}
		info, err := backup.Lstat(saved.Blob)
		if err != nil || !info.Mode().IsRegular() || info.Size() != saved.Size {
			return errors.New("private Palworld mod backup changed type or size")
		}
		source, err := backup.Open(saved.Blob)
		if err != nil {
			return err
		}
		hash := sha256.New()
		_, err = io.Copy(hash, source)
		source.Close()
		if err != nil || hex.EncodeToString(hash.Sum(nil)) != saved.SHA256 {
			return errors.New("private Palworld mod backup checksum mismatch")
		}
	}
	for _, directory := range manifest.Dirs {
		if err = palworldSafeModPath(root, directory.Path); err != nil {
			return err
		}
	}
	sort.Slice(manifest.Dirs, func(i, j int) bool { return len(manifest.Dirs[i].Path) < len(manifest.Dirs[j].Path) })
	for _, directory := range manifest.Dirs {
		if err = palworldEnsureModDirectory(root, directory.Path); err != nil {
			return err
		}
	}
	for _, saved := range manifest.Files {
		// An existing publisher-deleted custom directory is reconstructed only
		// inside the same confined volume, never through symbolic ancestors.
		if err = palworldEnsureModDirectory(root, path.Dir(saved.Path)); err != nil {
			return err
		}
		if err = palworldSafeModPath(root, saved.Path); err != nil {
			return err
		}
		if existing, readErr := root.Open(saved.Path); readErr == nil {
			info, statErr := existing.Stat()
			hash := sha256.New()
			_, copyErr := io.Copy(hash, existing)
			existing.Close()
			var uid, gid uint32
			owner := false
			if statErr == nil {
				uid, gid, owner = fileOwner(info)
			}
			if statErr == nil && copyErr == nil && info.Mode().IsRegular() && info.Mode().Perm() == saved.Mode && info.ModTime().UnixNano() == saved.Modified && (!saved.Owner || owner && uid == saved.UID && gid == saved.GID) && hex.EncodeToString(hash.Sum(nil)) == saved.SHA256 {
				continue
			}
		}
		token := make([]byte, 8)
		if _, err = rand.Read(token); err != nil {
			return err
		}
		temporary := path.Join(path.Dir(saved.Path), ".voltra-restore-"+hex.EncodeToString(token))
		target, err := root.OpenFile(temporary, os.O_WRONLY|os.O_CREATE|os.O_EXCL, saved.Mode)
		if err != nil {
			return err
		}
		source, err := backup.Open(saved.Blob)
		if err != nil {
			target.Close()
			return err
		}
		_, copyErr := io.Copy(target, source)
		source.Close()
		syncErr := target.Sync()
		closeErr := target.Close()
		if errors.Join(copyErr, syncErr, closeErr) != nil {
			root.Remove(temporary)
			return errors.New("custom Palworld mod restore failed; private backup retained")
		}
		if err = root.Chmod(temporary, saved.Mode); err == nil && saved.Owner {
			err = root.Chown(temporary, int(saved.UID), int(saved.GID))
		}
		if err == nil {
			err = root.Chtimes(temporary, time.Unix(0, saved.Modified), time.Unix(0, saved.Modified))
		}
		if err == nil {
			err = root.Rename(temporary, saved.Path)
		}
		if err != nil {
			root.Remove(temporary)
			return errors.New("custom Palworld mod publication failed; private backup retained")
		}
	}
	for index := len(manifest.Dirs) - 1; index >= 0; index-- {
		directory := manifest.Dirs[index]
		if err = root.Chmod(directory.Path, directory.Mode); err == nil && directory.Owner {
			err = root.Chown(directory.Path, int(directory.UID), int(directory.GID))
		}
		if err == nil {
			err = root.Chtimes(directory.Path, time.Unix(0, directory.Modified), time.Unix(0, directory.Modified))
		}
		if err != nil {
			return errors.New("custom Palworld mod directory metadata restoration failed")
		}
	}
	return nil
}

func palworldEnsureModDirectory(root *os.Root, name string) error {
	if name == "." {
		return nil
	}
	if err := palworldSafeModPath(root, name); err != nil {
		return err
	}
	base, err := root.Stat(".")
	if err != nil {
		return err
	}
	uid, gid, owner := fileOwner(base)
	current := ""
	for _, part := range strings.Split(name, "/") {
		if current != "" {
			current += "/"
		}
		current += part
		info, err := root.Lstat(current)
		if os.IsNotExist(err) {
			if err = root.Mkdir(current, 0o755); err != nil {
				return err
			}
			if owner {
				if err = root.Chown(current, int(uid), int(gid)); err != nil {
					return err
				}
			}
		} else if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return errors.New("custom mod directory changed type during recovery")
		}
	}
	return nil
}

func removePalworldModBackup(path string) {
	if strings.HasSuffix(filepath.Base(path), ".palworld-mods") {
		_ = os.RemoveAll(path)
	}
}
