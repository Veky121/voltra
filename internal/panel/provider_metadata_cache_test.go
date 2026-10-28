package panel

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestProviderMetadataHitExpiryCloneAndBounds(t *testing.T) {
	var c providerMetadataCache
	key := [32]byte{1}
	calls := 0
	fetch := func(context.Context) ([]byte, error) { calls++; return []byte(`{"ok":true}`), nil }
	first, err := c.get(context.Background(), key, time.Minute, fetch)
	if err != nil {
		t.Fatal(err)
	}
	first[0] = 'x'
	second, _ := c.get(context.Background(), key, time.Minute, fetch)
	if calls != 1 || string(second) != `{"ok":true}` {
		t.Fatalf("hit/clone: calls=%d data=%s", calls, second)
	}
	c.mu.Lock()
	e := c.entries[key]
	e.expires = time.Now().Add(-time.Second)
	c.entries[key] = e
	c.mu.Unlock()
	c.get(context.Background(), key, time.Minute, fetch)
	if calls != 2 {
		t.Fatal("expired entry reused")
	}
	for i := 0; i < 200; i++ {
		c.get(context.Background(), [32]byte{byte(i), 2}, time.Minute, fetch)
	}
	if len(c.entries) > providerMetadataMaxEntries || c.bytes > providerMetadataMaxBytes {
		t.Fatal("bounds exceeded")
	}
}
func TestProviderMetadataFailureNotCached(t *testing.T) {
	for _, data := range []string{"bad", `{"url":"https://cdn.modrinth.com/file?signature=secret"}`} {
		var c providerMetadataCache
		calls := 0
		fetch := func(context.Context) ([]byte, error) { calls++; return []byte(data), nil }
		for i := 0; i < 2; i++ {
			c.get(context.Background(), [32]byte{}, time.Minute, fetch)
		}
		if calls != 2 {
			t.Fatalf("cached %s", data)
		}
	}
	var c providerMetadataCache
	calls := 0
	fetch := func(context.Context) ([]byte, error) { calls++; return nil, errors.New("provider unavailable") }
	for i := 0; i < 2; i++ {
		if _, err := c.get(context.Background(), [32]byte{}, time.Minute, fetch); err == nil {
			t.Fatal("missing error")
		}
	}
	if calls != 2 {
		t.Fatal("cached failure")
	}
}
func TestProviderMetadataCoalescingAndCancellation(t *testing.T) {
	var c providerMetadataCache
	var calls atomic.Int32
	started := make(chan struct{})
	release := make(chan struct{})
	fetch := func(ctx context.Context) ([]byte, error) {
		calls.Add(1)
		close(started)
		select {
		case <-release:
			return []byte(`{}`), nil
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { _, err := c.get(ctx, [32]byte{}, time.Minute, fetch); done <- err }()
	<-started
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := c.get(context.Background(), [32]byte{}, time.Minute, fetch); err != nil {
				t.Error(err)
			}
		}()
	}
	cancel()
	if err := <-done; !errors.Is(err, context.Canceled) {
		t.Fatalf("cancellation: %v", err)
	}
	close(release)
	wg.Wait()
	if calls.Load() != 1 {
		t.Fatalf("fetches %d", calls.Load())
	}
}
func TestProviderMetadataPartitionAndFreshDefault(t *testing.T) {
	a := &App{}
	b := &App{}
	calls := 0
	fetch := func(context.Context) ([]byte, error) { calls++; return []byte(`{}`), nil }
	browse := providerMetadataBrowse(context.Background())
	for i := 0; i < 2; i++ {
		a.providerMetadataJSON(browse, "https://api.modrinth.com/v2/search", "one", "content", fetch)
	}
	if calls != 1 {
		t.Fatal("missing browse hit")
	}
	a.providerMetadataJSON(browse, "https://api.modrinth.com/v2/search", "two", "content", fetch)
	b.providerMetadataJSON(browse, "https://api.modrinth.com/v2/search", "one", "content", fetch)
	a.HTTP = &http.Client{}
	a.providerMetadataJSON(browse, "https://api.modrinth.com/v2/search", "one", "content", fetch)
	for i := 0; i < 2; i++ {
		a.providerMetadataJSON(context.Background(), "https://api.modrinth.com/v2/search", "one", "content", fetch)
	}
	if calls != 6 {
		t.Fatalf("partition/fresh calls=%d", calls)
	}
}
func TestProviderMetadataWrappersFreshAndProtected(t *testing.T) {
	calls := 0
	a := &App{HTTP: &http.Client{Transport: gameLibraryTransport(func(r *http.Request) (*http.Response, error) {
		calls++
		if r.URL.Host != "api.modrinth.com" {
			t.Fatalf("unexpected host %s", r.URL.Host)
		}
		return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`{"id":1234567890123456789}`))}, nil
	})}}
	p := mcContentProvider{app: a, name: "modrinth"}
	browse := providerMetadataBrowse(context.Background())
	for i := 0; i < 2; i++ {
		var out M
		if err := p.request(browse, "/project/example", &out); err != nil {
			t.Fatal(err)
		}
		if str(out["id"]) != "1234567890123456789" {
			t.Fatalf("numeric identity changed: %v", out)
		}
	}
	if calls != 1 {
		t.Fatal("content browse miss")
	}
	for i := 0; i < 2; i++ {
		var out M
		if err := p.request(context.Background(), "/project/example", &out); err != nil {
			t.Fatal(err)
		}
	}
	if calls != 3 {
		t.Fatal("install-time content request used cache")
	}
	for i := 0; i < 2; i++ {
		var out M
		if err := a.minecraftProviderJSON(browse, "https://api.modrinth.com/v2/project/example", "", &out); err != nil {
			t.Fatal(err)
		}
	}
	if calls != 4 {
		t.Fatal("library browse miss")
	}
	var out M
	if err := a.minecraftProviderJSON(context.Background(), "https://api.modrinth.com/v2/project/example", "", &out); err != nil {
		t.Fatal(err)
	}
	if calls != 5 {
		t.Fatal("install-time library request used cache")
	}
	if err := a.minecraftProviderJSON(browse, "https://127.0.0.1/private", "", &out); err == nil {
		t.Fatal("unsafe URL accepted")
	}
	if calls != 5 {
		t.Fatal("unsafe URL reached transport")
	}
}
