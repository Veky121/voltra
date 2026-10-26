//go:build linux

package steamexec

import (
	"context"
	"errors"
	"os"
	"syscall"
	"time"
)

func prepareClientCacheOwner(path string, uid, gid uint32, created bool) error {
	fd, err := syscall.Open(path, syscall.O_RDONLY|syscall.O_DIRECTORY|syscall.O_NOFOLLOW|syscall.O_CLOEXEC, 0)
	if err != nil {
		return errors.New("SteamCMD cache directory unavailable")
	}
	f := os.NewFile(uintptr(fd), path)
	defer f.Close()
	if created {
		if err = f.Chown(int(uid), int(gid)); err != nil {
			return errors.New("SteamCMD cache ownership preparation failed")
		}
	}
	info, err := f.Stat()
	if err != nil {
		return err
	}
	owner, group, ok := fileOwner(info)
	if !ok || owner != uid || group != gid {
		return errors.New("SteamCMD cache owner changed; operator recovery required")
	}
	return nil
}

func lockClientCache(ctx context.Context, path string) (func(), error) {
	fd, err := syscall.Open(path, syscall.O_CREAT|syscall.O_RDWR|syscall.O_NOFOLLOW|syscall.O_CLOEXEC, 0600)
	if err != nil {
		return nil, errors.New("SteamCMD cache lock unavailable")
	}
	f := os.NewFile(uintptr(fd), path)
	for {
		if err = ctx.Err(); err != nil {
			f.Close()
			return nil, err
		}
		err = syscall.Flock(fd, syscall.LOCK_EX|syscall.LOCK_NB)
		if err == nil {
			return func() { _ = syscall.Flock(fd, syscall.LOCK_UN); _ = f.Close() }, nil
		}
		if err != syscall.EWOULDBLOCK && err != syscall.EAGAIN {
			f.Close()
			return nil, errors.New("SteamCMD cache lock failed")
		}
		select {
		case <-ctx.Done():
			f.Close()
			return nil, ctx.Err()
		case <-time.After(50 * time.Millisecond):
		}
	}
}
