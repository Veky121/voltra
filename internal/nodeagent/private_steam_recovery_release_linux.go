//go:build linux

package nodeagent

import (
	"context"
	"time"
	"voltra/internal/steamapi"
	"voltra/internal/steamexec"
)

func (s *installedPrivateSteamRelease) ReceiptRecoveryReady(ctx context.Context, app uint32) error {
	m, a, e := s.approved(ctx)
	if e != nil || a.ReceiptRecovery == nil {
		return errPrivateRelease
	}
	for _, f := range m.Files {
		if f.Path == m.Entrypoint && f.SHA256 == a.ReceiptRecovery.EntrypointSHA256 {
			for _, p := range a.ReceiptRecovery.AppPolicies {
				if p.App == app {
					return nil
				}
			}
		}
	}
	return errPrivateRelease
}
func (s *installedPrivateSteamRelease) AcquireRecovery(ctx context.Context, r steamapi.PrivateRequest) (*steamexec.PrivateRoots, error) {
	if _, e := steamapi.PrivateRecoveryOriginalFromRequest(r); e != nil {
		return nil, errPrivateRelease
	}
	a, ok := s.admission.(steamexec.PrivateRecoveryAdmission)
	if !ok || !privateReleaseRequestPolicy(r) || s.ReceiptRecoveryReady(ctx, r.Selection.App) != nil {
		return nil, errPrivateRelease
	}
	roots, e := a.AcquireRecovery(ctx, r)
	if e != nil || roots == nil {
		return nil, errPrivateRelease
	}
	if roots.Release == nil {
		return nil, errPrivateRelease
	}
	if roots.Target == nil || roots.Work == nil || roots.Cache == nil || s.ReceiptRecoveryReady(ctx, r.Selection.App) != nil {
		roots.Release()
		return nil, errPrivateRelease
	}
	return roots, nil
}
func (w *installedPrivateSteamRunner) Recover(ctx context.Context, v steamapi.PrivateReceiptRecoveryRequest, emit func(steamapi.PrivateEvent) error) error {
	ctx, cancel, e := steamexec.PrivateRecoveryContext(ctx, v, time.Time{})
	if e != nil {
		return errPrivateRelease
	}
	defer cancel()
	if v.Validate() != nil || !privateReleaseRequestPolicy(v.Original.Request()) || w.release.ReceiptRecoveryReady(ctx, v.Original.Selection.App) != nil {
		return errPrivateRelease
	}
	base, actual := w.runner.(*steamexec.PrivateJobRunner)
	fixture, implementsRecovery := w.runner.(PrivateSteamRecoverer)
	if !actual && !implementsRecovery {
		return errPrivateRelease
	}
	_, approval, e := w.release.approved(ctx)
	if e != nil || approval.ReceiptRecovery == nil {
		return errPrivateRelease
	}
	ctx, approvalCancel := context.WithDeadline(ctx, approval.ValidUntil)
	defer approvalCancel()
	stop := context.AfterFunc(w.release.ctx, cancel)
	defer stop()
	done := make(chan struct{})
	revoked := make(chan struct{}, 1)
	go func() {
		defer close(done)
		for {
			delay := min(privateReleasePollInterval, time.Until(approval.ValidUntil))
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
			check, finish := context.WithDeadline(ctx, approval.ValidUntil)
			next, err := w.release.currentApproval(check)
			finish()
			if ctx.Err() != nil {
				return
			}
			if err != nil || next.ReceiptRecovery == nil {
				revoked <- struct{}{}
				cancel()
				return
			}
			approval = next
		}
	}()
	defer func() { cancel(); <-done }()
	review := w.release.approval.ReceiptRecovery
	recovery := &steamexec.PrivateRecoveryJobRunner{PrivateJobRunner: base, RecoveryAdmission: w.release, Approval: steamexec.PrivateRecoveryWorkerApproval{ABI: review.ABI, ManifestSHA256: review.ManifestSHA256, EntrypointSHA256: review.EntrypointSHA256}}
	if actual {
		e = recovery.Recover(ctx, v, emit)
	} else {
		e = fixture.Recover(ctx, v, emit)
	}
	cancel()
	<-done
	select {
	case <-revoked:
		return errPrivateRelease
	default:
		return e
	}
}

func (w *installedPrivateSteamRunner) ReceiptRecoveryReady(ctx context.Context, app uint32) error {
	return w.release.ReceiptRecoveryReady(ctx, app)
}
