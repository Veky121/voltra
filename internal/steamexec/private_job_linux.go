//go:build linux

package steamexec

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"voltra/internal/steamapi"
)

type PrivateDirectorySet struct{ Target, Work, Cache string }

// PrivateDirectoryAdmission is a trusted offline/local filesystem adapter. Live
// callers must wrap it in the existing Executor's shared stopped-server lock.
type PrivateDirectoryAdmission struct {
	Roots map[string]PrivateDirectorySet
}

func openPrivateDir(path string) (*os.File, error) {
	if !filepath.IsAbs(path) || filepath.Clean(path) != path {
		return nil, errors.New("private Steam root rejected")
	}
	fd, e := syscall.Open("/", syscall.O_RDONLY|syscall.O_DIRECTORY|syscall.O_CLOEXEC, 0)
	if e != nil {
		return nil, e
	}
	for _, part := range strings.Split(strings.TrimPrefix(path, "/"), "/") {
		next, e := syscall.Openat(fd, part, syscall.O_RDONLY|syscall.O_DIRECTORY|syscall.O_NOFOLLOW|syscall.O_CLOEXEC, 0)
		syscall.Close(fd)
		if e != nil {
			return nil, errors.New("private Steam root rejected")
		}
		fd = next
	}
	return os.NewFile(uintptr(fd), path), nil
}
func (a *PrivateDirectoryAdmission) Acquire(ctx context.Context, r steamapi.PrivateRequest) (*PrivateRoots, error) {
	return a.acquirePrivate(ctx, r, false)
}
func (a *PrivateDirectoryAdmission) AcquireRecovery(ctx context.Context, r steamapi.PrivateRequest) (*PrivateRoots, error) {
	return a.acquirePrivate(ctx, r, true)
}
func (a *PrivateDirectoryAdmission) acquirePrivate(ctx context.Context, r steamapi.PrivateRequest, recovering bool) (*PrivateRoots, error) {
	if recovering {
		if _, e := steamapi.PrivateRecoveryOriginalFromRequest(r); e != nil {
			return nil, e
		}
	}
	if e := r.Validate(); e != nil {
		return nil, e
	}
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	set, ok := a.Roots[r.Server+":"+r.Owner]
	if !ok {
		return nil, errors.New("private Steam root authorization rejected")
	}
	paths := []string{set.Target, set.Work, set.Cache}
	for i, p := range paths {
		for k, q := range paths {
			if i != k && (p == q || strings.HasPrefix(p, q+string(os.PathSeparator))) {
				return nil, errors.New("private Steam overlapping storage roots rejected")
			}
		}
	}
	roots := &PrivateRoots{}
	opened := []*os.File{}
	roots.Release = func() {
		for _, f := range opened {
			f.Close()
		}
	}
	fail := func() (*PrivateRoots, error) {
		roots.Release()
		return nil, errors.New("private Steam storage admission rejected")
	}
	var e error
	for i, path := range []string{set.Target, set.Work, set.Cache} {
		f, err := openPrivateDir(path)
		if err != nil {
			return fail()
		}
		opened = append(opened, f)
		switch i {
		case 0:
			roots.Target = f
		case 1:
			roots.Work = f
		case 2:
			roots.Cache = f
		}
	}
	var stats [3]syscall.Stat_t
	for i, f := range opened {
		if syscall.Fstat(int(f.Fd()), &stats[i]) != nil {
			return fail()
		}
		if i > 0 && (stats[i].Uid != uint32(os.Geteuid()) || stats[i].Mode&077 != 0) {
			return fail()
		}
	}
	if stats[0].Dev != stats[1].Dev {
		return fail()
	}
	for i := range stats {
		for k := 0; k < i; k++ {
			if stats[i].Dev == stats[k].Dev && stats[i].Ino == stats[k].Ino {
				return fail()
			}
		}
	}
	if syscall.Flock(int(roots.Work.Fd()), syscall.LOCK_EX|syscall.LOCK_NB) != nil {
		return fail()
	}
	if recovering {
		return roots, nil
	}
	name := "admission-" + r.Scope().Job + ".json"
	fd, err := syscall.Openat(int(roots.Work.Fd()), name, syscall.O_WRONLY|syscall.O_CREAT|syscall.O_EXCL|syscall.O_NOFOLLOW|syscall.O_CLOEXEC, 0600)
	if err != nil {
		return fail()
	}
	f := os.NewFile(uintptr(fd), name)
	e = json.NewEncoder(f).Encode(r.Scope())
	if e == nil {
		e = f.Sync()
	}
	f.Close()
	if e != nil || roots.Work.Sync() != nil {
		return fail()
	}
	return roots, nil
}
func verifyPrivateWorker(path, digest string) error {
	if !filepath.IsAbs(path) || len(digest) != 64 {
		return errors.New("private Steam worker identity unavailable")
	}
	info, e := os.Lstat(path)
	if e != nil || !info.Mode().IsRegular() || info.Mode()&022 != 0 {
		return errors.New("private Steam worker identity rejected")
	}
	f, e := os.Open(path)
	if e != nil {
		return errors.New("private Steam worker identity rejected")
	}
	defer f.Close()
	h := sha256.New()
	if _, e = io.Copy(h, f); e != nil || hex.EncodeToString(h.Sum(nil)) != digest {
		return errors.New("private Steam worker identity rejected")
	}
	return nil
}
func validatePrivateProvider(work *os.File, raw json.RawMessage) error {
	var ref steamapi.PrivateReceipt
	if json.Unmarshal(raw, &ref) != nil {
		return errors.New("private Steam receipt rejected")
	}
	parts := strings.Split(ref.Path, "/")
	if len(parts) != 4 {
		return errors.New("private Steam receipt rejected")
	}
	dir, e := syscall.Dup(int(work.Fd()))
	if e != nil {
		return e
	}
	for _, p := range parts[:3] {
		if len(p) != 64 {
			syscall.Close(dir)
			return errors.New("private Steam receipt rejected")
		}
		n, e := syscall.Openat(dir, p, syscall.O_RDONLY|syscall.O_DIRECTORY|syscall.O_NOFOLLOW|syscall.O_CLOEXEC, 0)
		syscall.Close(dir)
		if e != nil {
			return errors.New("private Steam receipt rejected")
		}
		dir = n
	}
	fd, e := syscall.Openat(dir, "receipt.json", syscall.O_RDONLY|syscall.O_NOFOLLOW|syscall.O_CLOEXEC, 0)
	syscall.Close(dir)
	if e != nil {
		return errors.New("private Steam receipt rejected")
	}
	f := os.NewFile(uintptr(fd), "receipt")
	defer f.Close()
	var receipt struct {
		Provider    string `json:"provider"`
		Entitlement bool   `json:"entitlement_verified"`
		Committed   bool   `json:"publication_committed"`
		Native      bool   `json:"native_acceptance_verified"`
		Account     bool   `json:"account_entitlement_verified"`
		Proof       string `json:"access_proof"`
	}
	if json.NewDecoder(io.LimitReader(f, 16<<20)).Decode(&receipt) != nil || receipt.Provider != steamapi.PrivateProvider || !receipt.Entitlement || !receipt.Committed || receipt.Native || !receipt.Account || receipt.Proof != "private_account" {
		return errors.New("private Steam receipt provider rejected")
	}
	return nil
}

// PrivateExecutorAdmission supplies cooperative public/private Executor exclusion.
// External Wings start/Reinstall still requires Panel lifecycle serialization.
type PrivateExecutorAdmission struct {
	Executor *Executor
	Storage  *PrivateDirectoryAdmission
}

func (a *PrivateExecutorAdmission) Acquire(ctx context.Context, r steamapi.PrivateRequest) (*PrivateRoots, error) {
	return a.acquirePrivate(ctx, r, false)
}
func (a *PrivateExecutorAdmission) AcquireRecovery(ctx context.Context, r steamapi.PrivateRequest) (*PrivateRoots, error) {
	return a.acquirePrivate(ctx, r, true)
}
func (a *PrivateExecutorAdmission) acquirePrivate(ctx context.Context, r steamapi.PrivateRequest, recovering bool) (*PrivateRoots, error) {
	if recovering {
		if _, e := steamapi.PrivateRecoveryOriginalFromRequest(r); e != nil {
			return nil, e
		}
	}
	if r.Validate() != nil || a.Executor == nil || a.Storage == nil {
		return nil, errors.New("private Steam admission unavailable")
	}
	e := a.Executor
	release, err := e.reserveMaintenance(r.Server)
	if err != nil {
		return nil, err
	}
	ok := false
	defer func() {
		if !ok {
			release()
		}
	}()
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	if !recovering && os.MkdirAll(e.journal, 0700) != nil {
		return nil, errors.New("Steam journal unavailable")
	}
	var unlock func()
	if recovering {
		unlock, err = lockPrivateRecoveryServer(e.journal, r.Server+".lock")
	} else {
		unlock, err = lockServer(filepath.Join(e.journal, r.Server+".lock"))
	}
	if err != nil {
		return nil, err
	}
	locked := true
	defer func() {
		if locked {
			unlock()
		}
	}()
	dir, state, err := e.gamePath(ctx, steamapi.Request{ServerUUID: r.Server, AppID: int64(r.Selection.App)})
	if err != nil {
		return nil, err
	}
	if running(state) {
		return nil, errors.New("stop the game before private Steam maintenance")
	}
	out := &cappedOutput{max: 4096}
	if e.docker.Run(ctx, []string{"ps", "-q", "--filter", "name=^/" + r.Server + "_installer$"}, out) != nil {
		return nil, errors.New("Wings installer state unavailable")
	}
	ids, cut := out.text()
	if cut || strings.TrimSpace(ids) != "" {
		return nil, errors.New("Wings installer is active")
	}
	var roots *PrivateRoots
	if recovering {
		roots, err = a.Storage.AcquireRecovery(ctx, r)
	} else {
		roots, err = a.Storage.Acquire(ctx, r)
	}
	if err != nil {
		return nil, err
	}
	actual, err := openPrivateDir(dir)
	if err != nil {
		roots.Release()
		return nil, err
	}
	x, _ := actual.Stat()
	y, _ := roots.Target.Stat()
	actual.Close()
	if x == nil || y == nil || !os.SameFile(x, y) {
		roots.Release()
		return nil, errors.New("private Steam target identity mismatch")
	}
	old := roots.Release
	roots.Release = func() { old(); unlock(); release() }
	ok = true
	locked = false
	return roots, nil
}
func validatePrivatePrior(p PrivateContentProcess, ctx context.Context, r PrivateContentRequest) (json.RawMessage, error) {
	return p.run(ctx, r, true)
}
