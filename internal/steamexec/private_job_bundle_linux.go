//go:build linux

package steamexec

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"syscall"
)

func verifyPrivateInventory(root string, expected map[string]string) error {
	bad := errors.New("private Steam immutable worker bundle rejected")
	if !filepath.IsAbs(root) || filepath.Clean(root) != root || len(expected) == 0 || len(expected) > 20000 {
		return bad
	}
	f, e := openPrivateDir(root)
	if e != nil {
		return bad
	}
	f.Close()
	for p := root; ; p = filepath.Dir(p) {
		s, e := os.Lstat(p)
		if e != nil || !s.IsDir() || s.Mode()&022 != 0 {
			return bad
		}
		st, ok := s.Sys().(*syscall.Stat_t)
		if !ok || st.Uid != 0 {
			return bad
		}
		if p == "/" {
			break
		}
	}
	dirs := map[string]bool{".": true}
	for path, hash := range expected {
		if len(hash) != 64 || strings.ToLower(hash) != hash || filepath.IsAbs(path) || filepath.Clean(path) != path || strings.HasPrefix(path, "../") {
			return bad
		}
		for d := filepath.Dir(path); d != "."; d = filepath.Dir(d) {
			dirs[d] = true
		}
	}
	count := 0
	e = filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return bad
		}
		rel, _ := filepath.Rel(root, path)
		s, e := d.Info()
		if e != nil {
			return bad
		}
		st, ok := s.Sys().(*syscall.Stat_t)
		if !ok || st.Uid != 0 || s.Mode()&022 != 0 || s.Mode()&os.ModeSymlink != 0 {
			return bad
		}
		if d.IsDir() {
			if !dirs[rel] {
				return bad
			}
			return nil
		}
		want, ok := expected[rel]
		if !ok || !s.Mode().IsRegular() {
			return bad
		}
		f, e := os.Open(path)
		if e != nil {
			return bad
		}
		h := sha256.New()
		_, e = io.Copy(h, f)
		f.Close()
		if e != nil || hex.EncodeToString(h.Sum(nil)) != want {
			return bad
		}
		count++
		return nil
	})
	if e != nil || count != len(expected) {
		return bad
	}
	return nil
}
func (b *PrivateWorkerBundle) verify(executable, runtime string) error {
	if b == nil || filepath.Dir(executable) != b.Root || runtime != b.RuntimeRoot {
		return errors.New("private Steam provisioned bundle unavailable")
	}
	if e := verifyPrivateInventory(b.Root, b.Files); e != nil {
		return e
	}
	return verifyPrivateInventory(b.RuntimeRoot, b.RuntimeFiles)
}
