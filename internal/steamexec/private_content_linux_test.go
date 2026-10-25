//go:build linux

package steamexec

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"
)

// Actual subprocess fixture exercises inherited descriptors and framing only.
// It never authenticates, acquires content, or emits publication success.
func init() {
	if len(os.Args) == 2 && os.Args[1] == "--private-fixture-descendant" {
		signal.Ignore(syscall.SIGTERM)
		time.Sleep(30 * time.Second)
		os.Exit(0)
	}
	if len(os.Args) != 7 || os.Args[1] != "--request-fd" || !strings.HasSuffix(os.Args[0], ".test") {
		return
	}
	req := os.NewFile(3, "request")
	events := os.NewFile(4, "events")
	replies := os.NewFile(5, "replies")
	var input PrivateContentRequest
	if privateReadFrame(req, &input) != nil {
		os.Exit(7)
	}
	switch input.Content["fixture"] {
	case "grandchild":
		child := exec.Command(os.Args[0], "--private-fixture-descendant")
		if child.Start() != nil {
			os.Exit(10)
		}
		_ = os.WriteFile(input.Content["pid_path"].(string), []byte(strconv.Itoa(child.Process.Pid)), 0600)
		time.Sleep(30 * time.Second)
	case "guard":
		id := strings.Repeat("a", 32)
		_ = privateWriteFrame(events, PrivateGuardChallenge{"guard_required", id, "device_code"})
		var reply PrivateGuardReply
		if privateReadFrame(replies, &reply) != nil || reply.Code == nil || *reply.Code != "fixture-code" {
			os.Exit(8)
		}
	case "stall":
		time.Sleep(30 * time.Second)
	case "malformed":
		_, _ = events.Write([]byte{255, 255, 255, 255})
		os.Exit(9)
	}
	_ = privateWriteFrame(events, PrivateContentEvent{Type: "terminal", Status: "error", Code: "fixture_offline_denied"})
	os.Exit(3)
}

func TestPrivateContentProcessBoundary(t *testing.T) {
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	roots := []*os.File{}
	for i := 0; i < 3; i++ {
		f, e := os.Open(t.TempDir())
		if e != nil {
			t.Fatal(e)
		}
		defer f.Close()
		roots = append(roots, f)
	}
	for _, mode := range []string{"guard", "malformed", "stall", "blocked_guard", "grandchild"} {
		t.Run(mode, func(t *testing.T) {
			validated := false
			guarded := false
			p := PrivateContentProcess{Executable: executable, Target: roots[0], Work: roots[1], Cache: roots[2], Validate: func(context.Context, json.RawMessage) error { validated = true; return nil }, Guard: func(ctx context.Context, c PrivateGuardChallenge) (PrivateGuardReply, error) {
				guarded = true
				code := "fixture-code"
				return PrivateGuardReply{ChallengeID: c.ChallengeID, Kind: c.Kind, Code: &code}, nil
			}}
			blocked := make(chan struct{})
			defer close(blocked)
			if mode == "blocked_guard" {
				p.Guard = func(context.Context, PrivateGuardChallenge) (PrivateGuardReply, error) {
					<-blocked
					return PrivateGuardReply{}, nil
				}
			}
			fixture := mode
			if mode == "blocked_guard" {
				fixture = "guard"
			}
			pidPath := filepath.Join(t.TempDir(), "descendant.pid")
			ctx, cancel := context.WithTimeout(context.Background(), 250*time.Millisecond)
			defer cancel()
			_, e := p.Run(ctx, PrivateContentRequest{Operation: "private_content", ParentFieldsValidated: true, Content: map[string]any{"fixture": fixture, "pid_path": pidPath}})
			if e == nil || validated {
				t.Fatal("offline fixture accepted publication")
			}
			if mode == "guard" && (!guarded || e.Error() != "private Steam worker: fixture_offline_denied") {
				t.Fatalf("Guard boundary failed: %v", e)
			}
			if mode == "stall" && ctx.Err() == nil {
				t.Fatal("cancellation not propagated")
			}
			if mode == "blocked_guard" && ctx.Err() == nil {
				t.Fatal("ignored Guard context blocked Run")
			}
			if mode == "grandchild" {
				data, err := os.ReadFile(pidPath)
				if err != nil {
					t.Fatal(err)
				}
				pid, err := strconv.Atoi(string(data))
				if err != nil {
					t.Fatal(err)
				}
				time.Sleep(400 * time.Millisecond)
				state, err := os.ReadFile(filepath.Join("/proc", strconv.Itoa(pid), "stat"))
				if err == nil && !strings.Contains(string(state), ") Z ") {
					t.Fatal("descendant survived process group cancellation")
				}
			}
		})
	}
}

// Root supplies a frozen actual worker apphost/wrapper. Invalid scope must fail
// before SteamClient/session construction; no credentials or network are used.
func TestPrivateContentActualWorkerOfflineRejection(t *testing.T) {
	path := os.Getenv("PRIVATE_STEAM_WORKER_EXECUTABLE")
	if path == "" {
		t.Skip("actual worker executable not supplied")
	}
	roots := make([]*os.File, 3)
	for i := range roots {
		f, err := os.Open(t.TempDir())
		if err != nil {
			t.Fatal(err)
		}
		defer f.Close()
		roots[i] = f
	}
	p := PrivateContentProcess{Executable: path, RuntimeRoot: os.Getenv("PRIVATE_STEAM_WORKER_RUNTIME_ROOT"), Target: roots[0], Work: roots[1], Cache: roots[2]}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_, err := p.Run(ctx, PrivateContentRequest{Operation: "private_content", AppID: 42, Branch: "public", ParentFieldsValidated: true, Content: map[string]any{
		"scope":    map[string]string{"server": "invalid", "owner": "invalid", "job": "invalid", "nonce": "invalid", "request_digest": "invalid"},
		"platform": "linux", "architecture": "64", "language": "english", "dlc_apps": []uint32{}, "protected_roots": []string{}, "content_budget": "1024", "rollback_reserve": "1024", "cache_quota": "1024", "deadline_seconds": 10,
	}})
	if err == nil || err.Error() != "private Steam worker: invalid_publication_scope" {
		t.Fatalf("actual worker did not reject scope before session: %v", err)
	}
}
