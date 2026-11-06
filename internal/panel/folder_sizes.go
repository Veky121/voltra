package panel

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"path"
	"strings"
	"sync"
	"time"
)

const folderSizeTTL = time.Minute
const folderSizeCacheLimit = 2048

type folderSizeKey struct{ server, directory string }
type folderSizeEntry struct {
	done    chan struct{}
	size    int64
	updated time.Time
	err     error
	loading bool
}
type folderSizeCache struct {
	mu      sync.Mutex
	entries map[folderSizeKey]*folderSizeEntry
	slots   chan struct{}
}

func (c *folderSizeCache) invalidate(server string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	for key := range c.entries {
		if key.server == server {
			delete(c.entries, key)
		}
	}
}

// Concurrent callers share a scan. Results are scoped to the server and path,
// and every caller is authorized before reaching this cache.
func (c *folderSizeCache) get(ctx context.Context, key folderSizeKey, load func(context.Context) (map[string]int64, error)) (int64, time.Time, error) {
	c.mu.Lock()
	if c.entries == nil {
		c.entries = make(map[folderSizeKey]*folderSizeEntry)
		c.slots = make(chan struct{}, 2)
	}
	e := c.entries[key]
	if e == nil || (!e.loading && time.Since(e.updated) >= folderSizeTTL) {
		// Bound memory without discarding scans which already have waiters.
		if len(c.entries) >= folderSizeCacheLimit {
			var oldest folderSizeKey
			var when time.Time
			for k, value := range c.entries {
				if !value.loading && (when.IsZero() || value.updated.Before(when)) {
					oldest, when = k, value.updated
				}
			}
			if when.IsZero() {
				c.mu.Unlock()
				return 0, time.Time{}, &APIError{Status: 429, Code: "FolderSizeBusy", Detail: "Folder sizes are busy. Try again shortly."}
			}
			delete(c.entries, oldest)
		}
		e = &folderSizeEntry{done: make(chan struct{}), loading: true}
		c.entries[key] = e
		go func(e *folderSizeEntry) {
			// A disconnected caller does not cancel work shared by other clients.
			scanCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 2*time.Minute)
			defer cancel()
			var totals map[string]int64
			var err error
			select {
			case c.slots <- struct{}{}:
				totals, err = load(scanCtx)
				<-c.slots
			case <-scanCtx.Done():
				err = scanCtx.Err()
			}
			if err == nil {
				if _, ok := totals[key.directory]; !ok {
					err = errors.New("Folder size scan did not return a total")
				}
			}
			c.mu.Lock()
			defer c.mu.Unlock()
			e.size, e.updated, e.err, e.loading = totals[key.directory], time.Now(), err, false
			if c.entries[key] != e && err == nil {
				e.err = errors.New("Folder changed during size calculation")
			}
			if c.entries[key] == e {
				if err != nil {
					delete(c.entries, key)
				} else {
					// Cache nested totals too, so expanding a scanned folder does not rescan it.
					for directory, size := range totals {
						child := folderSizeKey{key.server, directory}
						if len(c.entries) >= folderSizeCacheLimit {
							break
						}
						if existing := c.entries[child]; existing != nil {
							continue
						}
						done := make(chan struct{})
						close(done)
						c.entries[child] = &folderSizeEntry{done: done, size: size, updated: e.updated}
					}
				}
			}
			close(e.done)
		}(e)
	}
	c.mu.Unlock()
	select {
	case <-ctx.Done():
		return 0, time.Time{}, ctx.Err()
	case <-e.done:
		return e.size, e.updated, e.err
	}
}

type folderSizeFile struct {
	Name    string `json:"name"`
	Size    *int64 `json:"size"`
	File    bool   `json:"file"`
	Symlink bool   `json:"symlink"`
}

func scanFolderSizes(ctx context.Context, root string, list func(context.Context, string) ([]folderSizeFile, error)) (map[string]int64, error) {
	totals := map[string]int64{root: 0}
	order := []string{root}
	for i := 0; i < len(order); i++ {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if i >= 20000 {
			return nil, errors.New("Folder size scan exceeded its directory limit")
		}
		directory := order[i]
		files, err := list(ctx, directory)
		if err != nil {
			return nil, err
		}
		for _, file := range files {
			if file.Name == "" || file.Name == "." || file.Name == ".." || strings.ContainsAny(file.Name, "/\x00") {
				return nil, errors.New("Invalid folder entry")
			}
			if file.Symlink {
				continue
			}
			if file.File {
				if file.Size == nil || *file.Size < 0 || *file.Size > math.MaxInt64-totals[directory] {
					return nil, errors.New("Invalid file size")
				}
				totals[directory] += *file.Size
			} else {
				child := path.Join(directory, file.Name)
				if _, exists := totals[child]; exists {
					return nil, errors.New("Duplicate directory entry")
				}
				order = append(order, child)
				totals[child] = 0
			}
		}
	}
	for i := len(order) - 1; i > 0; i-- {
		child := order[i]
		parent := path.Dir(child)
		if totals[child] > math.MaxInt64-totals[parent] {
			return nil, errors.New("Folder size overflow")
		}
		totals[parent] += totals[child]
	}
	return totals, nil
}

func (a *App) clientFolderSize(w http.ResponseWriter, r *http.Request) {
	s, err := a.server(r, "file.read")
	if err != nil {
		fail(w, err)
		return
	}
	directory := r.URL.Query().Get("directory")
	if strings.ContainsRune(directory, 0) {
		fail(w, bad("Invalid directory"))
		return
	}
	directory = path.Clean("/" + strings.TrimPrefix(directory, "/"))
	size, updated, err := a.folderSizes.get(r.Context(), folderSizeKey{str(s["uuid"]), directory}, func(ctx context.Context) (map[string]int64, error) {
		return scanFolderSizes(ctx, directory, func(ctx context.Context, directory string) ([]folderSizeFile, error) {
			response, err := a.daemonServer(ctx, s, http.MethodGet, "/files/list-directory?"+url.Values{"directory": {directory}}.Encode(), nil)
			if err != nil {
				return nil, err
			}
			defer response.Body.Close()
			var files []folderSizeFile
			if err := json.NewDecoder(io.LimitReader(response.Body, 32<<20)).Decode(&files); err != nil {
				return nil, fmt.Errorf("Folder listing: %w", err)
			}
			return files, nil
		})
	})
	if err != nil {
		fail(w, &APIError{Status: 503, Code: "FolderSizeUnavailable", Detail: "Could not calculate this folder size. Check folder access and try refreshing."})
		return
	}
	w.Header().Set("Cache-Control", "private, no-store")
	writeJSON(w, 200, item("folder_size", M{"directory": directory, "size": size, "calculated_at": updated.UTC().Format(time.RFC3339), "cache_seconds": 60, "excludes_symlinks": true}))
}
