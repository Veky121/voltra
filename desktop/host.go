package main

import (
	"bytes"
	"compress/gzip"
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

type desktopHost struct {
	mu                                sync.RWMutex
	themeMu                           sync.Mutex
	session                           session
	dir, origin, launch, storageError string
	assets                            fs.FS
	client                            *http.Client
	updates                           *updateController
	windowControl                     func(string) (bool, error)
	boot                              bootState
	// snapshotTurn changes when the saved pages are thrown away under a
	// connection that goes on existing; see snapshots.go.
	snapshotTurn uint64
	// snapshotCleanup is set while rejected saved pages still wait to be deleted.
	snapshotCleanup bool
	// scope is the current connection's lifetime; see connection.go.
	scope *connectionScope
	// Tracked sockets close when the device is unlinked or the app exits.
	sockets map[*websocket.Conn]struct{}
}

func newHost(dir string, assets fs.FS) *desktopHost {
	s, err := loadSession(dir)
	h := &desktopHost{dir: dir, session: s, assets: assets, sockets: map[*websocket.Conn]struct{}{}, client: &http.Client{Timeout: 30 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}
	if err != nil {
		h.storageError = err.Error()
	}
	// Saved pages that must go are only noted here. Nothing is deleted until
	// this launch is known to be the one running instance: see startBootReads.
	if s.Token == "" {
		// No connection, or one that can no longer be read: nothing an earlier
		// account saw is kept for whoever pairs next.
		h.snapshotCleanup = true
	} else if _, err := os.Stat(filepath.Join(dir, snapshotsRejected)); err == nil {
		// The panel rejected this connection last time and its pages could
		// not be deleted then.
		h.snapshotCleanup = true
	}
	return h
}
func nonce() string {
	var b [32]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b[:])
}
func (h *desktopHost) current() session { h.mu.RLock(); defer h.mu.RUnlock(); return h.session }
func desktopJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func desktopError(w http.ResponseWriter, status int, message string) {
	desktopJSON(w, status, map[string]string{"error": message})
}

// desktopAddress is tried first so the page keeps one origin from launch to
// launch. The WebView keys its HTTP cache, compiled scripts and localStorage
// by origin, and with a new port each time all three started empty.
//
// A known port grants nothing by itself: every request still needs this
// launch's cookie, the exact Host and a same-origin Origin. When the port is
// taken, any free one is used and that launch simply starts cold.
var desktopAddress = "127.0.0.1:47613"

func (h *desktopHost) start() (string, func(), error) {
	listener, err := net.Listen("tcp4", desktopAddress)
	if err != nil {
		listener, err = net.Listen("tcp4", "127.0.0.1:0")
	}
	if err != nil {
		return "", nil, err
	}
	h.origin = "http://" + listener.Addr().String()
	h.launch = nonce()
	server := &http.Server{Handler: h, ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 60 * time.Second}
	go func() { _ = server.Serve(listener) }()
	return h.origin + "/?launch=" + h.launch, func() {
		h.mu.Lock()
		h.endConnectionLocked()
		h.mu.Unlock()
		h.closeSockets()
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		_ = server.Shutdown(ctx)
	}, nil
}
func (h *desktopHost) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Referrer-Policy", "no-referrer")
	u, _ := url.Parse(h.origin)
	if r.Host != u.Host {
		desktopError(w, 403, "Invalid desktop host.")
		return
	}
	if r.URL.Path == "/" && r.URL.Query().Get("launch") != "" {
		if subtle.ConstantTimeCompare([]byte(r.URL.Query().Get("launch")), []byte(h.launch)) != 1 {
			desktopError(w, 403, "Invalid desktop launch.")
			return
		}
		http.SetCookie(w, &http.Cookie{Name: "voltra_desktop", Value: h.launch, Path: "/", HttpOnly: true, SameSite: http.SameSiteStrictMode})
		w.Header().Set("Cache-Control", "no-store")
		http.Redirect(w, r, "/", http.StatusSeeOther)
		return
	}
	cookie, err := r.Cookie("voltra_desktop")
	if err != nil || subtle.ConstantTimeCompare([]byte(cookie.Value), []byte(h.launch)) != 1 {
		desktopError(w, 403, "Open Voltra from the desktop app.")
		return
	}
	if origin := r.Header.Get("Origin"); origin != "" && origin != h.origin {
		desktopError(w, 403, "Invalid desktop origin.")
		return
	}
	if r.Header.Get("Sec-Fetch-Site") == "cross-site" {
		desktopError(w, 403, "Invalid desktop request.")
		return
	}
	if strings.HasPrefix(r.URL.Path, "/desktop/") || r.URL.Path == "/api/auth/logout" {
		h.desktop(w, r)
		return
	}
	if strings.HasPrefix(r.URL.Path, "/api/") || r.URL.Path == "/locales/locale.json" {
		// One reading of the connection decides everything about this request:
		// whether it is admitted, and where and as whom it is sent.
		conn := h.connection()
		if conn.session.Token == "" {
			desktopError(w, 401, "Link your account first.")
			return
		}
		if !conn.loadedFor(r) {
			connectionChanged(w)
			return
		}
		if websocket.IsWebSocketUpgrade(r) {
			h.socket(w, r, conn)
		} else {
			h.proxy(w, r, conn)
		}
		return
	}
	if r.Method != "GET" && r.Method != "HEAD" {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' ws://"+u.Host+"; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
	name := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
	if name == "." {
		name = "index.html"
	}
	if _, err := fs.Stat(h.assets, name); err != nil {
		if strings.HasPrefix(name, "assets/") {
			http.NotFound(w, r)
			return
		}
		name = "index.html"
	}
	switch {
	case name == "index.html":
		w.Header().Set("Cache-Control", "no-store")
		// Only a document being loaded is a new page. Chromium names the
		// destination; a client that does not is taken at its word.
		if dest := r.Header.Get("Sec-Fetch-Dest"); dest == "" || dest == "document" {
			h.bindPage(w)
		}
	case strings.HasPrefix(name, "assets/"):
		// Build output is named by content, so a stored copy is never stale.
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	default:
		// Unhashed files change with the executable and carry no validator.
		w.Header().Set("Cache-Control", "no-cache")
	}
	clone := r.Clone(r.Context())
	clone.URL.Path = "/" + name
	if name == "index.html" {
		clone.URL.Path = "/"
	}
	http.FileServer(http.FS(h.assets)).ServeHTTP(w, clone)
}
func (h *desktopHost) desktop(w http.ResponseWriter, r *http.Request) {
	// The next three keep something for the connection. Each refuses a page
	// that was loaded for an earlier one, in the same reading of the
	// connection it then acts on.
	if r.URL.Path == "/desktop/resume" {
		h.serveResume(w, r)
		return
	}
	if r.URL.Path == "/desktop/theme" {
		h.serveTheme(w, r)
		return
	}
	if r.URL.Path == "/desktop/snapshots" {
		h.serveSnapshots(w, r)
		return
	}
	if r.URL.Path == "/desktop/window" || strings.HasPrefix(r.URL.Path, "/desktop/window/") {
		h.serveWindow(w, r)
		return
	}
	switch r.Method + " " + r.URL.Path {
	case "GET /desktop/status":
		h.mu.RLock()
		defer h.mu.RUnlock()
		s := h.session
		desktopJSON(w, 200, map[string]any{"linked": s.Token != "", "panel_url": s.PanelURL, "device_name": s.Name, "version": version, "updates_enabled": h.updates != nil, "storage_error": h.storageError})
	case "POST /desktop/link":
		h.link(w, r)
	case "POST /desktop/unlink", "POST /api/auth/logout":
		h.mu.Lock()
		defer h.mu.Unlock()
		// A page left over from an earlier connection must not end this one.
		if h.session.Token != "" && !h.connectionLocked().loadedFor(r) {
			connectionChanged(w)
			return
		}
		// Revoke remotely when online. Local removal still works offline; the
		// account's device list can revoke the server credential separately.
		s := h.session
		// What the account last saw goes first, so a failure leaves a
		// connection the user can still unlink again.
		h.snapshotCleanup = true
		if !h.finishSnapshotCleanupLocked() {
			desktopError(w, 500, "Could not remove the saved pages.")
			return
		}
		if err := os.Remove(filepath.Join(h.dir, "connection.dat")); err != nil && !errors.Is(err, os.ErrNotExist) {
			desktopError(w, 500, "Could not remove the saved connection.")
			return
		}
		h.replaceSessionLocked(session{})
		h.storageError = ""
		for socket := range h.sockets {
			_ = socket.Close()
		}
		go h.revoke(s)
		desktopJSON(w, 200, map[string]bool{"unlinked": true})
	case "GET /desktop/update-status", "GET /desktop/update-progress", "POST /desktop/updates", "POST /desktop/update-channel", "POST /desktop/update-install", "POST /desktop/update-restart":
		h.serveUpdates(w, r)
	default:
		http.NotFound(w, r)
	}
}
func (h *desktopHost) link(w http.ResponseWriter, r *http.Request) {
	h.mu.Lock()
	defer h.mu.Unlock()
	var input struct {
		PanelURL string `json:"panel_url"`
		Code     string `json:"code"`
		Name     string `json:"name"`
	}
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
	if err := dec.Decode(&input); err != nil {
		desktopError(w, 422, "Enter a panel address, pairing code, and computer name.")
		return
	}
	u, err := panelURL(input.PanelURL)
	if err != nil {
		desktopError(w, 422, err.Error())
		return
	}
	input.Name = strings.TrimSpace(input.Name)
	input.Code = strings.ToUpper(strings.ReplaceAll(strings.TrimSpace(input.Code), "-", ""))
	if len(input.Code) != 26 || len(input.Name) == 0 || len(input.Name) > 100 {
		desktopError(w, 422, "Use the full pairing code and a computer name of 1 to 100 characters.")
		return
	}
	// What the previous account saw must be gone before another one is linked.
	// This comes before the pairing code is used: a code works once, and a
	// failure here must leave it good for another try.
	h.snapshotCleanup = true
	if !h.finishSnapshotCleanupLocked() {
		desktopError(w, 500, "Could not remove the previous connection's saved pages. Try again in a moment.")
		return
	}
	body, _ := json.Marshal(map[string]string{"code": input.Code, "name": input.Name})
	req, _ := http.NewRequestWithContext(r.Context(), "POST", u.String()+"/api/desktop/exchange", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	resp, err := h.client.Do(req)
	if err != nil {
		desktopError(w, 502, "The panel could not be reached. Check the address and connection.")
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode != 201 {
		message := "Pairing failed. Create a new code in your web account."
		if resp.StatusCode >= 300 && resp.StatusCode < 400 {
			message = "The panel redirected the request. Use its final HTTPS address. If Cloudflare Access protects it, allow the authenticated desktop API routes through Access."
		}
		desktopError(w, resp.StatusCode, message)
		return
	}
	var result struct {
		Attributes struct {
			Token    string `json:"token"`
			DeviceID string `json:"device_id"`
		} `json:"attributes"`
	}
	if err = json.NewDecoder(io.LimitReader(resp.Body, 8192)).Decode(&result); err != nil || !strings.HasPrefix(result.Attributes.Token, "vdt_") || len(result.Attributes.Token) != 68 || result.Attributes.DeviceID == "" {
		desktopError(w, 502, "The panel returned an invalid desktop session.")
		return
	}
	s := session{PanelURL: u.String(), Token: result.Attributes.Token, DeviceID: result.Attributes.DeviceID, Name: input.Name}
	if err = saveSession(h.dir, s); err != nil {
		go h.revoke(s)
		desktopError(w, 500, "Windows could not save the protected connection. Generate a new code and try again.")
		return
	}
	old := h.session
	for socket := range h.sockets {
		_ = socket.Close()
	}
	h.replaceSessionLocked(s)
	// The panel issued this credential a moment ago.
	h.connectionLocked()
	h.scope.accepted = true
	h.storageError = ""
	go h.revoke(old)
	desktopJSON(w, 200, map[string]bool{"linked": true})
}
func (h *desktopHost) revoke(s session) {
	if s.Token == "" {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, "DELETE", s.PanelURL+"/api/client/account/desktop/devices/"+url.PathEscape(s.DeviceID), nil)
	req.Header.Set("Authorization", "Bearer "+s.Token)
	if resp, err := h.client.Do(req); err == nil {
		_ = resp.Body.Close()
	}
}
func proxyHeaders(r *http.Request, s session) {
	for name := range r.Header {
		lower := strings.ToLower(name)
		if strings.HasPrefix(lower, "x-forwarded-") || strings.HasPrefix(lower, "cf-access-") || strings.HasPrefix(lower, "x-dev-") || lower == "forwarded" || lower == "cookie" || lower == "authorization" {
			r.Header.Del(name)
		}
	}
	r.Header.Set("Authorization", "Bearer "+s.Token)
	if r.Header.Get("Origin") != "" {
		r.Header.Set("Origin", s.PanelURL)
	}
	r.Header.Del("Referer")
}

// connectionChanged answers a request whose connection ended before it could
// be completed. The page reloads after linking or unlinking; until then it is
// told plainly rather than answered by another connection.
func connectionChanged(w http.ResponseWriter) {
	desktopError(w, http.StatusConflict, "The saved connection changed. Reload the app.")
}

func (h *desktopHost) proxy(w http.ResponseWriter, r *http.Request, conn connection) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		h.boot.discard()
	} else {
		switch h.serveBootRead(w, r, conn) {
		case bootServed:
			return
		case bootConnectionChanged:
			connectionChanged(w)
			return
		}
	}
	h.forward(w, r, conn)
}

// forward sends a request to the panel for the connection it arrived on. The
// request is tied to that connection's lifetime: once the connection has
// ended it is not sent, and one already on its way is abandoned.
const panelUnreachable = "The panel could not be reached. Check your connection and retry."

func (h *desktopHost) forward(w http.ResponseWriter, r *http.Request, conn connection) {
	if conn.ended() {
		connectionChanged(w)
		return
	}
	ctx, done := conn.during(r.Context())
	defer done()
	r = r.WithContext(ctx)
	s := conn.session
	target, _ := url.Parse(s.PanelURL)
	identifying := r.Method == http.MethodGet && r.URL.Path == bootAccountPath
	proxy := httputil.NewSingleHostReverseProxy(target)
	director := proxy.Director
	proxy.Director = func(req *http.Request) {
		director(req)
		req.Host = target.Host
		proxyHeaders(req, s)
		if strings.HasSuffix(r.URL.Path, "/websocket") || identifying {
			// This JSON response is read locally, so request it plain.
			req.Header.Set("Accept-Encoding", "identity")
		}
		if identifying {
			// And in full: "not modified" would name no account.
			req.Header.Del("If-None-Match")
			req.Header.Del("If-Modified-Since")
		}
		req.Header["X-Forwarded-For"] = nil
	}
	proxy.ModifyResponse = func(resp *http.Response) error {
		resp.Header.Del("Set-Cookie")
		cachedForThisPage(resp.Header)
		if resp.StatusCode == http.StatusUnauthorized {
			// The panel no longer accepts this connection. The page will clear
			// what it holds, but it may be closed before it can say so.
			h.rejectSnapshots(conn)
		} else if identifying && resp.StatusCode == http.StatusOK && resp.Header.Get("Content-Encoding") == "" {
			// The account read is how the page learns who it is signed in as.
			// When the answer names an account, the panel has accepted the
			// connection. The page gets the same bytes either way.
			start, err := io.ReadAll(io.LimitReader(resp.Body, accountLimit+1))
			if err != nil {
				return err
			}
			if len(start) <= accountLimit && accountID(start) != "" {
				h.panelAccepted(conn)
			}
			resp.Body = struct {
				io.Reader
				io.Closer
			}{io.MultiReader(bytes.NewReader(start), resp.Body), resp.Body}
		}
		if resp.StatusCode >= 300 && resp.StatusCode < 400 && resp.StatusCode != http.StatusNotModified {
			resp.Header.Del("Location")
			return errors.New("panel redirects are not followed")
		}
		// The panel returns an absolute console address. Keep the socket on
		// the local transport so the native host supplies its credential.
		if strings.HasSuffix(r.URL.Path, "/websocket") && resp.StatusCode == 200 {
			bodyReader := io.Reader(resp.Body)
			if strings.EqualFold(strings.TrimSpace(resp.Header.Get("Content-Encoding")), "gzip") {
				compressed, err := gzip.NewReader(resp.Body)
				if err != nil {
					return err
				}
				defer compressed.Close()
				bodyReader = compressed
			}
			var result struct {
				Data map[string]any `json:"data"`
			}
			if err := json.NewDecoder(io.LimitReader(bodyReader, 1<<20)).Decode(&result); err != nil {
				return err
			}
			_ = resp.Body.Close()
			if socket, ok := result.Data["socket"].(string); ok {
				u, err := url.Parse(socket)
				if err != nil {
					return err
				}
				result.Data["socket"] = u.RequestURI()
			}
			body, err := json.Marshal(result)
			if err != nil {
				return err
			}
			resp.Body = io.NopCloser(bytes.NewReader(body))
			resp.ContentLength = int64(len(body))
			resp.Header.Del("Content-Length")
			resp.Header.Del("Content-Encoding")
		}
		return nil
	}
	proxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
		if conn.ended() {
			connectionChanged(w)
			return
		}
		desktopError(w, 502, panelUnreachable)
	}
	proxy.FlushInterval = -1
	proxy.ServeHTTP(w, r)
}
func (h *desktopHost) closeSockets() {
	h.mu.Lock()
	defer h.mu.Unlock()
	for socket := range h.sockets {
		_ = socket.Close()
	}
}
func (h *desktopHost) socket(w http.ResponseWriter, r *http.Request, conn connection) {
	s := conn.session
	dialing, dialed := conn.during(r.Context())
	defer dialed()
	target, _ := url.Parse(s.PanelURL)
	if target.Scheme == "https" {
		target.Scheme = "wss"
	} else {
		target.Scheme = "ws"
	}
	target.Path = r.URL.Path
	target.RawQuery = r.URL.RawQuery
	headers := http.Header{}
	headers.Set("Authorization", "Bearer "+s.Token)
	headers.Set("Origin", s.PanelURL)
	dialer := *websocket.DefaultDialer
	dialer.HandshakeTimeout = 20 * time.Second
	remote, resp, err := dialer.DialContext(dialing, target.String(), headers)
	if err != nil {
		status := 502
		if resp != nil {
			status = resp.StatusCode
			_ = resp.Body.Close()
		}
		if status == http.StatusUnauthorized {
			h.rejectSnapshots(conn)
		}
		desktopError(w, status, "The console connection failed. Check your panel connection.")
		return
	}
	defer remote.Close()
	upgrader := websocket.Upgrader{CheckOrigin: func(req *http.Request) bool { return req.Header.Get("Origin") == h.origin }}
	local, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer local.Close()
	h.mu.Lock()
	if h.session.Token != s.Token || conn.ended() {
		h.mu.Unlock()
		return
	}
	h.sockets[local] = struct{}{}
	h.sockets[remote] = struct{}{}
	h.mu.Unlock()
	defer func() { h.mu.Lock(); delete(h.sockets, local); delete(h.sockets, remote); h.mu.Unlock() }()
	done := make(chan struct{}, 2)
	copySocket := func(dst, src *websocket.Conn) {
		defer func() { done <- struct{}{} }()
		for {
			kind, reader, err := src.NextReader()
			if err != nil {
				return
			}
			writer, err := dst.NextWriter(kind)
			if err != nil {
				return
			}
			_, err = io.Copy(writer, reader)
			closeErr := writer.Close()
			if err != nil || closeErr != nil {
				return
			}
		}
	}
	go copySocket(remote, local)
	go copySocket(local, remote)
	<-done
	_ = local.Close()
	_ = remote.Close()
	<-done
}
