//go:build linux

package steamexec

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"voltra/internal/steamapi"
)

func recoveryJobOriginal() steamapi.PrivateRequest {
	r := privateJobRequest()
	r.Username = ""
	r.Password = ""
	return r
}
func TestPrivateRecoveryAdmissionPreservesMarkersAndOwnership(t *testing.T) {
	a, s := privateJobDirectories(t)
	r := privateJobRequest()
	roots, e := a.Acquire(context.Background(), r)
	if e != nil {
		t.Fatal(e)
	}
	roots.Release()
	r = recoveryJobOriginal()
	marker := filepath.Join(s.Work, "admission-"+r.Scope().Job+".json")
	before, _ := os.ReadFile(marker)
	if os.Geteuid() == 0 {
		if e := os.Chown(s.Target, 988, 988); e != nil {
			t.Fatal(e)
		}
	}
	prefix := filepath.Join(s.Work, r.Scope().Server, r.Scope().Owner, r.Nonce)
	os.MkdirAll(prefix, 0700)
	os.WriteFile(filepath.Join(prefix, "admission.json"), []byte("original private marker"), 0600)
	for n := 0; n < 2; n++ {
		roots, e := a.AcquireRecovery(context.Background(), r)
		if e != nil {
			t.Fatal(e)
		}
		if _, e := a.AcquireRecovery(context.Background(), r); e == nil {
			t.Fatal("concurrent Work lock ignored")
		}
		roots.Release()
	}
	after, _ := os.ReadFile(marker)
	if string(before) != string(after) {
		t.Fatal("original Go admission changed")
	}
	if _, e := a.Acquire(context.Background(), r); e == nil {
		t.Fatal("recovery reopened run replay")
	}
	b, _ := os.ReadFile(filepath.Join(prefix, "admission.json"))
	if string(b) != "original private marker" {
		t.Fatal("worker marker changed")
	}
	entries, _ := os.ReadDir(s.Target)
	if len(entries) != 0 {
		t.Fatal("recovery touched target")
	}
	entries, _ = os.ReadDir(s.Cache)
	if len(entries) != 0 {
		t.Fatal("recovery touched cache")
	}
	if e := os.Chmod(s.Cache, 0755); e != nil {
		t.Fatal(e)
	}
	if _, e := a.AcquireRecovery(context.Background(), r); e == nil {
		t.Fatal("non-private cache admitted")
	}
}
func TestPrivateRecoveryExistingLifecycleLockAndStoppedState(t *testing.T) {
	storage, s := privateJobDirectories(t)
	r := privateJobRequest()
	e := New()
	e.journal = t.TempDir()
	e.wingsConfig = filepath.Join(t.TempDir(), "absent")
	docker := &fakeDocker{dir: s.Target}
	e.docker = docker
	a := &PrivateExecutorAdmission{e, storage}
	roots, err := a.Acquire(context.Background(), r)
	if err != nil {
		t.Fatal(err)
	}
	roots.Release()
	r = recoveryJobOriginal()
	roots, err = a.AcquireRecovery(context.Background(), r)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := e.reserveMaintenance(r.Server); err == nil {
		t.Fatal("recovery ignored shared reservation")
	}
	roots.Release()
	lock := filepath.Join(e.journal, r.Server+".lock")
	os.Remove(lock)
	if _, err := a.AcquireRecovery(context.Background(), r); err == nil {
		t.Fatal("missing lock accepted")
	}
	if _, err := os.Stat(lock); !os.IsNotExist(err) {
		t.Fatal("lock recreated")
	}
	os.WriteFile(lock, nil, 0600)
	for _, kind := range []string{"running", "installer"} {
		docker.running = kind == "running"
		docker.installerActive = kind == "installer"
		if _, err := a.AcquireRecovery(context.Background(), r); err == nil {
			t.Fatal(kind + " admitted")
		}
	}
}

// Separate copied test executable avoids the older publish fixture's init hook.
func init() {
	if !strings.HasSuffix(os.Args[0], "private-recovery-fixture") || len(os.Args) != 7 {
		return
	}
	var r PrivateContentRequest
	if privateReadFrame(os.NewFile(3, "request"), &r) != nil {
		os.Exit(10)
	}
	out := os.NewFile(4, "events")
	mode, _ := r.Content["recovery_fixture"].(string)
	if r.Username != "" || r.Password != "" || r.Guard != "" || r.BetaPassword != "" {
		os.Exit(12)
	}
	if mode == "guard" {
		privateWriteFrame(out, PrivateGuardChallenge{Type: "guard_required", ChallengeID: strings.Repeat("a", 32), Kind: "device_code"})
		os.Exit(0)
	}
	marker, _ := r.Content["fixture_operations"].(string)
	f, e := os.OpenFile(marker, os.O_APPEND|os.O_WRONLY, 0600)
	if e != nil {
		os.Exit(13)
	}
	f.WriteString(r.Operation + "\n")
	f.Close()
	ref := json.RawMessage(`{"fixture_provider":"mechanical-process-only","publisher_plan":{"app":42,"build":"1","depots":[{"publisher_app":42,"depot":43,"manifest":"1"}]}}`)
	status := "receipt_recovered"
	if r.Operation == "validate_private_receipt" {
		status = "receipt_validated"
		if _, ok := r.Content["previous"]; ok {
			os.Exit(14)
		}
		if mode == "substitution" {
			ref = json.RawMessage(`{"publisher_plan":{"app":43}}`)
		}
		if mode == "validator-error" {
			privateWriteFrame(out, PrivateContentEvent{Type: "terminal", Status: "error", Code: "fixture_rejected"})
			os.Exit(3)
		}
	}
	if mode == "wrong-status" {
		status = "publication_committed"
	}
	native := false
	privateWriteFrame(out, PrivateContentEvent{Type: "terminal", Status: status, Receipt: ref, NativeAcceptanceVerified: &native})
	os.Exit(0)
}
func TestPrivateRecoveryIndependentProcessProtocol(t *testing.T) {
	binary, e := os.ReadFile(os.Args[0])
	if e != nil {
		t.Fatal(e)
	}
	executable := filepath.Join(t.TempDir(), "private-recovery-fixture")
	if e := os.WriteFile(executable, binary, 0700); e != nil {
		t.Fatal(e)
	}
	for _, mode := range []string{"ok", "guard", "substitution", "validator-error", "wrong-status"} {
		t.Run(mode, func(t *testing.T) {
			roots := []*os.File{}
			for n := 0; n < 3; n++ {
				f, e := os.Open(t.TempDir())
				if e != nil {
					t.Fatal(e)
				}
				defer f.Close()
				roots = append(roots, f)
			}
			marker := filepath.Join(t.TempDir(), "ops")
			os.WriteFile(marker, nil, 0600)
			validated := false
			guarded := false
			p := PrivateContentProcess{Executable: executable, Target: roots[0], Work: roots[1], Cache: roots[2], Guard: func(context.Context, PrivateGuardChallenge) (PrivateGuardReply, error) {
				guarded = true
				return PrivateGuardReply{}, nil
			}, Validate: func(context.Context, json.RawMessage) error { validated = true; return nil }}
			_, err := recoverPrivateProcess(p, context.Background(), PrivateContentRequest{Operation: "recover_private_receipt", ParentFieldsValidated: true, Content: map[string]any{"recovery_fixture": mode, "fixture_operations": marker, "previous": "original previous digest remains in explicit Scope", "scope": "original scope"}})
			ops, _ := os.ReadFile(marker)
			if mode == "ok" {
				if err != nil || !validated || string(ops) != "recover_private_receipt\nvalidate_private_receipt\n" {
					t.Fatal("independent processes not proven", err, string(ops))
				}
			} else if err == nil || validated {
				t.Fatal("invalid recovery accepted", mode)
			}
			if guarded {
				t.Fatal("recovery called Guard")
			}
		})
	}
}
