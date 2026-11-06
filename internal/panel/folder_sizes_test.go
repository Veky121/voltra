package panel

import (
	"context"
	"errors"
	"reflect"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func sizeFile(name string, size int64) folderSizeFile {
	return folderSizeFile{Name: name, File: true, Size: &size}
}

func TestFolderSizeTraversal(t *testing.T) {
	tree := map[string][]folderSizeFile{
		"/mods":             {sizeFile("first", 10), {Name: "nested"}, {Name: "empty"}, {Name: "outside", Symlink: true}},
		"/mods/nested":      {sizeFile("second", 20), {Name: "deep"}},
		"/mods/nested/deep": {sizeFile("third", 30)}, "/mods/empty": {},
	}
	totals, err := scanFolderSizes(context.Background(), "/mods", func(_ context.Context, directory string) ([]folderSizeFile, error) {
		files, ok := tree[directory]
		if !ok {
			t.Fatalf("Unexpected path: %s", directory)
		}
		return files, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(totals, map[string]int64{"/mods": 60, "/mods/nested": 50, "/mods/nested/deep": 30, "/mods/empty": 0}) {
		t.Fatal(totals)
	}
	for _, invalid := range []folderSizeFile{{Name: "../outside"}, {Name: "missing-size", File: true}, sizeFile("negative", -1)} {
		_, err := scanFolderSizes(context.Background(), "/mods", func(context.Context, string) ([]folderSizeFile, error) { return []folderSizeFile{invalid}, nil })
		if err == nil {
			t.Fatalf("Accepted invalid entry: %#v", invalid)
		}
	}
	_, err = scanFolderSizes(context.Background(), "/mods", func(context.Context, string) ([]folderSizeFile, error) { return nil, errors.New("denied") })
	if err == nil {
		t.Fatal("Listing failure must not produce a partial total")
	}
}

func TestFolderSizeCacheSharedAndScoped(t *testing.T) {
	var c folderSizeCache
	var calls atomic.Int32
	started, release := make(chan struct{}), make(chan struct{})
	load := func(context.Context) (map[string]int64, error) {
		if calls.Add(1) == 1 {
			close(started)
		}
		<-release
		return map[string]int64{"/mods": 60, "/mods/nested": 50}, nil
	}
	var wg sync.WaitGroup
	for range 8 {
		wg.Go(func() {
			size, _, err := c.get(context.Background(), folderSizeKey{"server-a", "/mods"}, load)
			if err != nil || size != 60 {
				t.Errorf("size=%d err=%v", size, err)
			}
		})
	}
	<-started
	close(release)
	wg.Wait()
	if calls.Load() != 1 {
		t.Fatalf("Duplicate scans: %d", calls.Load())
	}
	never := func(context.Context) (map[string]int64, error) {
		t.Error("Cached descendant was rescanned")
		return nil, errors.New("unexpected")
	}
	if size, _, err := c.get(context.Background(), folderSizeKey{"server-a", "/mods/nested"}, never); size != 50 || err != nil {
		t.Fatal(size, err)
	}
	_, _, _ = c.get(context.Background(), folderSizeKey{"server-b", "/mods"}, load)
	if calls.Load() != 2 {
		t.Fatal("Different servers shared data")
	}
	c.invalidate("server-a")
	_, _, _ = c.get(context.Background(), folderSizeKey{"server-a", "/mods"}, load)
	if calls.Load() != 3 {
		t.Fatal("Mutation did not invalidate cache")
	}
	c.mu.Lock()
	c.entries[folderSizeKey{"server-a", "/mods"}].updated = time.Now().Add(-2 * folderSizeTTL)
	c.mu.Unlock()
	_, _, _ = c.get(context.Background(), folderSizeKey{"server-a", "/mods"}, load)
	if calls.Load() != 4 {
		t.Fatal("Expired size was not refreshed")
	}
}

func TestFolderSizeCacheFailureCancellationAndInvalidation(t *testing.T) {
	var c folderSizeCache
	key := folderSizeKey{"server", "/world"}
	failed := func(context.Context) (map[string]int64, error) { return nil, errors.New("denied") }
	if _, _, err := c.get(context.Background(), key, failed); err == nil {
		t.Fatal("Failure became a size")
	}
	c.mu.Lock()
	cached := c.entries[key]
	c.mu.Unlock()
	if cached != nil {
		t.Fatal("Failure was cached")
	}
	started, release, done := make(chan struct{}), make(chan struct{}), make(chan struct{})
	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		defer close(done)
		_, _, err := c.get(ctx, key, func(context.Context) (map[string]int64, error) {
			close(started)
			<-release
			return map[string]int64{"/world": 10}, nil
		})
		if !errors.Is(err, context.Canceled) {
			t.Errorf("Cancellation: %v", err)
		}
	}()
	<-started
	cancel()
	<-done
	c.mu.Lock()
	pending := c.entries[key]
	c.mu.Unlock()
	c.invalidate("server")
	close(release)
	<-pending.done
	// Waiting for the bounded shared scan to finish must not repopulate invalidated data.
	c.mu.Lock()
	cached = c.entries[key]
	c.mu.Unlock()
	if cached != nil {
		t.Fatal("Invalidated cache entry survived")
	}
}

func TestFolderSizeEndpointUsesFileReadPermissionAndInvalidatesAfterWrite(t *testing.T) {
	f := operationsFixtureNew(t)
	attrs := asMap(operationsExpect(t, f.request("GET", f.serverPath("/files/folder-size?directory=%2Fconfig"), nil, f.sub), 200)["attributes"])
	if num(attrs["size"]) != 4 || num(attrs["cache_seconds"]) != 60 {
		t.Fatal(attrs)
	}
	f.mu.Lock()
	before := len(f.calls)
	f.mu.Unlock()
	operationsExpect(t, f.request("GET", f.serverPath("/files/folder-size?directory=%2Fconfig"), nil, f.owner), 200)
	f.mu.Lock()
	after := len(f.calls)
	f.mu.Unlock()
	if before != after {
		t.Fatal("Second client did not use shared server cache")
	}
	operationsExpect(t, f.request("POST", f.serverPath("/files/write?file=config.txt"), "changed", f.owner), 204)
	f.mu.Lock()
	before = len(f.calls)
	f.mu.Unlock()
	operationsExpect(t, f.request("GET", f.serverPath("/files/folder-size?directory=%2Fconfig"), nil, f.owner), 200)
	f.mu.Lock()
	after = len(f.calls)
	f.mu.Unlock()
	if after != before+1 {
		t.Fatal("Write did not invalidate folder size")
	}
	if err := f.a.exec(context.Background(), "UPDATE subusers SET permissions='[]'::jsonb WHERE server_id=$1 AND user_id=$2", num(f.server["id"]), num(f.sub["id"])); err != nil {
		t.Fatal(err)
	}
	operationsExpect(t, f.request("GET", f.serverPath("/files/folder-size?directory=%2Fconfig"), nil, f.sub), 403)
}
