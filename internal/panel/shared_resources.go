package panel

import (
	"context"
	"sync"
	"time"
)

type resourceReadKey struct {
	server string
	node   int64
}
type resourceReadFlight struct {
	done    chan struct{}
	cancel  context.CancelFunc
	waiters int
	value   M
	err     error
}
type sharedResourceReads struct {
	mu      sync.Mutex
	flights map[resourceReadKey]*resourceReadFlight
	closed  bool
}

// Only overlapping reads share work. There is no TTL or completed telemetry
// cache. Each caller must pass its own current server authorization first.
func (h *sharedResourceReads) read(ctx context.Context, key resourceReadKey, fetch func(context.Context) (M, error)) (M, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	h.mu.Lock()
	if h.closed {
		h.mu.Unlock()
		return nil, context.Canceled
	}
	if h.flights == nil {
		h.flights = make(map[resourceReadKey]*resourceReadFlight)
	}
	f := h.flights[key]
	if f != nil && f.waiters == 0 {
		h.mu.Unlock()
		return nil, APIError{503, "ResourceReadCancelled", "Resource monitoring is reconnecting. Retry shortly."}
	}
	if f == nil {
		if len(h.flights) >= 64 {
			h.mu.Unlock()
			return nil, APIError{503, "ResourceReadLimit", "Resource monitoring is busy. Retry shortly."}
		}
		shared, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		f = &resourceReadFlight{done: make(chan struct{}), cancel: cancel}
		h.flights[key] = f
		go func() {
			defer cancel()
			value, err := fetch(shared)
			h.mu.Lock()
			defer h.mu.Unlock()
			f.value, f.err = value, err
			if h.flights[key] == f {
				delete(h.flights, key)
			}
			close(f.done)
		}()
	}
	f.waiters++
	h.mu.Unlock()
	defer func() {
		h.mu.Lock()
		defer h.mu.Unlock()
		f.waiters--
		if f.waiters == 0 {
			f.cancel()
		}
	}()
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-f.done:
		return f.value, f.err
	}
}
func (h *sharedResourceReads) close() {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.closed = true
	for _, f := range h.flights {
		f.cancel()
	}
}

func (a *App) clientResourceSnapshot(ctx context.Context, server M) (M, error) {
	return a.resourceReads.read(ctx, resourceReadKey{str(server["uuid"]), num(server["node_id"])}, func(shared context.Context) (M, error) {
		response, err := a.daemonServer(shared, server, "GET", "", nil)
		if err != nil {
			return nil, err
		}
		snapshot, err := opJSON(response)
		if err == nil {
			a.attachFS25Health(shared, server, snapshot)
		}
		return snapshot, err
	})
}
