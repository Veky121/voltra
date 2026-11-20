package panel

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
)

// Every request reads the setup state and the maintenance switch. They are
// kept in memory while the settings listener is connected: the settings
// trigger notifies on every committed change, from this process, another
// panel process or the CLI. Notifications are not durable, so the copy is
// dropped when the listener connects or disconnects, it is never used while
// no listener is running, and it is re-read at least every few seconds in
// case a notification is lost anyway. This process also drops it directly
// after its own writes, so a request that follows a write never waits for
// the notification.
const settingsCacheLifetime = 5 * time.Second

type settingsCache struct {
	mu         sync.Mutex
	listening  bool
	generation uint64
	setup      *cachedSetting[setupState]
	maintained *cachedSetting[bool]
}

type cachedSetting[T any] struct {
	value      T
	fetched    time.Time
	generation uint64
}

func (c *settingsCache) setListening(listening bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.listening = listening
	c.dropLocked()
}

func (c *settingsCache) invalidate() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.dropLocked()
}

// dropLocked makes every cached entry stale.
func (c *settingsCache) dropLocked() {
	c.generation++
	c.setup, c.maintained = nil, nil
}

// readCached returns the cached value, or reads it and keeps it if no change
// was announced while the read ran.
func readCached[T any](c *settingsCache, slot func() **cachedSetting[T], read func() (T, error)) (T, error) {
	c.mu.Lock()
	if entry := *slot(); c.listening && entry != nil && entry.generation == c.generation && time.Since(entry.fetched) < settingsCacheLifetime {
		value := entry.value
		c.mu.Unlock()
		return value, nil
	}
	generation, listening := c.generation, c.listening
	c.mu.Unlock()
	value, err := read()
	if err != nil || !listening {
		return value, err
	}
	c.mu.Lock()
	if c.listening && c.generation == generation {
		*slot() = &cachedSetting[T]{value: value, fetched: time.Now(), generation: generation}
	}
	c.mu.Unlock()
	return value, nil
}

func (a *App) setupState(ctx context.Context) (setupState, error) {
	if a.DB == nil {
		return setupState{PublicURL: a.Config.PublicURL, AccessMode: "local", TLSMode: "proxy"}, nil
	}
	return readCached(&a.settings, func() **cachedSetting[setupState] { return &a.settings.setup }, func() (setupState, error) { return a.readSetupState(ctx) })
}

func (a *App) readSetupState(ctx context.Context) (setupState, error) {
	s := setupState{PublicURL: a.Config.PublicURL, AccessMode: "local", TLSMode: "proxy"}
	var raw []byte
	e := a.DB.QueryRow(ctx, "SELECT value FROM settings WHERE key='panel:setup'").Scan(&raw)
	if errors.Is(e, pgx.ErrNoRows) {
		return s, nil
	}
	if e != nil {
		return s, e
	}
	e = json.Unmarshal(raw, &s)
	return s, e
}

func (a *App) maintenanceEnabled(ctx context.Context) (bool, error) {
	return readCached(&a.settings, func() **cachedSetting[bool] { return &a.settings.maintained }, func() (bool, error) {
		var maintenance bool
		err := a.DB.QueryRow(ctx, "SELECT COALESCE(value::text,'false')::boolean FROM settings WHERE key='app.maintenance'").Scan(&maintenance)
		if errors.Is(err, pgx.ErrNoRows) {
			return false, nil
		}
		return maintenance, err
	})
}

// settingsChanged is called after this process writes a setting.
func (a *App) settingsChanged() { a.settings.invalidate() }
