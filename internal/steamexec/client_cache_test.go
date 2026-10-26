package steamexec

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSteamClientCachePersistsAndSeparatesMetadataFromGameOwner(t *testing.T) {
	e, d := fixture(t)
	r := req("check")
	first, release, err := e.clientCache(context.Background(), r, 0, 0, false)
	if err != nil {
		t.Fatal(err)
	}
	marker := filepath.Join(first, "client-version")
	if err = os.WriteFile(marker, []byte("up-to-date"), 0600); err != nil {
		t.Fatal(err)
	}
	release()
	second, release, err := e.clientCache(context.Background(), r, 0, 0, false)
	if err != nil {
		t.Fatal(err)
	}
	release()
	if first != second {
		t.Fatal("metadata cache changes between checks")
	}
	if raw, err := os.ReadFile(marker); err != nil || string(raw) != "up-to-date" {
		t.Fatal("client update discarded", err)
	}
	game, release, err := e.clientCache(context.Background(), r, 1000, 1000, true)
	if err != nil {
		t.Fatal(err)
	}
	release()
	if game == first || strings.HasPrefix(game, d.dir) {
		t.Fatal("unsafe game/cache scope")
	}
	other := r
	other.ServerUUID = "33333333-3333-3333-3333-333333333333"
	otherCache, release, err := e.clientCache(context.Background(), other, 1000, 1000, true)
	if err != nil {
		t.Fatal(err)
	}
	release()
	if otherCache == game {
		t.Fatal("different servers share writable executable cache")
	}
	differentOwner, release, err := e.clientCache(context.Background(), r, 1001, 1001, true)
	if err != nil {
		t.Fatal(err)
	}
	release()
	if differentOwner == game {
		t.Fatal("changed owner inherits old executable cache")
	}
}

func TestSteamClientCacheMountNeverExposesGameDataToChecks(t *testing.T) {
	e, d := fixture(t)
	if result := terminal(t, execute(e, req("check"))); result.Type != "result" {
		t.Fatal(result)
	}
	for _, args := range d.snapshot() {
		if args[0] != "run" {
			continue
		}
		mounts := []string{}
		for i, arg := range args {
			if arg == "--mount" {
				mounts = append(mounts, args[i+1])
			}
		}
		if len(mounts) != 1 || !strings.HasSuffix(mounts[0], "client-cache"+string(filepath.Separator)+"metadata,dst=/tmp/.local/share/Steam") {
			t.Fatal("unexpected check mounts", mounts)
		}
		if contains(args, "+app_update") || contains(args, "+force_install_dir") {
			t.Fatal("check gained game mutation", args)
		}
	}
}

func TestSteamClientCacheRejectsTraversalAndSymlinks(t *testing.T) {
	e, _ := fixture(t)
	r := req("check")
	r.ServerUUID = "../../escape"
	if _, release, err := e.clientCache(context.Background(), r, 0, 0, false); err == nil {
		release()
		t.Fatal("unsafe scope accepted")
	}
	base := filepath.Join(e.journal, "client-cache")
	if err := os.MkdirAll(base, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(t.TempDir(), filepath.Join(base, "metadata")); err != nil {
		t.Skip("symlinks unavailable", err)
	}
	if _, release, err := e.clientCache(context.Background(), req("check"), 0, 0, false); err == nil {
		release()
		t.Fatal("symlink cache accepted")
	}
}
