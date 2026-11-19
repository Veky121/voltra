package main

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptrace"
	"strconv"
	"sync"
	"sync/atomic"
	"time"
)

// Every launch the page asks the panel for the same few reads before it can
// draw, each waiting for the one before it, and none can start until the
// WebView is up. The host holds the saved connection as soon as the process
// starts, so it asks for all of them at once and gives each answer to the
// first matching request from the page.
//
// An answer is used once, only for the connection it was fetched with, only
// for a short time after launch, and never after a write has passed through
// the proxy. Anything else falls through to the ordinary proxy, so a missing
// or failed early read costs nothing; one still on its way costs the page's
// request the rest of that wait, never beyond the launch window. Two kinds of
// request do not fall through. One that was waiting when the connection itself
// was replaced is refused, because the connection it was made for no longer
// exists. One that waited some seconds while its read failed to reach the
// panel at all is told so, instead of trying for as long again.
const (
	bootLifetime  = 20 * time.Second
	bootReadLimit = 4 << 20
)

// bootUnreachableWait is how long a request must itself have waited on a
// launch read before that read's failure to reach the panel is its answer. A
// request that joined the attempt near its end has waited through very
// little, and the panel may be within reach again: it asks afresh.
var bootUnreachableWait = 5 * time.Second

// bootPaths must match the request URIs the page sends, byte for byte.
var bootPaths = []string{
	"/api/setup/status",
	"/api/auth/session",
	"/api/client/account",
	"/api/client/settings",
	"/api/client/account/server-navigation",
	"/api/client/artwork/catalog",
}

const bootAccountPath = "/api/client/account"

// bootPagePaths are the first reads of the page the app reopens on.
var bootPagePaths = map[string]string{
	"/":             "/api/client?summary=overview&per_page=100",
	"/game-library": "/api/client/game-library/catalog",
}

// bootAdminPaths are asked for by the same pages, but only for an
// administrator. They are read once the account answer says so.
var bootAdminPaths = map[string][]string{
	"/": {"/api/application/servers?per_page=100", "/api/application/nodes?per_page=100"},
}

type bootRead struct {
	done chan struct{}
	ok   bool
	// unreachable is set when the read was given up without a connection to
	// the panel ever having been made, and not because the launch reads ended.
	unreachable bool
	header      http.Header
	body        []byte
}

// fetch asks the panel for one read. heard is called, before the read counts
// as finished, when the panel refuses the connection's credential (false) and
// when its account read names the account behind it (true).
func (read *bootRead) fetch(ctx context.Context, client *http.Client, s session, uri string, heard func(accepted bool)) {
	defer close(read.done)
	var connected atomic.Bool
	trace := &httptrace.ClientTrace{GotConn: func(httptrace.GotConnInfo) { connected.Store(true) }}
	req, err := http.NewRequestWithContext(httptrace.WithClientTrace(ctx, trace), http.MethodGet, s.PanelURL+uri, nil)
	if err != nil {
		return
	}
	req.Header.Set("Authorization", "Bearer "+s.Token)
	req.Header.Set("Accept", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		// Cancelled means the launch reads were ended, which says nothing
		// about the panel. Running out of time while connecting does.
		read.unreachable = !connected.Load() && !errors.Is(ctx.Err(), context.Canceled)
		return
	}
	defer resp.Body.Close()
	// Only a plain success is worth replaying. Rejections, redirects and
	// errors are left for the page's own request to report. A rejection is
	// acted on here as well: the app may be closed before any page asks.
	if heard != nil && resp.StatusCode == http.StatusUnauthorized {
		heard(false)
	}
	if resp.StatusCode != http.StatusOK {
		return
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, bootReadLimit+1))
	if err != nil || len(body) > bootReadLimit {
		return
	}
	read.header, read.body, read.ok = resp.Header, body, true
	if heard != nil && uri == bootAccountPath && accountID(body) != "" {
		heard(true)
	}
}

type bootState struct {
	mu      sync.Mutex
	session session
	expires time.Time
	cancel  context.CancelFunc
	// generation changes whenever the answers stop being trustworthy, so a
	// request that took one earlier can tell before delivering it.
	generation uint64
	// over is closed when the answers of this generation end, so a request
	// waiting for one is released at once instead of waiting out a read whose
	// answer is no longer wanted.
	over  chan struct{}
	reads map[string]*bootRead
	// The account answer also identifies the theme profile, so it stays
	// readable after the page has taken its copy.
	account *bootRead
}

// administrator reports whether a finished account read names an administrator.
func (read *bootRead) administrator() bool {
	var account struct {
		Attributes struct {
			RootAdmin bool `json:"root_admin"`
		} `json:"attributes"`
	}
	return read.ok && json.Unmarshal(read.body, &account) == nil && account.Attributes.RootAdmin
}

// begin starts every read in paths at once. Those in adminPaths wait for the
// account answer and are skipped, unanswered, for anyone else.
func (b *bootState) begin(client *http.Client, s session, paths, adminPaths []string, heard func(accepted bool)) {
	ctx, cancel := context.WithTimeout(context.Background(), bootLifetime)
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.cancel != nil {
		b.cancel()
	}
	b.session, b.expires, b.cancel = s, time.Now().Add(bootLifetime), cancel
	b.endGenerationLocked()
	b.over = make(chan struct{})
	b.reads = make(map[string]*bootRead, len(paths))
	for _, uri := range paths {
		if _, exists := b.reads[uri]; exists {
			continue
		}
		read := &bootRead{done: make(chan struct{})}
		b.reads[uri] = read
		go read.fetch(ctx, client, s, uri, heard)
	}
	b.account = b.reads[bootAccountPath]
	for _, uri := range adminPaths {
		if _, exists := b.reads[uri]; exists || b.account == nil {
			continue
		}
		read := &bootRead{done: make(chan struct{})}
		b.reads[uri] = read
		go func(account *bootRead) {
			select {
			case <-account.done:
			case <-ctx.Done():
				// The account read may still be writing its answer.
				close(read.done)
				return
			}
			if !account.administrator() {
				close(read.done)
				return
			}
			read.fetch(ctx, client, s, uri, heard)
		}(b.account)
	}
}

func (b *bootState) current(s session) bool {
	return b.session == s && time.Now().Before(b.expires)
}

// endGenerationLocked makes every answer handed out so far unusable and
// releases the requests waiting for one. The caller holds b.mu.
func (b *bootState) endGenerationLocked() {
	b.generation++
	if b.over != nil {
		close(b.over)
		b.over = nil
	}
}

// take hands out the early answer for one request URI, at most once, with the
// generation it belongs to and the signal that the generation has ended.
func (b *bootState) take(s session, uri string) (*bootRead, uint64, <-chan struct{}) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.reads == nil || !b.current(s) {
		b.reads = nil
		return nil, 0, nil
	}
	read := b.reads[uri]
	delete(b.reads, uri)
	return read, b.generation, b.over
}

// usable reports whether an answer taken at generation may still be delivered.
func (b *bootState) usable(s session, generation uint64) bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.generation == generation && b.current(s)
}

// discard ends the answers, including any a request is still waiting for. A
// write through the proxy may have changed what they describe.
func (b *bootState) discard() {
	b.mu.Lock()
	b.reads = nil
	b.endGenerationLocked()
	b.mu.Unlock()
}

// forget ends everything tied to the previous connection.
func (b *bootState) forget() {
	b.mu.Lock()
	if b.cancel != nil {
		b.cancel()
	}
	b.session, b.expires, b.cancel, b.reads, b.account = session{}, time.Time{}, nil, nil, nil
	b.endGenerationLocked()
	b.mu.Unlock()
}

// awaitAccount waits, for at most the given time, for the launch's account
// read to hear from the panel. It returns at once when there is none.
func (b *bootState) awaitAccount(ctx context.Context, s session, patience time.Duration) {
	b.mu.Lock()
	read := b.account
	if !b.current(s) {
		read = nil
	}
	b.mu.Unlock()
	if read == nil {
		return
	}
	timer := time.NewTimer(patience)
	defer timer.Stop()
	select {
	case <-read.done:
	case <-ctx.Done():
	case <-timer.C:
	}
}

// accountUUID reports the account the launch read identified, or "" when it
// is unavailable and the caller has to ask the panel.
func (b *bootState) accountUUID(ctx context.Context, s session) string {
	b.mu.Lock()
	read := b.account
	if !b.current(s) {
		read = nil
	}
	b.mu.Unlock()
	if read == nil {
		return ""
	}
	select {
	case <-read.done:
	case <-ctx.Done():
		return ""
	}
	if !read.ok {
		return ""
	}
	return accountID(read.body)
}

// startBootReads runs once per launch, before the window exists.
func (h *desktopHost) startBootReads() {
	// Saved pages noted for removal when the host was made are removed now
	// that this is the one running instance.
	h.mu.Lock()
	h.finishSnapshotCleanupLocked()
	h.mu.Unlock()
	conn := h.connection()
	s := conn.session
	if s.Token == "" {
		return
	}
	paths := append([]string{}, bootPaths...)
	page := h.savedPath(s)
	if first, ok := bootPagePaths[page]; ok {
		paths = append(paths, first)
	}
	h.boot.begin(h.client, s, paths, bootAdminPaths[page], func(accepted bool) {
		if accepted {
			h.panelAccepted(conn)
		} else {
			h.rejectSnapshots(conn)
		}
	})
}

// Headers that describe the upstream connection rather than the answer.
var bootDroppedHeaders = map[string]bool{
	"Connection": true, "Content-Encoding": true, "Content-Length": true, "Keep-Alive": true,
	"Proxy-Authenticate": true, "Proxy-Authorization": true, "Set-Cookie": true, "Te": true,
	"Trailer": true, "Transfer-Encoding": true, "Upgrade": true,
}

type bootOutcome int

const (
	// bootMiss: there is no usable early answer; ask the panel as usual.
	bootMiss bootOutcome = iota
	// bootServed: the request is finished.
	bootServed
	// bootConnectionChanged: the connection ended while the request waited.
	bootConnectionChanged
)

// serveBootRead answers a page request from the launch reads.
func (h *desktopHost) serveBootRead(w http.ResponseWriter, r *http.Request, conn connection) bootOutcome {
	if r.Method != http.MethodGet || r.Header.Get("Range") != "" {
		return bootMiss
	}
	s := conn.session
	read, generation, over := h.boot.take(s, r.URL.RequestURI())
	if read == nil {
		return bootMiss
	}
	began := time.Now()
	finished := false
	select {
	case <-read.done:
		finished = true
	case <-over:
		// A write or the end of the connection: decided below, without
		// waiting for an answer that will not be used.
	case <-r.Context().Done():
		return bootServed
	}
	if conn.ended() {
		return bootConnectionChanged
	}
	// The request has waited its share through an attempt that never reached
	// the panel, so it is not made to wait through a second one. A request
	// that arrived after the failure, or shortly before it, asks afresh.
	if finished && read.unreachable && time.Since(began) >= bootUnreachableWait {
		desktopError(w, http.StatusBadGateway, panelUnreachable)
		return bootServed
	}
	// A write, or the end of the launch window, arrived while this waited. The
	// caller then asks the panel, on this same connection or not at all.
	if !h.boot.usable(s, generation) {
		return bootMiss
	}
	// Only now is the read known to have finished: the generation is still
	// current, so it was read.done that ended the wait.
	if !read.ok {
		return bootMiss
	}
	for name, values := range read.header {
		if bootDroppedHeaders[http.CanonicalHeaderKey(name)] {
			continue
		}
		w.Header()[name] = append([]string(nil), values...)
	}
	cachedForThisPage(w.Header())
	w.Header().Set("Content-Length", strconv.Itoa(len(read.body)))
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(read.body)
	return bootServed
}
