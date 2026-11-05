//go:build linux

package steamexec

import (
	"context"
	"crypto/sha256"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
)

type clientAcceptanceDocker struct {
	mu   sync.Mutex
	runs []string
}

func (d *clientAcceptanceDocker) Run(ctx context.Context, args []string, out io.Writer) error {
	if args[0] != "run" {
		return (localDocker{}).Run(ctx, args, out)
	}
	captured := &cappedOutput{max: 256 << 10}
	err := (localDocker{}).Run(ctx, args, io.MultiWriter(out, captured))
	raw, _ := captured.text()
	d.mu.Lock()
	d.runs = append(d.runs, raw)
	d.mu.Unlock()
	return err
}

// Explicit opt-in, only a disposable volume mounted at its daemon host path.
// No server UUID, credentials, login or game content is accepted by this test.
func TestLiveAdminSteamCMDClient(t *testing.T) {
	if os.Getenv("VOLTRA_STEAM_CLIENT_ACCEPTANCE") != "1" {
		t.Skip("opt-in disposable native SteamCMD client acceptance")
	}
	journal := os.Getenv("VOLTRA_STEAM_CLIENT_TEST_JOURNAL")
	if !strings.HasPrefix(journal, "/var/lib/docker/volumes/voltra-steamcmd-acceptance-") || !strings.HasSuffix(journal, "/_data/journal") || filepath.Clean(journal) != journal {
		t.Fatal("requires an owned disposable Docker volume journal")
	}
	if _, err := os.Lstat(journal); !os.IsNotExist(err) {
		t.Fatal("acceptance journal must not already exist")
	}
	if err := os.Mkdir(journal, 0700); err != nil {
		t.Fatal(err)
	}
	identity := os.Getenv("VOLTRA_STEAM_CLIENT_TEST_ID")
	if !strings.HasPrefix(identity, "client-acceptance-") {
		t.Fatal("explicit owned helper identity required")
	}
	if _, err := uuid.Parse(strings.TrimPrefix(identity, "client-acceptance-")); err != nil {
		t.Fatal("invalid owned helper identity")
	}
	e := New()
	e.journal = journal
	e.clientMaintenanceTestID = identity
	d := &clientAcceptanceDocker{}
	e.docker = d
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	stop := e.StartClientMaintenance(ctx)
	defer stop()
	defer func() {
		if err := e.cleanup(e.clientMaintenanceTestID); err != nil {
			t.Error(err)
		}
	}()
	var firstHash [32]byte
	for run := 0; run < 2; run++ {
		started := time.Now()
		if err := e.RequestClientCheck(); err != nil {
			t.Fatal(err)
		}
		for e.ClientStatus().Busy {
			select {
			case <-ctx.Done():
				t.Fatal("acceptance timed out")
			case <-time.After(100 * time.Millisecond):
			}
		}
		s := e.ClientStatus()
		d.mu.Lock()
		raw := ""
		if len(d.runs) > 0 {
			raw = d.runs[len(d.runs)-1]
		}
		d.mu.Unlock()
		if s.LastError != "" || s.Version == "" || s.LastCheckedAt == nil {
			t.Fatalf("real client failed: %#v\n%s", s, raw)
		}
		downloads := strings.Count(strings.ToLower(raw), "downloading update")
		if run == 1 && downloads != 0 {
			t.Fatal("second check downloaded the client again")
		}
		client := filepath.Join(journal, "client-cache", "metadata", "steamcmd", "linux32", "steamcmd")
		binary, err := os.ReadFile(client)
		if err != nil {
			t.Fatal("updated client not retained", err)
		}
		hash := sha256.Sum256(binary)
		if run == 0 {
			firstHash = hash
		} else if hash != firstHash {
			t.Fatal("cached executable unexpectedly changed on second check")
		}
		again := New()
		again.journal = journal
		persisted := again.ClientStatus()
		if persisted.Version != s.Version || persisted.LastCheckedAt == nil || !persisted.LastCheckedAt.Equal(*s.LastCheckedAt) {
			t.Fatal("client result not persisted")
		}
		if run == 0 {
			if !persisted.ScheduleEnabled || persisted.NextCheckAt == nil {
				t.Fatal("daily schedule not persisted")
			}
			if err = e.SetClientSchedule(false); err != nil {
				t.Fatal(err)
			}
		} else if persisted.ScheduleEnabled || persisted.NextCheckAt != nil {
			t.Fatal("disabled schedule did not survive manual recheck")
		}
		t.Logf("run=%d version=%s elapsed=%s client_download_lines=%d executable_sha256=%s schedule_persisted=true", run+1, s.Version, time.Since(started).Round(time.Millisecond), downloads, fmt.Sprintf("%x", hash))
	}
}
