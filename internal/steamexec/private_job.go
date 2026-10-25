package steamexec

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"time"
	"voltra/internal/steamapi"
)

type PrivateRoots struct {
	Target, Work, Cache *os.File
	Release             func()
}
type PrivateAdmission interface {
	Acquire(context.Context, steamapi.PrivateRequest) (*PrivateRoots, error)
}
type PrivateJobRunner struct {
	Admission               PrivateAdmission
	Executable, RuntimeRoot string
	WorkerSHA256            string
	Provider                string
	Bundle                  *PrivateWorkerBundle
}

func (j *PrivateJobRunner) Run(ctx context.Context, r steamapi.PrivateRequest, emit func(steamapi.PrivateEvent) error, guard func(context.Context, steamapi.PrivateChallenge) (steamapi.PrivateReply, error)) error {
	if e := r.Validate(); e != nil {
		return e
	}
	if j.Admission == nil || j.Provider != steamapi.PrivateProvider || j.Bundle == nil || j.Bundle.Provider != j.Provider {
		return errors.New("private Steam production worker unavailable")
	}

	s := r.Selection
	frameRequest := PrivateContentRequest{Operation: "private_content", Username: r.Username, Password: r.Password, Guard: r.Guard, Branch: s.Branch, BetaPassword: r.BetaPassword, AppID: s.App, ParentFieldsValidated: true, Content: map[string]any{"target_fd": 6, "work_fd": 7, "cache_fd": 8, "scope": r.Scope(), "platform": s.Platform, "architecture": s.Architecture, "language": s.Language, "dlc_apps": append([]uint32{}, s.DLC...), "protected_roots": append([]string{}, s.Protected...), "content_budget": r.ContentBudget, "rollback_reserve": r.RollbackReserve, "cache_quota": r.CacheQuota, "deadline_seconds": r.DeadlineSeconds}}
	if r.Previous != nil {
		frameRequest.Content["previous"] = r.Previous
	}
	encoded, frameErr := json.Marshal(frameRequest)
	defer clear(encoded)
	if frameErr != nil || len(encoded) > privateFrameLimit {
		clear(encoded)
		return errors.New("private Steam request frame rejected")
	}
	clear(encoded)
	if e := j.Bundle.verify(j.Executable, j.RuntimeRoot); e != nil {
		return e
	}
	if e := verifyPrivateWorker(j.Executable, j.WorkerSHA256); e != nil {
		return e
	}
	ctx, cancel := context.WithTimeout(ctx, time.Duration(r.DeadlineSeconds)*time.Second)
	defer cancel()
	roots, e := j.Admission.Acquire(ctx, r)
	if e != nil {
		return e
	}
	defer roots.Release()
	send := func(t, stage string, raw json.RawMessage) error {
		return emit(steamapi.PrivateEvent{Version: steamapi.PrivateVersion, Type: t, Stage: stage, Receipt: raw})
	}
	var streamErr error
	p := PrivateContentProcess{Executable: j.Executable, RuntimeRoot: j.RuntimeRoot, Target: roots.Target, Work: roots.Work, Cache: roots.Cache, Validate: func(ctx context.Context, raw json.RawMessage) error {
		if e := r.CheckReceipt(raw); e != nil {
			return e
		}
		return validatePrivateProvider(roots.Work, raw)
	}, Progress: func(stage string) {
		if streamErr == nil {
			streamErr = send("progress", stage, nil)
			if streamErr != nil {
				cancel()
			}
		}
	}, Guard: func(ctx context.Context, c PrivateGuardChallenge) (PrivateGuardReply, error) {
		if guard == nil {
			return PrivateGuardReply{}, errors.New("private Steam Guard unavailable")
		}
		challenge := steamapi.PrivateChallenge{Job: r.Job, Nonce: r.Nonce, ChallengeID: c.ChallengeID, Kind: c.Kind}
		v, e := guard(ctx, challenge)
		if e != nil || v.PrivateChallenge != challenge {
			return PrivateGuardReply{}, errors.New("private Steam Guard rejected")
		}
		return PrivateGuardReply{ChallengeID: v.ChallengeID, Kind: v.Kind, Code: v.Code, Accepted: v.Accepted}, nil
	}}
	if r.Previous != nil {
		priorRaw, _ := json.Marshal(r.Previous)
		validation := frameRequest
		validation.Operation = "validate_private_receipt"
		validation.Username = ""
		validation.Password = ""
		validation.Guard = ""
		validation.BetaPassword = ""
		validation.Content = make(map[string]any, len(frameRequest.Content))
		for k, v := range frameRequest.Content {
			validation.Content[k] = v
		}
		delete(validation.Content, "previous")
		validation.Content["scope"] = r.Previous.Scope
		validation.Content["validation_receipt"] = r.Previous
		validation.Content["expected_publisher_plan"] = r.Previous.PublisherPlan
		if _, e := validatePrivatePrior(p, ctx, validation); e != nil {
			return errors.New("private Steam previous publication validation failed")
		}
		if e := validatePrivateProvider(roots.Work, priorRaw); e != nil {
			return e
		}
	}
	raw, e := p.Run(ctx, frameRequest)
	if streamErr != nil {
		return errors.New("private Steam stream disconnected")
	}
	if e != nil {
		return e
	}
	return send("result", "publication_validated", raw)
}
