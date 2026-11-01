package main

import (
	"crypto/sha256"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// copyExecutable never follows a source symlink or overwrites a destination.
func copyExecutable(source, target string) (err error) {
	info, err := os.Lstat(source)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return fmt.Errorf("not a regular executable: %s", source)
	}
	in, err := os.Open(source)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(target, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0700)
	if err != nil {
		return err
	}
	defer func() {
		if err != nil {
			_ = os.Remove(target)
		}
	}()
	_, err = io.Copy(out, in)
	if err == nil {
		err = out.Sync()
	}
	closeErr := out.Close()
	if err == nil {
		err = closeErr
	}
	return err
}

func executableDigest(path string) ([32]byte, error) {
	var result [32]byte
	f, err := os.Open(path)
	if err != nil {
		return result, err
	}
	defer f.Close()
	h := sha256.New()
	if _, err = io.Copy(h, f); err != nil {
		return result, err
	}
	copy(result[:], h.Sum(nil))
	return result, nil
}

// Keep the last accepted backup until a different executable starts. A failed
// Restart therefore does not discard the previous working version.
func stagePreviousExecutable(exe string) error {
	dir := filepath.Join(filepath.Dir(exe), "previous")
	if err := os.MkdirAll(dir, 0700); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, "pending-*.tmp")
	if err != nil {
		return err
	}
	name := tmp.Name()
	if err = tmp.Close(); err != nil {
		return err
	}
	defer os.Remove(name)
	if err = os.Remove(name); err != nil {
		return err
	}
	if err = copyExecutable(exe, name); err != nil {
		return err
	}
	return os.Rename(name, filepath.Join(dir, "pending.exe"))
}

func acceptPreviousExecutable(exe string) error {
	pending := filepath.Join(filepath.Dir(exe), "previous", "pending.exe")
	info, err := os.Lstat(pending)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return fmt.Errorf("invalid previous-version candidate")
	}
	oldHash, err := executableDigest(pending)
	if err != nil {
		return err
	}
	currentHash, err := executableDigest(exe)
	if err != nil {
		return err
	}
	if oldHash == currentHash {
		return nil
	}
	return os.Rename(pending, filepath.Join(filepath.Dir(pending), "Voltra.exe"))
}

// Only updater-generated numeric asides beside this executable qualify.
// Locked files are retried next launch; unrelated files and links stay intact.
func cleanUpdateAsides(exe string) {
	entries, err := os.ReadDir(filepath.Dir(exe))
	if err != nil {
		return
	}
	prefix := filepath.Base(exe) + ".old."
	for _, entry := range entries {
		if !strings.HasPrefix(entry.Name(), prefix) {
			continue
		}
		suffix := strings.TrimPrefix(entry.Name(), prefix)
		if _, err := strconv.ParseUint(suffix, 10, 64); err != nil || suffix == "" {
			continue
		}
		info, err := entry.Info()
		if err == nil && info.Mode().IsRegular() {
			_ = os.Remove(filepath.Join(filepath.Dir(exe), entry.Name()))
		}
	}
}
