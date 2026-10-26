//go:build linux

package steamexec

import (
	"context"
	"path/filepath"
	"testing"
	"time"
)

func TestSteamClientCacheLockWaitsAndHonorsCancellation(t *testing.T) {
	path := filepath.Join(t.TempDir(), "client.lock")
	release, err := lockClientCache(context.Background(), path)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 70*time.Millisecond)
	defer cancel()
	if unlock, err := lockClientCache(ctx, path); err == nil {
		unlock()
		t.Fatal("overlapping self-update allowed")
	}
	release()
	unlock, err := lockClientCache(context.Background(), path)
	if err != nil {
		t.Fatal(err)
	}
	unlock()
}
