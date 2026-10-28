package panel

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"net/url"
	"strings"
	"sync"
	"time"
)

// Browsing must explicitly opt in. Provisioning and validation stay fresh.
type providerMetadataBrowseKey struct{}

func providerMetadataBrowse(ctx context.Context) context.Context {
	return context.WithValue(ctx, providerMetadataBrowseKey{}, true)
}

const providerMetadataMaxEntries = 128
const providerMetadataMaxBytes = 16 << 20
const providerMetadataMaxItem = 2 << 20
const providerMetadataMaxFlights = 16

type providerMetadataEntry struct {
	data    []byte
	expires time.Time
}
type providerMetadataFlight struct {
	done chan struct{}
	data []byte
	err  error
}
type providerMetadataCache struct {
	mu      sync.Mutex
	entries map[[32]byte]providerMetadataEntry
	flights map[[32]byte]*providerMetadataFlight
	bytes   int
}

// The digest partitions credentials without retaining their plaintext. App ownership
// and client/transport identity prevent sharing fixtures or provider sessions.
func (a *App) providerMetadataJSON(ctx context.Context, address, credential, family string, fetch func(context.Context) ([]byte, error)) ([]byte, error) {
	if enabled, _ := ctx.Value(providerMetadataBrowseKey{}).(bool); !enabled {
		return fetch(ctx)
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	identity := fmt.Sprintf("%s\x00%s\x00%s\x00%p", family, address, credential, a.HTTP)
	if a.HTTP != nil {
		identity += fmt.Sprintf("/%T/%p", a.HTTP.Transport, a.HTTP.Transport)
	}
	key := sha256.Sum256([]byte(identity))
	ttl := 5 * time.Minute
	if containsProviderSearch(address) {
		ttl = 30 * time.Second
	}
	return a.providerMetadata.get(ctx, key, ttl, fetch)
}
func containsProviderSearch(address string) bool {
	// Match path rather than query values, which can themselves contain '/search'.
	for i := 0; i+7 <= len(address); i++ {
		if address[i:i+7] == "/search" {
			return true
		}
		if address[i] == '?' {
			break
		}
	}
	return false
}
func (c *providerMetadataCache) get(ctx context.Context, key [32]byte, ttl time.Duration, fetch func(context.Context) ([]byte, error)) ([]byte, error) {
	c.mu.Lock()
	now := time.Now()
	for k, e := range c.entries {
		if !now.Before(e.expires) {
			delete(c.entries, k)
			c.bytes -= len(e.data)
		}
	}
	if e, ok := c.entries[key]; ok {
		data := append([]byte(nil), e.data...)
		c.mu.Unlock()
		return data, nil
	}
	f := c.flights[key]
	if f == nil {
		if len(c.flights) >= providerMetadataMaxFlights {
			c.mu.Unlock()
			return fetch(ctx)
		}
		if c.flights == nil {
			c.flights = make(map[[32]byte]*providerMetadataFlight)
		}
		f = &providerMetadataFlight{done: make(chan struct{})}
		c.flights[key] = f
		go func() {
			// One caller cancelling must not cancel other callers. Work has a hard
			// lifetime even if every waiter leaves, and retained flights are bounded.
			shared, cancel := context.WithTimeout(context.WithoutCancel(ctx), 20*time.Second)
			defer cancel()
			data, err := fetch(shared)
			c.mu.Lock()
			if err == nil && len(data) <= providerMetadataMaxItem && providerMetadataCacheable(data) {
				if c.entries == nil {
					c.entries = make(map[[32]byte]providerMetadataEntry)
				}
				for len(c.entries) >= providerMetadataMaxEntries || c.bytes+len(data) > providerMetadataMaxBytes {
					for k, e := range c.entries {
						delete(c.entries, k)
						c.bytes -= len(e.data)
						break
					}
				}
				c.entries[key] = providerMetadataEntry{append([]byte(nil), data...), time.Now().Add(ttl)}
				c.bytes += len(data)
			}
			f.data, f.err = data, err
			delete(c.flights, key)
			close(f.done)
			c.mu.Unlock()
		}()
	}
	c.mu.Unlock()
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-f.done:
		return append([]byte(nil), f.data...), f.err
	}
}

// Signed or otherwise query-bearing URLs can expire sooner than catalog TTLs.
// Keep such responses fresh rather than guessing a provider-specific lifetime.
func providerMetadataCacheable(data []byte) bool {
	var value any
	if json.Unmarshal(data, &value) != nil {
		return false
	}
	var safe func(any) bool
	safe = func(v any) bool {
		switch x := v.(type) {
		case string:
			if strings.HasPrefix(x, "https://") || strings.HasPrefix(x, "http://") {
				u, e := url.Parse(x)
				return e == nil && u.RawQuery == ""
			}
		case []any:
			for _, child := range x {
				if !safe(child) {
					return false
				}
			}
		case map[string]any:
			for _, child := range x {
				if !safe(child) {
					return false
				}
			}
		}
		return true
	}
	return safe(value)
}
