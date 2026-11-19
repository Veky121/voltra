package main

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"net/http"
)

// A saved connection has a lifetime. It begins when the app starts with it or
// links it, and ends when the app unlinks, links another, or closes.
//
// Everything done on a connection's behalf (a proxied request, a console
// socket, an early read, a saved page) holds the connection it started with.
// That value carries the credential together with a context that is done the
// moment the lifetime ends, so work started for one connection cannot be sent
// on, finished or stored for the next, however the two happen to interleave.
type connection struct {
	session session
	// id is new for every lifetime and means nothing outside this process.
	id  string
	ctx context.Context
}

type connectionScope struct {
	id     string
	ctx    context.Context
	cancel context.CancelFunc
	// accepted is set once the panel has shown, in this launch, that it takes
	// this connection's credential for an account: by answering an account
	// read made with it, or by having just issued it. A bare success status is
	// not that; something in front of the panel can answer 200 to anything.
	// Until then the host cannot tell whether the panel still accepts it.
	accepted bool
	// refused is set once the panel has refused it. An answer that was
	// already on its way when that happened does not make it accepted again.
	refused bool
}

// panelAccepted records that the panel has just identified the account behind
// the connection's credential. A connection that has since ended is not this one.
func (h *desktopHost) panelAccepted(conn connection) {
	h.mu.Lock()
	if h.scope != nil && h.scope.id == conn.id && !h.scope.refused {
		h.scope.accepted = true
	}
	h.mu.Unlock()
}

// isAccepted reports whether the panel has accepted the current connection in this launch.
func (h *desktopHost) isAccepted() bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.scope != nil && h.scope.accepted
}

// accountLimit bounds an account answer the host reads for itself.
const accountLimit = 1 << 20

// accountID is the account a panel's answer to an account read names, or ""
// when the answer is not one.
func accountID(body []byte) string {
	var account struct {
		Attributes struct {
			UUID string `json:"uuid"`
		} `json:"attributes"`
	}
	if json.Unmarshal(body, &account) != nil {
		return ""
	}
	return account.Attributes.UUID
}

// ended reports whether the app has since unlinked, relinked or closed.
func (c connection) ended() bool { return c.ctx.Err() != nil }

// during returns a context for one piece of work: done when the caller's is,
// and done when the connection ends.
func (c connection) during(parent context.Context) (context.Context, context.CancelFunc) {
	ctx, cancel := context.WithCancel(parent)
	stop := context.AfterFunc(c.ctx, cancel)
	return ctx, func() { stop(); cancel() }
}

// A page is loaded for one connection and says which with every request, in a
// cookie it was given with its document. The app reloads the page after it
// links or unlinks, so a request that carries another connection's name was
// made by a page before it was replaced. It is refused: a request meant for
// one panel is not sent to another with the other's credential.
//
// The cookie belongs to the window, not to one document. Once the reloaded
// document has arrived, anything the outgoing page still sends carries the new
// name. By then that page has nothing left that asks: it is the link or unlink
// screen, and saved pages are also refused by the connection named in their
// own body.
const pageCookie = "voltra_connection"

// cachedForThisPage keeps the WebView from reusing a panel's answer for another
// connection. The app keeps one origin from launch to launch, so without this
// an answer the panel allowed to be cached, such as its translations, could be
// served to a page linked to a different panel. The page's cookies name its
// launch and its connection; making them part of what a cached answer is
// matched on limits reuse to the page it was given to.
func cachedForThisPage(header http.Header) {
	header.Add("Vary", "Cookie")
}

// bindPage tells the page being loaded which connection it is for.
func (h *desktopHost) bindPage(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{Name: pageCookie, Value: h.connection().id, Path: "/", HttpOnly: true, SameSite: http.SameSiteStrictMode})
}

// loadedFor reports whether the page that made r was loaded for this connection.
func (c connection) loadedFor(r *http.Request) bool {
	cookie, err := r.Cookie(pageCookie)
	return err == nil && subtle.ConstantTimeCompare([]byte(cookie.Value), []byte(c.id)) == 1
}

// connectionLocked is connection for callers that already hold h.mu.
func (h *desktopHost) connectionLocked() connection {
	if h.scope == nil {
		ctx, cancel := context.WithCancel(context.Background())
		h.scope = &connectionScope{id: nonce(), ctx: ctx, cancel: cancel}
	}
	return connection{session: h.session, id: h.scope.id, ctx: h.scope.ctx}
}

// connection is the saved connection as it is now.
func (h *desktopHost) connection() connection {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.connectionLocked()
}

// endConnectionLocked ends the current lifetime. The caller holds h.mu.
func (h *desktopHost) endConnectionLocked() {
	if h.scope != nil {
		h.scope.cancel()
		h.scope = nil
	}
	h.boot.forget()
}

// replaceSessionLocked is the only way the saved connection changes while the
// app runs. The caller holds h.mu.
func (h *desktopHost) replaceSessionLocked(s session) {
	h.session = s
	h.endConnectionLocked()
}
