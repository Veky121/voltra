//go:build linux

package steamexec

import (
	"errors"
	"os"
	"syscall"
)

func lockServer(path string) (func(), error) {
	f, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, errors.New("Steam server lock unavailable")
	}
	if syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB) != nil {
		f.Close()
		return nil, errors.New("Steam maintenance active in another node process")
	}
	return func() { _ = syscall.Flock(int(f.Fd()), syscall.LOCK_UN); _ = f.Close() }, nil
}

func syncDirectory(path string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	return f.Sync()
}

func fileOwner(info os.FileInfo) (uint32, uint32, bool) {
	s, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		return 0, 0, false
	}
	return s.Uid, s.Gid, true
}

func chownBootstrap(dir string, expected os.FileInfo, uid, gid uint32) error {
	fd, err := syscall.Open(dir, syscall.O_RDONLY|syscall.O_DIRECTORY|syscall.O_NOFOLLOW|syscall.O_CLOEXEC, 0)
	if err != nil {
		return errors.New("cannot safely open bootstrap directory for ownership repair")
	}
	f := os.NewFile(uintptr(fd), dir)
	defer f.Close()
	info, err := f.Stat()
	if err != nil || !os.SameFile(info, expected) {
		return errors.New("bootstrap directory changed during ownership validation")
	}
	owner, _, ok := fileOwner(info)
	if !ok || owner != 0 {
		return errors.New("bootstrap directory ownership changed; retry initial install")
	}
	if err = f.Chown(int(uid), int(gid)); err != nil {
		return errors.New("cannot prepare initial directory owner; check node service write access")
	}
	return f.Sync()
}
