package steamexec

import (
	"context"
	"encoding/json"
	"errors"
	"time"
	"voltra/internal/steamapi"
)

type PrivateRecoveryAdmission interface {
	AcquireRecovery(context.Context, steamapi.PrivateRequest) (*PrivateRoots, error)
}

// This local approval is supplied only after production release authority and
// exact installed manifest/entrypoint checks. It is never a worker wire value.
type PrivateRecoveryWorkerApproval struct{ ABI, ManifestSHA256, EntrypointSHA256 string }
type PrivateRecoveryJobRunner struct {
	*PrivateJobRunner
	RecoveryAdmission PrivateRecoveryAdmission
	Approval          PrivateRecoveryWorkerApproval
}

func (j *PrivateRecoveryJobRunner) Recover(ctx context.Context, v steamapi.PrivateReceiptRecoveryRequest, emit func(steamapi.PrivateEvent) error) error {
	bad := errors.New("private Steam receipt recovery unavailable")
	if emit == nil || v.Validate() != nil || j == nil || j.PrivateJobRunner == nil || j.RecoveryAdmission == nil || j.Approval.ABI != steamapi.PrivateRecoveryABI || !privateRecoveryHash(j.Approval.ManifestSHA256) || j.Approval.EntrypointSHA256 != j.WorkerSHA256 || j.Bundle == nil || j.Provider != steamapi.PrivateProvider || j.Bundle.Provider != j.Provider {
		return bad
	}
	ctx, cancel, e := PrivateRecoveryContext(ctx, v, time.Time{})
	if e != nil {
		return bad
	}
	defer cancel()
	if j.Bundle.verify(j.Executable, j.RuntimeRoot) != nil || verifyPrivateWorker(j.Executable, j.WorkerSHA256) != nil {
		return bad
	}
	r := v.Original.Request()
	roots, e := j.RecoveryAdmission.AcquireRecovery(ctx, r)
	if e != nil {
		return bad
	}
	if roots == nil || roots.Release == nil {
		return bad
	}
	defer roots.Release()
	s := r.Selection
	content := map[string]any{"scope": r.Scope(), "platform": s.Platform, "architecture": s.Architecture, "language": s.Language, "dlc_apps": append([]uint32{}, s.DLC...), "protected_roots": append([]string{}, s.Protected...), "content_budget": r.ContentBudget, "rollback_reserve": r.RollbackReserve, "cache_quota": r.CacheQuota, "deadline_seconds": r.DeadlineSeconds}
	if r.Previous != nil {
		content["previous"] = r.Previous
	}
	frame := PrivateContentRequest{Operation: "recover_private_receipt", Branch: s.Branch, AppID: s.App, ParentFieldsValidated: true, Content: content}
	p := PrivateContentProcess{Executable: j.Executable, RuntimeRoot: j.RuntimeRoot, Target: roots.Target, Work: roots.Work, Cache: roots.Cache, Validate: func(ctx context.Context, raw json.RawMessage) error {
		if e := r.CheckReceipt(raw); e != nil {
			return e
		}
		return validatePrivateProvider(roots.Work, raw)
	}}
	raw, e := recoverPrivateProcess(p, ctx, frame)
	if e != nil {
		return e
	}
	return emit(steamapi.PrivateEvent{Version: steamapi.PrivateVersion, Type: "result", Stage: "receipt_recovered", Receipt: raw})
}
func privateRecoveryHash(s string) bool {
	if len(s) != 64 {
		return false
	}
	for _, c := range s {
		if !(c >= 'a' && c <= 'f' || c >= '0' && c <= '9') {
			return false
		}
	}
	return true
}

// PrivateRecoveryContext preserves the serialized original request and uses its
// validated1..7200second bound for this recovery attempt. Caller and optional
// current approval deadlines can only shorten it; no retry resets a parent bound.
func PrivateRecoveryContext(parent context.Context, v steamapi.PrivateReceiptRecoveryRequest, approvalExpiry time.Time) (context.Context, context.CancelFunc, error) {
	if parent == nil || v.Validate() != nil {
		return nil, nil, errors.New("invalid private Steam recovery deadline")
	}
	deadline := time.Now().Add(time.Duration(v.Original.DeadlineSeconds) * time.Second)
	if !approvalExpiry.IsZero() && approvalExpiry.Before(deadline) {
		deadline = approvalExpiry
	}
	ctx, cancel := context.WithDeadline(parent, deadline)
	return ctx, cancel, nil
}
