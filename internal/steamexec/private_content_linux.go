//go:build linux

package steamexec

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"syscall"
	"time"
)

var privateSafeCode = regexp.MustCompile(`^[a-z][a-z0-9_]{0,63}$`)

func (p PrivateContentProcess) Run(ctx context.Context, request PrivateContentRequest) (json.RawMessage, error) {
	if request.Operation != "private_content" {
		return nil, errPrivateProtocol
	}
	return p.run(ctx, request, false)
}

func (p PrivateContentProcess) run(ctx context.Context, request PrivateContentRequest, validating bool) (json.RawMessage, error) {
	operation := "private_content"
	if validating {
		operation = "validate_private_receipt"
	}
	return p.runOperation(ctx, request, operation)
}
func (p PrivateContentProcess) runOperation(ctx context.Context, request PrivateContentRequest, operation string) (json.RawMessage, error) {
	validating := operation == "validate_private_receipt"
	recovering := operation == "recover_private_receipt"
	if request.Operation != operation || (operation != "private_content" && !validating && !recovering) {
		return nil, errPrivateProtocol
	}
	if (validating || recovering) && (request.Username != "" || request.Password != "" || request.Guard != "" || request.BetaPassword != "") {
		return nil, errPrivateProtocol
	}
	if p.Executable == "" || !request.ParentFieldsValidated || request.Content == nil {
		return nil, errPrivateProtocol
	}
	for _, f := range []*os.File{p.Target, p.Work, p.Cache} {
		if f == nil {
			return nil, errPrivateProtocol
		}
		s, e := f.Stat()
		if e != nil || !s.IsDir() {
			return nil, errPrivateProtocol
		}
	}
	// Clone caller's map before assigning child descriptor numbers.
	content := make(map[string]any, len(request.Content))
	for k, v := range request.Content {
		content[k] = v
	}
	request.Content = content
	content["target_fd"] = 6
	content["work_fd"] = 7
	content["cache_fd"] = 8
	reqR, reqW, e := os.Pipe()
	if e != nil {
		return nil, errPrivateProtocol
	}
	defer reqR.Close()
	defer reqW.Close()
	evR, evW, e := os.Pipe()
	if e != nil {
		return nil, errPrivateProtocol
	}
	defer evR.Close()
	defer evW.Close()
	replyR, replyW, e := os.Pipe()
	if e != nil {
		return nil, errPrivateProtocol
	}
	defer replyR.Close()
	defer replyW.Close()
	childCtx, cancel := context.WithTimeout(ctx, 2*time.Hour)
	defer cancel()
	cmd := exec.CommandContext(childCtx, p.Executable, "--request-fd", "3", "--event-fd", "4", "--reply-fd", "5")
	cmd.Env = []string{"LANG=C.UTF-8"}
	if p.RuntimeRoot != "" {
		if !filepath.IsAbs(p.RuntimeRoot) || filepath.Clean(p.RuntimeRoot) != p.RuntimeRoot {
			return nil, errPrivateProtocol
		}
		info, err := os.Lstat(p.RuntimeRoot)
		if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return nil, errPrivateProtocol
		}
		cmd.Env = append(cmd.Env, "DOTNET_ROOT="+p.RuntimeRoot)
	}
	cmd.Env = append(cmd.Env, "DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1", "DOTNET_EnableDiagnostics=0")
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Stdout = io.Discard
	cmd.Stderr = io.Discard
	cmd.ExtraFiles = []*os.File{reqR, evW, replyR, p.Target, p.Work, p.Cache}
	cmd.Cancel = func() error {
		pid := cmd.Process.Pid
		err := syscall.Kill(-pid, syscall.SIGTERM)
		// The group remains owned even if its original leader exits first.
		time.AfterFunc(250*time.Millisecond, func() { _ = syscall.Kill(-pid, syscall.SIGKILL) })
		return err
	}
	cmd.WaitDelay = 2 * time.Second
	if cmd.Start() != nil {
		return nil, errors.New("private Steam worker could not start")
	}
	if p.Progress != nil {
		if validating {
			p.Progress("validating_receipt")
		} else if recovering {
			p.Progress("recovering_receipt")
		} else {
			p.Progress("worker_started")
		}
	}
	reqR.Close()
	evW.Close()
	replyR.Close()
	waited := false
	defer func() {
		if !waited {
			cancel()
			_ = cmd.Wait()
		}
	}()
	// Cancellation also unblocks a parent waiting on an incomplete frame.
	finished := make(chan struct{})
	defer close(finished)
	go func() {
		select {
		case <-childCtx.Done():
			reqW.Close()
			evR.Close()
			replyW.Close()
		case <-finished:
		}
	}()
	if privateWriteFrame(reqW, request) != nil {
		return nil, errPrivateProtocol
	}
	reqW.Close()
	kinds := map[string]bool{}
	for count := 0; count < 1024; count++ {
		var event PrivateContentEvent
		if privateReadFrame(evR, &event) != nil {
			if childCtx.Err() != nil {
				return nil, childCtx.Err()
			}
			return nil, errPrivateProtocol
		}
		if event.Type == "guard_required" {
			if validating || recovering {
				return nil, errPrivateProtocol
			}
			if p.Progress != nil {
				p.Progress("guard_required")
			}
			if p.Guard == nil || kinds[event.Kind] || len(event.ChallengeID) != 32 || (event.Kind != "device_code" && event.Kind != "email_code" && event.Kind != "device_confirmation") {
				return nil, errPrivateProtocol
			}
			kinds[event.Kind] = true
			deadline, stop := context.WithTimeout(childCtx, 20*time.Second)
			type guardResult struct {
				reply PrivateGuardReply
				err   error
			}
			result := make(chan guardResult, 1)
			go func() {
				reply, err := p.Guard(deadline, PrivateGuardChallenge{event.Type, event.ChallengeID, event.Kind})
				result <- guardResult{reply, err}
			}()
			var reply PrivateGuardReply
			var err error
			select {
			case value := <-result:
				reply, err = value.reply, value.err
			case <-deadline.Done():
				err = deadline.Err()
			}
			stop()
			if err != nil {
				return nil, errors.New("private Steam Guard response unavailable")
			}
			if reply.ChallengeID != event.ChallengeID || reply.Kind != event.Kind || (event.Kind == "device_confirmation" && (reply.Accepted == nil || reply.Code != nil)) || (event.Kind != "device_confirmation" && (reply.Code == nil || reply.Accepted != nil)) {
				return nil, errPrivateProtocol
			}
			if privateWriteFrame(replyW, reply) != nil {
				return nil, errPrivateProtocol
			}
			continue
		}
		if event.Type != "terminal" {
			return nil, errPrivateProtocol
		}
		exit := cmd.Wait()
		waited = true
		if childCtx.Err() != nil {
			return nil, childCtx.Err()
		}
		if event.Status == "error" && privateSafeCode.MatchString(event.Code) {
			return nil, errors.New("private Steam worker: " + event.Code)
		}
		expectedStatus := "publication_committed"
		if recovering {
			expectedStatus = "receipt_recovered"
		}
		if validating {
			expectedStatus = "receipt_validated"
		}
		if exit != nil || event.Status != expectedStatus || (event.NativeAcceptanceVerified == nil || *event.NativeAcceptanceVerified) || len(event.Receipt) == 0 {
			return nil, errPrivateProtocol
		}
		if validating {
			return event.Receipt, nil
		}
		validation := request
		validation.Operation = "validate_private_receipt"
		validation.Username = ""
		validation.Password = ""
		validation.Guard = ""
		validation.BetaPassword = ""
		validation.Content = make(map[string]any, len(content))
		for k, v := range content {
			validation.Content[k] = v
		}
		delete(validation.Content, "previous")
		var reference struct {
			PublisherPlan json.RawMessage `json:"publisher_plan"`
		}
		if json.Unmarshal(event.Receipt, &reference) != nil || len(reference.PublisherPlan) == 0 || string(reference.PublisherPlan) == "null" {
			return nil, errPrivateProtocol
		}
		validation.Content["validation_receipt"] = event.Receipt
		validation.Content["expected_publisher_plan"] = reference.PublisherPlan
		validated, err := p.run(ctx, validation, true)
		if err != nil || (recovering && !bytes.Equal(bytes.TrimSpace(validated), bytes.TrimSpace(event.Receipt))) {
			return nil, errors.New("private Steam publication validation failed")
		}
		if p.Validate != nil && p.Validate(ctx, event.Receipt) != nil {
			return nil, errors.New("private Steam publication validation failed")
		}
		if p.Progress != nil {
			if recovering {
				p.Progress("receipt_recovered")
			} else {
				p.Progress("publication_validated")
			}
		}
		return event.Receipt, nil
	}
	return nil, errPrivateProtocol
}
