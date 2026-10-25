//go:build linux

package steamexec

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
	"voltra/internal/steamapi"
)

type privateRecoveryDeadlineAdmissionFixture struct{ inspect func(context.Context) }

func (a privateRecoveryDeadlineAdmissionFixture) AcquireRecovery(ctx context.Context, _ steamapi.PrivateRequest) (*PrivateRoots, error) {
	a.inspect(ctx)
	return nil, errors.New("fixture stops before worker")
}
func TestPrivateRecoveryJobAdmissionReceivesOriginalDeadline(t *testing.T) {
	for _, shorter := range []bool{false, true} {
		t.Run(map[bool]string{false: "original7200", true: "caller"}[shorter], func(t *testing.T) {
			root := t.TempDir()
			workerRoot, runtimeRoot := filepath.Join(root, "worker"), filepath.Join(root, "runtime")
			os.Mkdir(workerRoot, 0700)
			os.Mkdir(runtimeRoot, 0700)
			executable := filepath.Join(workerRoot, "worker")
			payload := []byte("#!/bin/sh\nexit 1\n")
			os.WriteFile(executable, payload, 0700)
			os.WriteFile(filepath.Join(runtimeRoot, "dotnet"), payload, 0700)
			sum := sha256.Sum256(payload)
			hash := hex.EncodeToString(sum[:])
			bundle := &PrivateWorkerBundle{Provider: steamapi.PrivateProvider, Root: workerRoot, RuntimeRoot: runtimeRoot, Files: map[string]string{"worker": hash}, RuntimeFiles: map[string]string{"dotnet": hash}}
			var got time.Time
			j := &PrivateRecoveryJobRunner{PrivateJobRunner: &PrivateJobRunner{Executable: executable, RuntimeRoot: runtimeRoot, WorkerSHA256: hash, Provider: steamapi.PrivateProvider, Bundle: bundle}, RecoveryAdmission: privateRecoveryDeadlineAdmissionFixture{func(ctx context.Context) { got, _ = ctx.Deadline() }}, Approval: PrivateRecoveryWorkerApproval{ABI: steamapi.PrivateRecoveryABI, ManifestSHA256: strings.Repeat("a", 64), EntrypointSHA256: hash}}
			v := privateRecoveryDeadlineRequest(t, 7200)
			parent := context.Background()
			want := time.Time{}
			if shorter {
				var cancel context.CancelFunc
				want = time.Now().Add(time.Second)
				parent, cancel = context.WithDeadline(parent, want)
				defer cancel()
			}
			start := time.Now()
			if e := j.Recover(parent, v, func(steamapi.PrivateEvent) error { return nil }); e == nil {
				t.Fatal("fixture unexpectedly ran worker")
			}
			end := time.Now()
			if got.IsZero() {
				t.Fatal("admission did not receive context")
			}
			if shorter {
				if !got.Equal(want) {
					t.Fatal("caller bound ignored")
				}
			} else if got.Before(start.Add(2*time.Hour)) || got.After(end.Add(2*time.Hour)) {
				t.Fatal("job runner still capped recovery", got.Sub(start))
			}
		})
	}
}
