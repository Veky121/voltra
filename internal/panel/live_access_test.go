package panel

import (
	"context"
	"errors"
	"slices"
	"testing"
	"time"
)

func TestLiveSocketAccessCachesIdentityAndRechecksOnSignalOrAge(t *testing.T) {
	now := time.Unix(1000, 0)
	checks, user := 0, int64(7)
	var failure error
	access := newLiveSocketAccess(7, func() (int64, error) { checks++; return user, failure }, nil)
	access.now = func() time.Time { return now }
	access.checked = now
	for i := 0; i < 100; i++ {
		if !access.verify() {
			t.Fatal("cached identity rejected")
		}
	}
	if checks != 0 {
		t.Fatalf("identity checked per message: %d", checks)
	}
	// An access or settings change re-checks before the next send.
	access.changed()
	if !access.verify() || checks != 1 || !access.verify() || checks != 1 {
		t.Fatalf("change signal: %d checks", checks)
	}
	// Without a signal, no check is older than liveAuthTTL.
	now = now.Add(liveAuthTTL)
	if !access.verify() || checks != 2 {
		t.Fatalf("age bound: %d checks", checks)
	}
	// A revoked session or another account closes the socket.
	access.changed()
	failure = errors.New("revoked")
	if access.verify() {
		t.Fatal("revoked session accepted")
	}
	failure, user = nil, 8
	access.changed()
	if access.verify() {
		t.Fatal("different account accepted")
	}
}

func TestLiveSocketAccessScopesHintsToVisibleServers(t *testing.T) {
	now := time.Unix(1000, 0)
	lookups := 0
	table := map[int64]liveServerAccess{
		1: {allowed: true, aliases: []string{"uuid-1", "short-1"}},
		2: {allowed: false, aliases: []string{"uuid-2"}},
	}
	access := newLiveSocketAccess(7, func() (int64, error) { return 7, nil }, func(_ context.Context, user int64, ids []int64) (map[int64]liveServerAccess, error) {
		lookups++
		found := map[int64]liveServerAccess{}
		for _, id := range ids {
			if row, ok := table[id]; ok {
				found[id] = row
			}
		}
		return found, nil
	})
	access.now = func() time.Time { return now }
	ctx := context.Background()
	aliases, shown, err := access.visible(ctx, []int64{1, 2})
	if err != nil || !shown || !slices.Equal(aliases, []string{"uuid-1", "short-1"}) {
		t.Fatalf("visible: %v %v %v", aliases, shown, err)
	}
	// Another user's server alone: no hint at all.
	if _, shown, _ = access.visible(ctx, []int64{2}); shown {
		t.Fatal("hint for a server this user cannot see")
	}
	// Cached for liveAuthTTL: one lookup per server, not per hint.
	for i := 0; i < 50; i++ {
		_, _, _ = access.visible(ctx, []int64{1, 2})
	}
	if lookups != 1 {
		t.Fatalf("lookups: %d", lookups)
	}
	now = now.Add(liveAuthTTL)
	_, _, _ = access.visible(ctx, []int64{1})
	if lookups != 2 {
		t.Fatalf("stale cache reused: %d", lookups)
	}
	// Access removed: the change itself is still delivered once, then not again.
	table[1] = liveServerAccess{allowed: false, aliases: []string{"uuid-1", "short-1"}}
	access.changed()
	if aliases, shown, _ = access.visible(ctx, []int64{1}); !shown || len(aliases) != 2 {
		t.Fatalf("revocation hint lost: %v %v", aliases, shown)
	}
	access.settle()
	if _, shown, _ = access.visible(ctx, []int64{1}); shown {
		t.Fatal("hints continue after access was removed")
	}
	// A deleted server still refreshes lists, naming only what was known.
	table[3] = liveServerAccess{allowed: true, aliases: []string{"uuid-3"}}
	_, _, _ = access.visible(ctx, []int64{3})
	delete(table, 3)
	now = now.Add(liveAuthTTL)
	if aliases, shown, _ = access.visible(ctx, []int64{3}); !shown || !slices.Equal(aliases, []string{"uuid-3"}) {
		t.Fatalf("deleted server: %v %v", aliases, shown)
	}
	if aliases, shown, _ = access.visible(ctx, []int64{99}); !shown || len(aliases) != 0 {
		t.Fatalf("unknown deleted server: %v %v", aliases, shown)
	}
}

func TestLiveReadChangesKeepServerScope(t *testing.T) {
	h := &liveReadChanges{}
	ch, take, stop := h.subscribe()
	defer stop()
	h.publishScoped([]int64{1}, "backups")
	h.publishScoped([]int64{2}, "backups")
	h.publishScoped([]int64{3}, "files")
	h.publish("files")
	<-ch
	changes := map[string]liveReadChange{}
	for _, change := range take() {
		changes[change.domain] = change
	}
	backups := changes["backups"]
	slices.Sort(backups.servers)
	if backups.global || !slices.Equal(backups.servers, []int64{1, 2}) {
		t.Fatalf("backups: %+v", backups)
	}
	if files := changes["files"]; !files.global || len(files.servers) != 0 {
		t.Fatalf("an unscoped change must cover every server: %+v", files)
	}
	many := make([]int64, liveChangeServerLimit+1)
	for i := range many {
		many[i] = int64(i + 1)
	}
	h.publishScoped(many, "servers")
	<-ch
	if change := take()[0]; !change.global {
		t.Fatal("unbounded server list")
	}
}

func TestLiveOverviewResourcesUseFiveSecondCadence(t *testing.T) {
	a := &App{}
	overview, ok := a.liveTopic("/api/client/servers/a/resources?summary=overview")
	if !ok || overview.interval != liveOverviewResourceInterval || overview.event != "server.resources" {
		t.Fatalf("overview topic: %+v %v", overview, ok)
	}
	for _, path := range []string{"/api/client/servers/a/resources?summary=all", "/api/client/servers/a/backups?summary=overview", "/api/client/servers/a/resources?summary=overview&summary=overview"} {
		if _, ok := a.liveTopic(path); ok {
			t.Fatalf("accepted %s", path)
		}
	}
	page, _ := a.liveTopic("/api/client/servers/a/resources")
	w := &liveSnapshotWorker{topic: overview, bindings: map[*liveBinding]struct{}{{topic: overview}: {}}}
	if w.sampleInterval() != liveOverviewResourceInterval {
		t.Fatal("overview-only viewers sampled every second")
	}
	w.bindings[&liveBinding{topic: page}] = struct{}{}
	if w.sampleInterval() != time.Second {
		t.Fatal("server page lost its one-second sample")
	}
}
