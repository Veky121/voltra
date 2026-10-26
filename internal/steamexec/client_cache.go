package steamexec

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strconv"

	"github.com/google/uuid"
	"voltra/internal/steamapi"
)

// Only SteamCMD's client/runtime and metadata persist here, never game files.
// Root metadata checks cannot execute binaries from a game's non-root cache.
func (e *Executor) clientCache(ctx context.Context, r steamapi.Request, uid, gid uint32, mutation bool) (string, func(), error) {
	if _, err := uuid.Parse(r.ServerUUID); err != nil {
		return "", nil, errors.New("invalid Steam cache scope")
	}
	if err := os.MkdirAll(e.journal, 0700); err != nil {
		return "", nil, errors.New("SteamCMD cache parent unavailable")
	}
	resolved, err := filepath.EvalSymlinks(e.journal)
	if err != nil || resolved != e.journal {
		return "", nil, errors.New("SteamCMD cache must not contain symlinks")
	}
	base := filepath.Join(e.journal, "client-cache")
	if err := os.MkdirAll(base, 0700); err != nil {
		return "", nil, errors.New("SteamCMD client cache unavailable")
	}
	resolved, err = filepath.EvalSymlinks(base)
	if err != nil || resolved != base {
		return "", nil, errors.New("SteamCMD cache must not contain symlinks")
	}
	info, err := os.Stat(base)
	if err != nil {
		return "", nil, errors.New("SteamCMD cache parent permissions invalid")
	}
	if uid, _, ok := fileOwner(info); ok && (uid != uint32(os.Geteuid()) || info.Mode().Perm()&0077 != 0) {
		return "", nil, errors.New("SteamCMD cache parent ownership or permissions invalid")
	}
	scope := "metadata"
	if mutation {
		scope = "server-" + r.ServerUUID + "-" + strconv.FormatUint(uint64(uid), 10) + "-" + strconv.FormatUint(uint64(gid), 10)
	}
	// Lock files stay outside the child-owned directory. Release only after the
	// Docker helper has stopped, including cancellation and cleanup.
	release, err := lockClientCache(ctx, filepath.Join(base, scope+".lock"))
	if err != nil {
		return "", nil, err
	}
	cache := filepath.Join(base, scope)
	created := false
	if err = os.Mkdir(cache, 0700); err == nil {
		created = true
	} else if !os.IsExist(err) {
		release()
		return "", nil, errors.New("SteamCMD client cache unavailable")
	}
	info, err = os.Lstat(cache)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		release()
		return "", nil, errors.New("SteamCMD client cache permissions invalid")
	}
	if _, _, ok := fileOwner(info); ok && info.Mode().Perm()&0077 != 0 {
		release()
		return "", nil, errors.New("SteamCMD client cache permissions invalid")
	}
	if err = e.cacheOwner(cache, uid, gid, created); err != nil {
		release()
		return "", nil, err
	}
	return cache, release, nil
}
