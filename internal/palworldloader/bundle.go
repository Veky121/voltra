// Package palworldloader carries public reviewed assets for one explicit runtime.
package palworldloader

import (
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

//go:embed assets/*
var assets embed.FS

const PythonImage = "python:3.13-slim@sha256:27b7c9d4f13ca20bb1170148f02095d50a5dfce1f7f2dabf5ca273727e43b7ea"
const ProtonImage = "ghcr.io/ptero-eggs/steamcmd:proton@sha256:38380883a880937c6bdfa25a29a50601e8fd010a126157f857539bfd9057ed7b"
const Tools = ".voltra/palworld-loader-tools/"

func sum(data []byte) string { hash := sha256.Sum256(data); return hex.EncodeToString(hash[:]) }

// Files returns independent public bytes, never credentials or operator state.
func Files() (map[string][]byte, error) {
	names, err := assets.ReadDir("assets")
	if err != nil {
		return nil, err
	}
	files := map[string][]byte{}
	for _, entry := range names {
		if entry.IsDir() {
			return nil, errors.New("unexpected runtime bundle directory")
		}
		data, err := assets.ReadFile("assets/" + entry.Name())
		if err != nil {
			return nil, err
		}
		files[entry.Name()] = data
	}
	var manifest struct {
		Schema int               `json:"schema"`
		Files  map[string]string `json:"files"`
	}
	if json.Unmarshal(files["bundle.json"], &manifest) != nil || manifest.Schema != 1 || len(manifest.Files) != len(files)-1 {
		return nil, errors.New("invalid Palworld runtime bundle")
	}
	for name, digest := range manifest.Files {
		if filepath.Base(name) != name || strings.ContainsAny(name, "/\\") || sum(files[name]) != digest {
			return nil, errors.New("Palworld runtime bundle checksum mismatch")
		}
	}
	return files, nil
}

func safeDirectory(path string) error {
	if !filepath.IsAbs(path) {
		return errors.New("absolute runtime bundle directory required")
	}
	for current := path; ; current = filepath.Dir(current) {
		info, err := os.Lstat(current)
		if err == nil && (!info.IsDir() || info.Mode()&os.ModeSymlink != 0) {
			return errors.New("runtime bundle path contains a non-directory or symbolic path")
		}
		if err != nil && !os.IsNotExist(err) {
			return err
		}
		if filepath.Dir(current) == current {
			break
		}
	}
	return nil
}

func verifyDirectory(path string, files map[string][]byte) error {
	if err := safeDirectory(path); err != nil {
		return err
	}
	entries, err := os.ReadDir(path)
	if err != nil {
		return err
	}
	if len(entries) != len(files) {
		return errors.New("runtime bundle member count changed")
	}
	for name, wanted := range files {
		target := filepath.Join(path, name)
		info, err := os.Lstat(target)
		if err != nil || !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 || info.Size() != int64(len(wanted)) {
			return errors.New("runtime bundle file changed type or size")
		}
		data, err := os.ReadFile(target)
		if err != nil || sum(data) != sum(wanted) {
			return errors.New("runtime bundle file checksum changed")
		}
	}
	return nil
}

// Stage publishes public immutable bytes under a trusted node-owned directory.
// The returned directory is mounted read-only into a stopped-volume helper.
func Stage(parent string) (string, error) {
	if err := safeDirectory(parent); err != nil {
		return "", err
	}
	files, err := Files()
	if err != nil {
		return "", err
	}
	if err = os.MkdirAll(parent, 0o755); err != nil {
		return "", err
	}
	target := filepath.Join(parent, "palworld-public-"+sum(files["bundle.json"]))
	if _, err = os.Lstat(target); err == nil {
		return target, verifyDirectory(target, files)
	} else if !os.IsNotExist(err) {
		return "", err
	}
	temporary, err := os.MkdirTemp(parent, ".palworld-public-")
	if err != nil {
		return "", err
	}
	defer os.RemoveAll(temporary)
	for name, data := range files {
		file, err := os.OpenFile(filepath.Join(temporary, name), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o444)
		if err != nil {
			return "", err
		}
		_, writeErr := file.Write(data)
		syncErr := file.Sync()
		closeErr := file.Close()
		if err = errors.Join(writeErr, syncErr, closeErr); err != nil {
			return "", err
		}
	}
	if err = os.Chmod(temporary, 0o555); err != nil {
		return "", err
	}
	if err = os.Rename(temporary, target); err != nil {
		if _, statErr := os.Stat(target); statErr != nil {
			return "", err
		}
	}
	return target, verifyDirectory(target, files)
}

// PreflightShell is fixed generated shell text with public paths/checksums only.
func PreflightShell() (string, error) {
	files, err := Files()
	if err != nil {
		return "", err
	}
	names := make([]string, 0, len(files))
	for name := range files {
		names = append(names, name)
	}
	sort.Strings(names)
	var script strings.Builder
	for _, name := range names {
		fmt.Fprintf(&script, "printf '%%s  %%s\\n' '%s' '/home/container/%s%s' | sha256sum -c - >/dev/null\n", sum(files[name]), Tools, name)
	}
	fmt.Fprintf(&script, "python3 /home/container/%sruntime.py verify\n", Tools)
	return script.String(), nil
}
