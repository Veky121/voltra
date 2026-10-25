//go:build linux

package nodeagent

import (
	"context"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"

	"voltra/internal/steamapi"
	"voltra/internal/steamexec"
)

type installedPrivateSteamRelease struct {
	workerSHA    string
	identity     PrivateSteamReleaseIdentity
	ctx          context.Context
	root, digest string
	authority    PrivateSteamReleaseAuthority
	admission    steamexec.PrivateAdmission
	approval     PrivateSteamProductionReleaseApproval
}

// releaseDirectory opens every component without following links. The installed
// tree and all ancestors additionally remain root-owned and non-writable by users.
func releaseDirectory(path string) (*os.File, error) {
	if !filepath.IsAbs(path) || filepath.Clean(path) != path {
		return nil, errPrivateRelease
	}
	fd, err := syscall.Open("/", syscall.O_RDONLY|syscall.O_DIRECTORY|syscall.O_CLOEXEC, 0)
	if err != nil {
		return nil, errPrivateRelease
	}
	for _, part := range strings.Split(strings.TrimPrefix(path, "/"), "/") {
		if part == "" {
			continue
		}
		next, e := syscall.Openat(fd, part, syscall.O_RDONLY|syscall.O_DIRECTORY|syscall.O_NOFOLLOW|syscall.O_CLOEXEC, 0)
		syscall.Close(fd)
		if e != nil {
			return nil, errPrivateRelease
		}
		fd = next
	}
	return os.NewFile(uintptr(fd), "private-release"), nil
}

func (s *installedPrivateSteamRelease) installed(ctx context.Context) (*PrivateCandidateManifest, error) {
	if s.ctx.Err() != nil || ctx.Err() != nil || runtime.GOARCH != "amd64" || !candidateHash.MatchString(s.digest) || candidateTrustedDirectory(s.root) != nil {
		return nil, errPrivateRelease
	}
	root, err := releaseDirectory(s.root)
	if err != nil {
		return nil, errPrivateRelease
	}
	defer root.Close()
	before, err := root.Stat()
	if err != nil {
		return nil, errPrivateRelease
	}
	fd, err := syscall.Openat(int(root.Fd()), "manifest.json", syscall.O_RDONLY|syscall.O_NOFOLLOW|syscall.O_CLOEXEC|syscall.O_NONBLOCK, 0)
	if err != nil {
		return nil, errPrivateRelease
	}
	f := os.NewFile(uintptr(fd), "private-release-manifest")
	info, err := f.Stat()
	if err != nil {
		f.Close()
		return nil, errPrivateRelease
	}
	st, ok := info.Sys().(*syscall.Stat_t)
	if !ok || !info.Mode().IsRegular() || info.Mode()&022 != 0 || st.Uid != 0 || st.Gid != 0 || st.Nlink != 1 || info.Size() > 8<<20 {
		f.Close()
		return nil, errPrivateRelease
	}
	raw, err := io.ReadAll(io.LimitReader(f, 8<<20+1))
	f.Close()
	if err != nil {
		return nil, errPrivateRelease
	}
	m, err := candidateManifest(raw, s.digest)
	if err != nil || candidateVerifyTree(s.root, m, raw, s.digest, false) != nil {
		return nil, errPrivateRelease
	}
	after, err := os.Lstat(s.root)
	if err != nil || !os.SameFile(before, after) || s.ctx.Err() != nil || ctx.Err() != nil {
		return nil, errPrivateRelease
	}
	return m, nil
}

func privateReleaseRevision(s string) bool {
	if len(s) == 0 || len(s) > 128 {
		return false
	}
	for _, c := range s {
		if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '-' || c == '_' || c == '.') {
			return false
		}
	}
	return true
}
func (s *installedPrivateSteamRelease) approved(ctx context.Context) (*PrivateCandidateManifest, PrivateSteamProductionReleaseApproval, error) {
	var empty PrivateSteamProductionReleaseApproval
	m, err := s.installed(ctx)
	if err != nil {
		return nil, empty, errPrivateRelease
	}
	a, err := s.currentApproval(ctx)
	if err != nil {
		return nil, empty, errPrivateRelease
	}
	return m, a, nil
}

const privateReleaseAuthorityTimeout = 2 * time.Second
const privateReleasePollInterval = time.Second

func (s *installedPrivateSteamRelease) currentApproval(ctx context.Context) (PrivateSteamProductionReleaseApproval, error) {
	var empty PrivateSteamProductionReleaseApproval
	query, cancel := context.WithTimeout(ctx, privateReleaseAuthorityTimeout)
	defer cancel()
	a, err := s.authority.CurrentPrivateSteamRelease(query, s.identity)
	if err != nil || query.Err() != nil || ctx.Err() != nil || s.ctx.Err() != nil || a.ManifestSHA256 != s.digest || a.Provider != s.identity.Provider || a.RID != s.identity.RID || !privateReleaseRevision(a.Revision) || !a.ValidUntil.After(time.Now()) || len(a.AppPolicies) == 0 || len(a.AppPolicies) > len(steamapi.RegisteredPrivateApps()) {
		return empty, errPrivateRelease
	}
	seen := map[uint32]bool{}
	for _, p := range a.AppPolicies {
		hash, ok := PrivateSteamAppPolicySHA256(p.App)
		if !ok || seen[p.App] || !privateReleaseRevision(p.Revision) || p.ProfileSHA256 != hash {
			return empty, errPrivateRelease
		}
		seen[p.App] = true
	}
	if s.approval.Revision != "" {
		// Expiry can be renewed by the authority, but bytes, revisions and policy
		// membership cannot silently change inside this connector generation.
		frozen, current := s.approval, a
		frozen.ValidUntil = time.Time{}
		current.ValidUntil = time.Time{}
		x, _ := json.Marshal(frozen)
		y, _ := json.Marshal(current)
		if string(x) != string(y) {
			return empty, errPrivateRelease
		}
	}
	if a.ReceiptRecovery != nil {
		review := *a.ReceiptRecovery
		review.AppPolicies = append([]PrivateSteamReviewedAppPolicy(nil), review.AppPolicies...)
		if review.ABI != steamapi.PrivateRecoveryABI || review.ManifestSHA256 != s.digest || (!candidateHash.MatchString(review.EntrypointSHA256) || review.EntrypointSHA256 != s.workerSHA) || len(review.AppPolicies) == 0 || len(review.AppPolicies) > len(a.AppPolicies) {
			return empty, errPrivateRelease
		}
		seenRecovery := map[uint32]bool{}
		for _, p := range review.AppPolicies {
			hash, ok := PrivateSteamAppPolicySHA256(p.App)
			if !ok || !seen[p.App] || seenRecovery[p.App] || !privateReleaseRevision(p.Revision) || hash != p.ProfileSHA256 {
				return empty, errPrivateRelease
			}
			seenRecovery[p.App] = true
		}
		a.ReceiptRecovery = &review
	}
	a.AppPolicies = append([]PrivateSteamReviewedAppPolicy(nil), a.AppPolicies...)
	return a, nil
}
func (s *installedPrivateSteamRelease) ProductionReady(ctx context.Context) error {
	_, _, err := s.approved(ctx)
	return err
}
func (s *installedPrivateSteamRelease) AppPolicyReady(app uint32) bool {
	_, a, err := s.approved(s.ctx)
	if err != nil {
		return false
	}
	for _, p := range a.AppPolicies {
		if p.App == app {
			return true
		}
	}
	return false
}
func (s *installedPrivateSteamRelease) Acquire(ctx context.Context, r steamapi.PrivateRequest) (*steamexec.PrivateRoots, error) {
	if err := r.Validate(); err != nil {
		return nil, err
	}
	if !privateReleaseRequestPolicy(r) || !s.AppPolicyReady(r.Selection.App) || s.ProductionReady(ctx) != nil {
		return nil, errPrivateRelease
	}
	roots, err := s.admission.Acquire(ctx, r)
	if err != nil {
		return nil, errPrivateRelease
	}
	if roots == nil || roots.Release == nil {
		return nil, errPrivateRelease
	}
	if roots.Target == nil || roots.Work == nil || roots.Cache == nil || s.ProductionReady(ctx) != nil || !s.AppPolicyReady(r.Selection.App) {
		roots.Release()
		return nil, errPrivateRelease
	}
	return roots, nil
}
func composeInstalledPrivateSteamRelease(ctx context.Context, root, digest string, admission steamexec.PrivateAdmission, authority PrivateSteamReleaseAuthority) (*PrivateSteamConnectorConfig, error) {
	s := &installedPrivateSteamRelease{ctx: ctx, root: root, digest: digest, admission: admission, authority: authority}
	m, err := s.installed(ctx)
	if err != nil {
		return nil, errPrivateRelease
	}
	s.identity = PrivateSteamReleaseIdentity{digest, m.Provider, m.RID, m.WorkerTarSHA256, m.SourceTarSHA256, m.InputsSHA256}
	for _, f := range m.Files {
		if f.Path == m.Entrypoint {
			s.workerSHA = f.SHA256
		}
	}
	_, a, err := s.approved(ctx)
	if err != nil {
		return nil, errPrivateRelease
	}
	s.approval = a
	installed := candidateInstallation(root, digest, m)
	workerHash := ""
	for _, f := range m.Files {
		if f.Path == m.Entrypoint {
			workerHash = f.SHA256
		}
	}
	runner := &steamexec.PrivateJobRunner{Admission: s, Executable: filepath.Join(root, "binary", m.Entrypoint), RuntimeRoot: installed.Bundle.RuntimeRoot, WorkerSHA256: workerHash, Provider: m.Provider, Bundle: installed.Bundle}
	return &PrivateSteamConnectorConfig{Runner: &installedPrivateSteamRunner{release: s, runner: runner}, Readiness: s}, nil
}

// Active workers are canceled on authority error/revocation or approval expiry.
// Polls never rehash the bundle. There is one joined monitor per active job, at
// most one query per second, with a two-second query deadline. Revocation latency
// is at most one poll interval plus query deadline (assuming authority honors ctx).
type installedPrivateSteamRunner struct {
	release *installedPrivateSteamRelease
	runner  PrivateSteamRunner
}

func (w *installedPrivateSteamRunner) Run(ctx context.Context, r steamapi.PrivateRequest, emit func(steamapi.PrivateEvent) error, guard func(context.Context, steamapi.PrivateChallenge) (steamapi.PrivateReply, error)) error {
	if r.Validate() != nil || !privateReleaseRequestPolicy(r) {
		return errPrivateRelease
	}
	ctx, cancel := context.WithTimeout(ctx, time.Duration(r.DeadlineSeconds)*time.Second)
	stop := context.AfterFunc(w.release.ctx, cancel)
	defer stop()
	defer cancel()
	_, approval, err := w.release.approved(ctx)
	if err != nil {
		return errPrivateRelease
	}
	allowed := false
	for _, p := range approval.AppPolicies {
		if p.App == r.Selection.App {
			allowed = true
		}
	}
	if !allowed {
		return errPrivateRelease
	}
	done := make(chan struct{})
	revoked := make(chan struct{}, 1)
	go func() {
		defer close(done)
		for {
			delay := privateReleasePollInterval
			if remaining := time.Until(approval.ValidUntil); remaining < delay {
				delay = remaining
			}
			timer := time.NewTimer(max(delay, 0))
			select {
			case <-ctx.Done():
				timer.Stop()
				return
			case <-timer.C:
			}
			if !approval.ValidUntil.After(time.Now()) {
				revoked <- struct{}{}
				cancel()
				return
			}
			checkCtx, checkCancel := context.WithDeadline(ctx, approval.ValidUntil)
			next, e := w.release.currentApproval(checkCtx)
			checkCancel()
			if ctx.Err() != nil {
				return
			}
			if e != nil {
				revoked <- struct{}{}
				cancel()
				return
			}
			approval = next
		}
	}()
	defer func() { cancel(); <-done }() // Also join if a trusted runner panics.
	err = w.runner.Run(ctx, r, emit, guard)
	cancel()
	<-done
	select {
	case <-revoked:
		return errPrivateRelease
	default:
		return err
	}
}
