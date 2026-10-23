package panel

import (
	"context"
	"encoding/json"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sync"
	"time"

	"golang.org/x/crypto/acme/autocert"
)

type managedHTTPS struct {
	mu       sync.Mutex
	server   *http.Server
	starting bool
	failed   bool
	closed   bool
}

var managedHTTPSInitialization sync.Mutex

func (a *App) httpsRuntime() *managedHTTPS {
	managedHTTPSInitialization.Lock()
	defer managedHTTPSInitialization.Unlock()
	if a.managedHTTPS == nil {
		a.managedHTTPS = &managedHTTPS{}
	}
	return a.managedHTTPS
}

// StartConfiguredHTTPS restores managed certificates after a Panel restart.
// The loopback bootstrap listener remains available for local recovery.
func (a *App) StartConfiguredHTTPS(ctx context.Context) error {
	s, e := a.setupState(ctx)
	if e != nil {
		return e
	}
	if s.Completed && s.TLSMode == "automatic" {
		a.ensureManagedHTTPS(s)
	}
	return nil
}
func (a *App) ensureManagedHTTPS(s setupState) {
	if s.TLSMode != "automatic" || !s.Completed {
		return
	}
	u, e := url.Parse(s.PublicURL)
	if e != nil {
		return
	}
	runtime := a.httpsRuntime()
	runtime.mu.Lock()
	if runtime.closed || runtime.starting || runtime.server != nil {
		runtime.mu.Unlock()
		return
	}
	runtime.starting = true
	runtime.failed = false
	runtime.mu.Unlock()
	go func() {
		cache := os.Getenv("TLS_CACHE_DIR")
		if cache == "" {
			cache = filepath.Join(".local", "certificates")
		}
		if e := os.MkdirAll(cache, 0700); e != nil {
			runtime.mu.Lock()
			runtime.starting = false
			runtime.failed = true
			runtime.mu.Unlock()
			slog.Error("HTTPS certificate cache unavailable")
			return
		}
		manager := &autocert.Manager{Prompt: autocert.AcceptTOS, HostPolicy: autocert.HostWhitelist(u.Hostname()), Email: s.ACMEEmail, Cache: autocert.DirCache(cache)}
		// TLS-ALPN-01 uses the same HTTPS port as the Panel; no port 80 listener is
		// required. The hostname must route to this server's port 443.
		listener, e := net.Listen("tcp", ":443")
		if e != nil {
			runtime.mu.Lock()
			runtime.starting = false
			runtime.failed = true
			runtime.mu.Unlock()
			slog.Error("HTTPS listener unavailable", "error", e)
			return
		}
		server := &http.Server{Handler: a.Handler(), TLSConfig: manager.TLSConfig(), ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 120 * time.Second}
		runtime.mu.Lock()
		if runtime.closed {
			runtime.starting = false
			runtime.mu.Unlock()
			_ = listener.Close()
			return
		}
		runtime.server = server
		runtime.starting = false
		runtime.mu.Unlock()
		if e := server.ServeTLS(listener, "", ""); e != nil && e != http.ErrServerClosed {
			slog.Error("HTTPS server stopped", "error", e)
		}
		runtime.mu.Lock()
		runtime.server = nil
		runtime.mu.Unlock()
	}()
}
func (a *App) closeHTTPS() {
	runtime := a.httpsRuntime()
	runtime.mu.Lock()
	runtime.closed = true
	server := runtime.server
	runtime.mu.Unlock()
	if server != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = server.Shutdown(ctx)
	}
}
func (a *App) setupHTTPS(w http.ResponseWriter, r *http.Request) {
	s, e := a.setupState(r.Context())
	if e != nil {
		fail(w, e)
		return
	}
	if _, e = a.requireAdmin(r); e != nil {
		fail(w, e)
		return
	}
	if !a.browserOrigin(r, s) {
		fail(w, forbidden())
		return
	}
	if s.TLSMode == "automatic" {
		a.ensureManagedHTTPS(s)
	}
	checks, valid := a.validateSetupAddress(r.Context(), s)
	if valid && s.PendingTLS {
		s.PendingTLS = false
		raw, e := json.Marshal(s)
		if e == nil {
			_, e = a.DB.Exec(r.Context(), "UPDATE settings SET value=$1 WHERE key='panel:setup'", raw)
		}
		if e != nil {
			fail(w, e)
			return
		}
	}
	next := "/setup"
	if valid {
		next = "/admin/nodes"
	}
	writeJSON(w, 200, M{"valid": valid, "completed": s.Completed, "https_pending": !valid, "restart_required": false, "checks": checks, "next_url": next})
}
