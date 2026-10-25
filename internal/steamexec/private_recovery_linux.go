//go:build linux

package steamexec

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"syscall"
)

func lockPrivateRecoveryServer(journal, name string) (func(), error) {
	bad := errors.New("private Steam existing recovery lock unavailable")
	dir, e := openPrivateDir(journal)
	if e != nil {
		return nil, bad
	}
	defer dir.Close()
	info, e := dir.Stat()
	if e != nil {
		return nil, bad
	}
	st, ok := info.Sys().(*syscall.Stat_t)
	if !ok || st.Uid != uint32(os.Geteuid()) || info.Mode()&022 != 0 {
		return nil, bad
	}
	fd, e := syscall.Openat(int(dir.Fd()), name, syscall.O_RDONLY|syscall.O_NOFOLLOW|syscall.O_CLOEXEC|syscall.O_NONBLOCK, 0)
	if e != nil {
		return nil, bad
	}
	f := os.NewFile(uintptr(fd), "recovery-lock")
	info, e = f.Stat()
	if e != nil {
		f.Close()
		return nil, bad
	}
	st, ok = info.Sys().(*syscall.Stat_t)
	if !ok || !info.Mode().IsRegular() || st.Uid != uint32(os.Geteuid()) || st.Nlink != 1 || info.Mode()&077 != 0 || syscall.Flock(fd, syscall.LOCK_EX|syscall.LOCK_NB) != nil {
		f.Close()
		return nil, bad
	}
	return func() { f.Close() }, nil
}
func recoverPrivateProcess(p PrivateContentProcess, ctx context.Context, r PrivateContentRequest) (json.RawMessage, error) {
	return p.runOperation(ctx, r, "recover_private_receipt")
}
