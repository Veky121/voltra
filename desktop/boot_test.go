package main

import (
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
	"testing/fstest"
	"time"
)

// Tests listen on any free port, leaving the app's own port to a running app.
func TestMain(m *testing.M) {
	desktopAddress = "127.0.0.1:0"
	os.Exit(m.Run())
}

// bootPanel counts what reaches the panel, per request URI.
type bootPanel struct {
	*httptest.Server
	mu   sync.Mutex
	hits map[string]int
}

func newBootPanel(t *testing.T, handler func(w http.ResponseWriter, r *http.Request) bool) *bootPanel {
	t.Helper()
	panel := &bootPanel{hits: map[string]int{}}
	panel.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		panel.mu.Lock()
		panel.hits[r.Method+" "+r.URL.RequestURI()]++
		panel.mu.Unlock()
		if r.URL.Path == "/api/desktop/exchange" {
			desktopJSON(w, 201, map[string]any{"attributes": map[string]string{"token": "vdt_" + strings.Repeat("c", 64), "device_id": "next-device"}})
			return
		}
		if r.Header.Get("Authorization") != "Bearer private-session" || r.Header.Get("Cookie") != "" {
			t.Error("launch read did not use the native credential alone")
		}
		if handler != nil && handler(w, r) {
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("ETag", `"v1"`)
		w.Header().Set("Set-Cookie", "panel=secret")
		_, _ = io.WriteString(w, `{"attributes":{"uuid":"user-a","path":"`+r.URL.RequestURI()+`"}}`)
	}))
	t.Cleanup(panel.Close)
	return panel
}

func (p *bootPanel) count(key string) int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.hits[key]
}

func bootHost(t *testing.T, panel *bootPanel) *desktopHost {
	t.Helper()
	h := newHost(t.TempDir(), fstest.MapFS{})
	h.origin, h.launch = "http://127.0.0.1:1234", "launch"
	h.session = session{PanelURL: panel.URL, Token: "private-session", DeviceID: "device"}
	t.Cleanup(h.boot.forget)
	return h
}

// asPage marks r as coming from the page that is loaded now.
func asPage(h *desktopHost, r *http.Request) *http.Request {
	r.AddCookie(&http.Cookie{Name: "voltra_desktop", Value: h.launch})
	r.AddCookie(&http.Cookie{Name: pageCookie, Value: h.connection().id})
	return r
}

func bootRequest(h *desktopHost, method, uri string) *httptest.ResponseRecorder {
	r := asPage(h, httptest.NewRequest(method, h.origin+uri, nil))
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

// settle waits until every launch read has an answer.
func (b *bootState) settle() {
	b.mu.Lock()
	reads := make([]*bootRead, 0, len(b.reads))
	for _, read := range b.reads {
		reads = append(reads, read)
	}
	b.mu.Unlock()
	for _, read := range reads {
		<-read.done
	}
}

func TestLaunchReadsAnswerThePageOnceWithoutASecondPanelRequest(t *testing.T) {
	panel := newBootPanel(t, nil)
	h := bootHost(t, panel)
	h.startBootReads()
	for _, uri := range append(append([]string{}, bootPaths...), bootPagePaths["/"]) {
		w := bootRequest(h, "GET", uri)
		if w.Code != 200 || !strings.Contains(w.Body.String(), `"path":"`+uri+`"`) {
			t.Fatalf("%s: %d %s", uri, w.Code, w.Body.String())
		}
		if w.Header().Get("ETag") != `"v1"` || w.Header().Get("Content-Type") != "application/json" || w.Header().Get("Set-Cookie") != "" {
			t.Fatalf("%s: headers %v", uri, w.Header())
		}
		// The WebView keeps one origin across launches and connections. What
		// a panel answered may be stored, but only for the page that asked.
		if !strings.Contains(strings.Join(w.Header().Values("Vary"), ","), "Cookie") {
			t.Fatalf("%s: an early answer could be reused for another connection: Vary %q", uri, w.Header().Values("Vary"))
		}
		if panel.count("GET "+uri) != 1 {
			t.Fatalf("%s reached the panel %d times", uri, panel.count("GET "+uri))
		}
		// The early answer is spent. The next read is live.
		if w = bootRequest(h, "GET", uri); w.Code != 200 || panel.count("GET "+uri) != 2 {
			t.Fatalf("%s: repeat %d after %d panel requests", uri, w.Code, panel.count("GET "+uri))
		}
		if !strings.Contains(strings.Join(w.Header().Values("Vary"), ","), "Cookie") {
			t.Fatalf("%s: a proxied answer could be reused for another connection: Vary %q", uri, w.Header().Values("Vary"))
		}
	}
	if panel.count("GET /api/client/game-library/catalog") != 0 {
		t.Fatal("a page the app does not reopen on was read at launch")
	}
}

func TestLaunchReadsFollowTheSavedPage(t *testing.T) {
	panel := newBootPanel(t, nil)
	h := bootHost(t, panel)
	if err := os.WriteFile(filepath.Join(h.dir, resumeFile(h.session)), []byte(`{"path":"/game-library"}`), 0600); err != nil {
		t.Fatal(err)
	}
	h.startBootReads()
	if w := bootRequest(h, "GET", "/api/client/game-library/catalog"); w.Code != 200 || panel.count("GET /api/client/game-library/catalog") != 1 {
		t.Fatal("the saved page's first read was not ready", w.Code)
	}
	if panel.count("GET "+bootPagePaths["/"]) != 0 {
		t.Fatal("the overview was read although another page reopens")
	}
}

func TestLaunchReadsNeverReplaceAFailedAnswer(t *testing.T) {
	panel := newBootPanel(t, func(w http.ResponseWriter, r *http.Request) bool {
		switch {
		case r.URL.Path == "/api/client/settings":
			w.Header().Set("Location", "https://elsewhere.example.test")
			w.WriteHeader(http.StatusFound)
		case r.URL.Path == "/api/client/artwork/catalog":
			_, _ = w.Write(make([]byte, bootReadLimit+1))
		default:
			return false
		}
		return true
	})
	h := bootHost(t, panel)
	h.startBootReads()
	if w := bootRequest(h, "GET", "/api/client/settings"); w.Code != 502 || panel.count("GET /api/client/settings") != 2 {
		t.Fatal("a redirected launch read was replayed", w.Code)
	}
	if w := bootRequest(h, "GET", "/api/client/artwork/catalog"); w.Code != 200 || w.Body.Len() != bootReadLimit+1 || panel.count("GET /api/client/artwork/catalog") != 2 {
		t.Fatal("an oversized launch read was not streamed live", w.Code, w.Body.Len())
	}
}

// A panel that cannot be reached at all is reported to the request that
// waited while the launch read tried, without a second attempt as long again.
func TestARequestThatWaitedForAnUnreachablePanelIsToldSoWithoutAskingAgain(t *testing.T) {
	const uri = "/api/client/settings"
	panel := newBootPanel(t, nil)
	patience := bootUnreachableWait
	t.Cleanup(func() { bootUnreachableWait = patience })
	// unreachable is a host whose launch reads dial a panel that does not
	// answer, until the test lets the attempt fail. The page's own requests
	// would reach the fixture. The returned request has taken the launch read.
	answered := make(chan *httptest.ResponseRecorder, 1)
	unreachable := func() (*desktopHost, chan struct{}) {
		h := bootHost(t, panel)
		fail := make(chan struct{})
		h.client = &http.Client{Transport: &http.Transport{DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			select {
			case <-fail:
				return nil, errors.New("no route to the panel")
			case <-ctx.Done():
				return nil, ctx.Err()
			}
		}}}
		h.startBootReads()
		go func() { answered <- bootRequest(h, "GET", uri) }()
		for deadline := time.Now().Add(5 * time.Second); ; time.Sleep(time.Millisecond) {
			h.boot.mu.Lock()
			taken := h.boot.reads != nil && h.boot.reads[uri] == nil
			h.boot.mu.Unlock()
			if taken {
				return h, fail
			}
			if time.Now().After(deadline) {
				t.Fatal("the request never took the launch read")
			}
		}
	}

	// A request that joined the attempt only a moment before it failed has
	// waited through next to nothing. The panel may be within reach again,
	// so it asks.
	bootUnreachableWait = time.Hour
	_, fail := unreachable()
	close(fail)
	select {
	case w := <-answered:
		if w.Code != 200 || panel.count("GET "+uri) != 1 {
			t.Fatal("a request that had barely waited was not given its own attempt", w.Code, panel.count("GET "+uri))
		}
	case <-time.After(5 * time.Second):
		t.Fatal("the late request was never answered")
	}

	// One that has waited its share is told, and the panel is not asked again.
	bootUnreachableWait = 200 * time.Millisecond
	before := panel.count("GET " + uri)
	h, fail := unreachable()
	time.Sleep(bootUnreachableWait + 50*time.Millisecond)
	close(fail)
	select {
	case w := <-answered:
		if w.Code != http.StatusBadGateway || !strings.Contains(w.Body.String(), "could not be reached") || panel.count("GET "+uri) != before {
			t.Fatal("the request that waited was not told the panel is unreachable", w.Code, w.Body.String(), panel.count("GET "+uri)-before)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("the waiting request was never answered")
	}
	// A request that comes after the failure has waited through nothing. It
	// asks the panel itself, which may be reachable again by now.
	h.boot.settle()
	if w := bootRequest(h, "GET", "/api/client/account"); w.Code != 200 || panel.count("GET /api/client/account") != 1 {
		t.Fatal("a later request was answered from the failed attempt", w.Code, panel.count("GET /api/client/account"))
	}
	before = panel.count("GET " + uri)

	// Launch reads that were ended say nothing about the panel: a request
	// waiting for one asks the panel as before.
	h = bootHost(t, panel)
	h.client = &http.Client{Transport: &http.Transport{DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
		<-ctx.Done()
		return nil, ctx.Err()
	}}}
	h.startBootReads()
	go func() { answered <- bootRequest(h, "GET", uri) }()
	for deadline := time.Now().Add(5 * time.Second); ; time.Sleep(time.Millisecond) {
		h.boot.mu.Lock()
		taken := h.boot.reads != nil && h.boot.reads[uri] == nil
		h.boot.mu.Unlock()
		if taken {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("the request never took the launch read")
		}
	}
	h.boot.discard()
	select {
	case w := <-answered:
		if w.Code != 200 || panel.count("GET "+uri) != before+1 {
			t.Fatal("a request released by the end of the launch reads did not ask the panel", w.Code, panel.count("GET "+uri)-before)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("the released request was never answered")
	}
}

// One launch read being rejected means the panel no longer accepts the
// connection. The answers it gave the others just before are not replayed.
func TestARejectedLaunchReadEndsTheOthersToo(t *testing.T) {
	const rejected = "/api/auth/session"
	refuse := make(chan struct{})
	panel := newBootPanel(t, func(w http.ResponseWriter, r *http.Request) bool {
		if r.URL.Path != rejected {
			return false
		}
		<-refuse
		w.WriteHeader(http.StatusUnauthorized)
		return true
	})
	release := sync.OnceFunc(func() { close(refuse) })
	t.Cleanup(release)
	h := bootHost(t, panel)
	h.startBootReads()
	// Every other read is answered and waiting for the page before the panel
	// refuses the one it holds back.
	h.boot.mu.Lock()
	reads := make(map[string]*bootRead, len(h.boot.reads))
	for uri, read := range h.boot.reads {
		reads[uri] = read
	}
	h.boot.mu.Unlock()
	asked := map[string]int{rejected: 1}
	for uri, read := range reads {
		if uri == rejected {
			continue
		}
		<-read.done
		// The administrator's reads are skipped for this account.
		if asked[uri] = panel.count("GET " + uri); read.ok != (asked[uri] == 1) {
			t.Fatalf("%s: answered %v after %d panel requests", uri, read.ok, asked[uri])
		}
	}
	if !reads["/api/client/settings"].ok {
		t.Fatal("nothing was read at launch")
	}
	release()
	// The refusal is acted on before the read counts as finished.
	<-reads[rejected].done
	if h.boot.offered() {
		t.Fatal("answers given before the refusal are still offered")
	}
	for uri := range reads {
		want := 200
		if uri == rejected {
			want = 401
		}
		if w := bootRequest(h, "GET", uri); w.Code != want || panel.count("GET "+uri) != asked[uri]+1 {
			t.Fatalf("%s: the page was not answered by the panel after the refusal: %d after %d panel requests", uri, w.Code, panel.count("GET "+uri))
		}
	}
}

func TestLaunchReadsEndWithWritesConnectionChangesAndTime(t *testing.T) {
	panel := newBootPanel(t, nil)
	h := bootHost(t, panel)
	h.startBootReads()
	h.boot.settle()
	if w := bootRequest(h, "POST", "/api/client/servers/test/navigation"); w.Code != 200 {
		t.Fatal(w.Code)
	}
	if bootRequest(h, "GET", "/api/client/settings"); panel.count("GET /api/client/settings") != 2 {
		t.Fatal("an answer fetched before a write was replayed after it")
	}

	h.startBootReads()
	previous := h.session
	h.mu.Lock()
	h.session = session{PanelURL: panel.URL, Token: "private-session", DeviceID: "other-device"}
	h.mu.Unlock()
	if read, _, _ := h.boot.take(h.current(), "/api/client/settings"); read != nil || h.boot.accountUUID(t.Context(), h.current()) != "" {
		t.Fatal("answers for the previous connection were offered to the next one")
	}
	h.mu.Lock()
	h.session = previous
	h.mu.Unlock()

	h.startBootReads()
	h.boot.mu.Lock()
	h.boot.expires = time.Now().Add(-time.Second)
	h.boot.mu.Unlock()
	if read, _, _ := h.boot.take(previous, "/api/client/settings"); read != nil || h.boot.accountUUID(t.Context(), previous) != "" {
		t.Fatal("launch answers outlived the launch")
	}

	unlinked := bootHost(t, panel)
	unlinked.session = session{}
	unlinked.startBootReads()
	if unlinked.boot.reads != nil {
		t.Fatal("an unlinked app read from a panel")
	}
}

// offered reports whether any launch answer is still available to the page.
func (b *bootState) offered() bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.reads != nil || b.account != nil
}

func TestUnlinkingLinkingAndClosingForgetTheLaunchReads(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("Windows protected session required")
	}
	panel := newBootPanel(t, nil)
	post := func(h *desktopHost, uri, body string) *httptest.ResponseRecorder {
		r := httptest.NewRequest("POST", h.origin+uri, strings.NewReader(body))
		r.Header.Set("Origin", h.origin)
		r.Header.Set("Content-Type", "application/json")
		asPage(h, r)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}

	h := bootHost(t, panel)
	h.startBootReads()
	h.boot.settle()
	if w := post(h, "/desktop/unlink", "{}"); w.Code != 200 || h.boot.offered() {
		t.Fatal("unlinking kept the launch reads", w.Code)
	}
	if w := bootRequest(h, "GET", bootAccountPath); w.Code != 401 {
		t.Fatal("an unlinked app answered an account read", w.Code)
	}

	h = bootHost(t, panel)
	h.startBootReads()
	h.boot.settle()
	link := `{"panel_url":"` + panel.URL + `","code":"` + strings.Repeat("A", 26) + `","name":"Test computer"}`
	if w := post(h, "/desktop/link", link); w.Code != 200 || h.boot.offered() {
		t.Fatal("linking another connection kept the previous launch reads", w.Code, w.Body.String())
	}
	if h.current().DeviceID != "next-device" || h.boot.accountUUID(t.Context(), h.current()) != "" {
		t.Fatal("the new connection inherited the previous account")
	}

	h = newHost(t.TempDir(), fstest.MapFS{})
	h.session = session{PanelURL: panel.URL, Token: "private-session", DeviceID: "device"}
	_, stop, err := h.start()
	if err != nil {
		t.Fatal(err)
	}
	h.startBootReads()
	stop()
	if h.boot.offered() {
		t.Fatal("closing the app kept the launch reads")
	}
}

// heldRead keeps the panel from answering the next read until the test lets
// it. Only that one read is held; a later one for the same path is answered.
type heldRead struct {
	mu    sync.Mutex
	gate  chan struct{}
	taken bool
}

func (g *heldRead) hold() {
	g.mu.Lock()
	g.gate, g.taken = make(chan struct{}), false
	g.mu.Unlock()
}

func (g *heldRead) release() {
	g.mu.Lock()
	if g.gate != nil {
		close(g.gate)
		g.gate = nil
	}
	g.mu.Unlock()
}

func (g *heldRead) wait() {
	g.mu.Lock()
	gate := g.gate
	if g.taken {
		gate = nil
	}
	g.taken = true
	g.mu.Unlock()
	if gate != nil {
		<-gate
	}
}

func TestALaunchReadStillInFlightIsNeverDeliveredAfterItStoppedBeingTrue(t *testing.T) {
	const uri = "/api/client/settings"
	var held heldRead
	panel := newBootPanel(t, func(w http.ResponseWriter, r *http.Request) bool {
		if r.Method == "GET" && r.URL.Path == uri {
			held.wait()
		}
		return false
	})
	t.Cleanup(held.release)
	post := func(h *desktopHost, target string) *httptest.ResponseRecorder {
		r := httptest.NewRequest("POST", h.origin+target, strings.NewReader("{}"))
		r.Header.Set("Origin", h.origin)
		r.Header.Set("Content-Type", "application/json")
		asPage(h, r)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}
	// waiting starts a page request that takes the held launch read, and
	// returns once the read has reached the panel and the request holds it.
	waiting := func(h *desktopHost, r *http.Request) (<-chan *httptest.ResponseRecorder, int) {
		t.Helper()
		before := panel.count("GET " + uri)
		held.hold()
		h.startBootReads()
		answered := make(chan *httptest.ResponseRecorder, 1)
		go func() {
			w := httptest.NewRecorder()
			h.ServeHTTP(w, r)
			answered <- w
		}()
		for deadline := time.Now().Add(5 * time.Second); ; time.Sleep(time.Millisecond) {
			h.boot.mu.Lock()
			taken := h.boot.reads != nil && h.boot.reads[uri] == nil
			h.boot.mu.Unlock()
			if taken && panel.count("GET "+uri) == before+1 {
				return answered, before + 1
			}
			if time.Now().After(deadline) {
				t.Fatalf("the request never took the launch read (taken %v, %d panel requests since the start)", taken, panel.count("GET "+uri)-before)
			}
		}
	}
	page := func(h *desktopHost, ctx context.Context) *http.Request {
		return asPage(h, httptest.NewRequest("GET", h.origin+uri, nil).WithContext(ctx))
	}
	answer := func(answered <-chan *httptest.ResponseRecorder) *httptest.ResponseRecorder {
		t.Helper()
		select {
		case w := <-answered:
			return w
		case <-time.After(5 * time.Second):
			t.Fatal("the waiting request was never answered")
			return nil
		}
	}

	// The page stops waiting: nothing is written and nothing more is asked.
	h := bootHost(t, panel)
	gone, cancel := context.WithCancel(context.Background())
	answered, reads := waiting(h, page(h, gone))
	cancel()
	if w := answer(answered); w.Body.Len() != 0 {
		t.Fatal("an abandoned request was answered")
	}
	held.release()
	if panel.count("GET "+uri) != reads {
		t.Fatal("an abandoned request was repeated")
	}

	// The app is unlinked while the request waits. The request was made for a
	// connection that no longer exists, so it is refused, not sent again with
	// the credential it started with.
	h = bootHost(t, panel)
	answered, reads = waiting(h, page(h, context.Background()))
	if w := post(h, "/desktop/unlink"); w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	held.release()
	if w := answer(answered); w.Code != http.StatusConflict || strings.Contains(w.Body.String(), "user-a") || panel.count("GET "+uri) != reads {
		t.Fatal("a request outlived its connection", w.Code, w.Body.String(), panel.count("GET "+uri)-reads)
	}

	// The same when another connection has replaced it.
	h = bootHost(t, panel)
	answered, reads = waiting(h, page(h, context.Background()))
	h.mu.Lock()
	h.replaceSessionLocked(session{PanelURL: panel.URL, Token: "private-session", DeviceID: "replaced"})
	h.mu.Unlock()
	held.release()
	if w := answer(answered); w.Code != http.StatusConflict || panel.count("GET "+uri) != reads {
		t.Fatal("a request crossed to the next connection", w.Code, panel.count("GET "+uri)-reads)
	}

	// A write passes through while the request waits. The early answer was
	// fetched before it, so the page gets a fresh one instead.
	h = bootHost(t, panel)
	answered, reads = waiting(h, page(h, context.Background()))
	if w := post(h, uri); w.Code != 200 {
		t.Fatal(w.Code)
	}
	// The launch read is still being held. The request does not wait for it:
	// the host already knows that answer will be thrown away.
	if w := answer(answered); w.Code != 200 || panel.count("GET "+uri) != reads+1 {
		t.Fatal("an answer fetched before a write was delivered after it", w.Code, panel.count("GET "+uri)-reads)
	}
	held.release()
}

func TestARequestFromAPageLoadedForAnotherConnectionIsRefused(t *testing.T) {
	const uri = "/api/client/servers/test/power"
	panel := newBootPanel(t, nil)
	h := newHost(t.TempDir(), fstest.MapFS{"index.html": &fstest.MapFile{Data: []byte("<html>Voltra</html>")}})
	h.origin, h.launch = "http://127.0.0.1:1234", "launch"
	h.session = session{PanelURL: panel.URL, Token: "private-session", DeviceID: "device-a"}
	serve := func(method, target string, cookies []*http.Cookie, dest string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, h.origin+target, strings.NewReader("{}"))
		r.Header.Set("Origin", h.origin)
		if dest != "" {
			r.Header.Set("Sec-Fetch-Dest", dest)
		}
		r.AddCookie(&http.Cookie{Name: "voltra_desktop", Value: h.launch})
		for _, cookie := range cookies {
			r.AddCookie(cookie)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}
	// load is the page being loaded: its document names the connection it is for.
	load := func(target, dest string) []*http.Cookie {
		t.Helper()
		w := serve("GET", target, nil, dest)
		if w.Code != 200 {
			t.Fatal(w.Code)
		}
		return w.Result().Cookies()
	}

	page := load("/", "document")
	if len(page) != 1 || page[0].Name != pageCookie || !page[0].HttpOnly || page[0].SameSite != http.SameSiteStrictMode {
		t.Fatal("the document did not name its connection", page)
	}
	if w := serve("POST", uri, page, ""); w.Code != 200 || panel.count("POST "+uri) != 1 {
		t.Fatal("the loaded page could not reach its own panel", w.Code)
	}
	if w := serve("POST", uri, nil, ""); w.Code != http.StatusConflict || panel.count("POST "+uri) != 1 {
		t.Fatal("a request that names no connection was sent", w.Code)
	}
	// Only a document is a new page. Other requests that fall back to the app
	// shell, such as a missing image, do not make the page a different one.
	if cookies := load("/game-artwork/missing.png", "image"); len(cookies) != 0 {
		t.Fatal("a request that is not a page load was given a connection", cookies)
	}

	// Another connection replaces this one while the page is still open. The
	// page's next request was meant for the first panel.
	h.mu.Lock()
	h.replaceSessionLocked(session{PanelURL: panel.URL, Token: "private-session", DeviceID: "device-b"})
	h.mu.Unlock()
	if w := serve("POST", uri, page, ""); w.Code != http.StatusConflict || panel.count("POST "+uri) != 1 {
		t.Fatal("a request made for the previous connection was sent with the next one's credential", w.Code, panel.count("POST "+uri))
	}
	if w := serve("GET", "/api/client/servers/test/ws", page, ""); w.Code != http.StatusConflict {
		t.Fatal("a request made for the previous connection reached the console", w.Code)
	}
	// Nor may it read or add to what the host keeps for the new connection.
	for _, target := range []string{"/desktop/resume", "/desktop/theme", "/desktop/snapshots"} {
		if w := serve("GET", target, page, ""); w.Code != http.StatusConflict {
			t.Fatal(target, "answered a page loaded for the previous connection", w.Code)
		}
	}
	saveOldPlace := httptest.NewRequest("POST", h.origin+"/desktop/resume", strings.NewReader(`{"path":"/server/abc"}`))
	saveOldPlace.Header.Set("Origin", h.origin)
	saveOldPlace.AddCookie(&http.Cookie{Name: "voltra_desktop", Value: h.launch})
	saveOldPlace.AddCookie(page[0])
	refused := httptest.NewRecorder()
	if h.ServeHTTP(refused, saveOldPlace); refused.Code != http.StatusConflict {
		t.Fatal("the previous page saved its place for the new connection", refused.Code)
	}
	if _, err := os.Stat(filepath.Join(h.dir, resumeFile(h.current()))); err == nil {
		t.Fatal("the previous page's place was saved for the new connection")
	}
	// Nor may it end the new connection: unlinking and signing out act on
	// whatever connection exists, so they are refused to a page that was
	// loaded for another.
	for _, target := range []string{"/desktop/unlink", "/api/auth/logout"} {
		if w := serve("POST", target, page, ""); w.Code != http.StatusConflict || h.current().DeviceID != "device-b" {
			t.Fatal(target, "let a page loaded for the previous connection end this one", w.Code)
		}
	}
	// The app then reloads, and the new page belongs to the new connection.
	reloaded := load("/server/abc", "document")
	if len(reloaded) != 1 || reloaded[0].Value == page[0].Value {
		t.Fatal("the reloaded page was not given the new connection", reloaded)
	}
	if w := serve("POST", uri, reloaded, ""); w.Code != 200 || panel.count("POST "+uri) != 2 {
		t.Fatal("the reloaded page could not reach its panel", w.Code)
	}
	if w := serve("POST", "/desktop/unlink", reloaded, ""); w.Code != 200 || h.current().Token != "" {
		t.Fatal("the page loaded for this connection could not unlink it", w.Code)
	}
	// With nothing linked there is nothing to protect, and unlinking again is harmless.
	if w := serve("POST", "/desktop/unlink", page, ""); w.Code != 200 {
		t.Fatal(w.Code)
	}
}

func TestWhatTheHostKeepsForAConnectionIsNotGivenToAPageThatLostItWhileWaiting(t *testing.T) {
	panel := newBootPanel(t, nil)
	for _, target := range []struct{ method, path, body string }{
		{"GET", "/desktop/snapshots", ""},
		{"POST", "/desktop/snapshots", `{"connection":"any","entries":{}}`},
		{"GET", "/desktop/resume", ""},
		{"POST", "/desktop/resume", `{"path":"/server/abc"}`},
		{"GET", "/desktop/theme", ""},
		{"POST", "/desktop/theme", sampleTheme},
	} {
		h := bootHost(t, panel)
		r := asPage(h, httptest.NewRequest(target.method, h.origin+target.path, strings.NewReader(target.body)))
		r.Header.Set("Origin", h.origin)
		r.Header.Set("X-Voltra-Account", "user-a")
		// The request has arrived and is waiting for the host's lock when
		// another connection is linked. It is decided only after that.
		h.mu.Lock()
		answered := make(chan *httptest.ResponseRecorder, 1)
		go func() {
			w := httptest.NewRecorder()
			h.ServeHTTP(w, r)
			answered <- w
		}()
		time.Sleep(20 * time.Millisecond)
		next := session{PanelURL: panel.URL, Token: "private-session", DeviceID: "device-b"}
		h.replaceSessionLocked(next)
		h.mu.Unlock()
		select {
		case w := <-answered:
			if w.Code != http.StatusConflict {
				t.Fatalf("%s %s was answered %d for the connection that replaced the page's own: %s", target.method, target.path, w.Code, w.Body.String())
			}
		case <-time.After(5 * time.Second):
			t.Fatal(target.method, target.path, "was never answered")
		}
		for _, file := range []string{resumeFile(next), snapshotFile(next)} {
			if _, err := os.Stat(filepath.Join(h.dir, file)); err == nil {
				t.Fatal(target.method, target.path, "left something of the previous page with the new connection:", file)
			}
		}
	}
}

func TestNothingIsSentToThePanelForAConnectionThatHasEnded(t *testing.T) {
	const uri = "/api/client/servers/test/files/list"
	abandoned := make(chan struct{})
	arrived := make(chan struct{}, 1)
	var hold bool
	var mu sync.Mutex
	panel := newBootPanel(t, func(w http.ResponseWriter, r *http.Request) bool {
		mu.Lock()
		waiting := hold && r.URL.Path == uri
		mu.Unlock()
		if !waiting {
			return false
		}
		arrived <- struct{}{}
		select {
		case <-r.Context().Done():
			close(abandoned)
		case <-time.After(5 * time.Second):
		}
		return true
	})
	post := func(h *desktopHost, target string) *httptest.ResponseRecorder {
		r := httptest.NewRequest("POST", h.origin+target, strings.NewReader("{}"))
		r.Header.Set("Origin", h.origin)
		asPage(h, r)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}

	// The decision to ask the panel was made for a connection that then ended
	// before the request left: the check passed, the app was unlinked, and only
	// then would the request have been sent.
	h := bootHost(t, panel)
	conn := h.connection()
	if w := post(h, "/desktop/unlink"); w.Code != 200 {
		t.Fatal(w.Code)
	}
	r := httptest.NewRequest("GET", h.origin+uri, nil)
	w := httptest.NewRecorder()
	h.forward(w, r, conn)
	if w.Code != http.StatusConflict || panel.count("GET "+uri) != 0 {
		t.Fatal("a request was sent with the credential of a connection that had ended", w.Code, panel.count("GET "+uri))
	}

	// A request already on its way is abandoned when the app is unlinked.
	h = bootHost(t, panel)
	mu.Lock()
	hold = true
	mu.Unlock()
	answered := make(chan *httptest.ResponseRecorder, 1)
	go func() { answered <- bootRequest(h, "GET", uri) }()
	select {
	case <-arrived:
	case <-time.After(5 * time.Second):
		t.Fatal("the request never reached the panel")
	}
	if w := post(h, "/desktop/unlink"); w.Code != 200 {
		t.Fatal(w.Code)
	}
	select {
	case w := <-answered:
		if w.Code != http.StatusConflict {
			t.Fatal("an abandoned request was not reported as a changed connection", w.Code, w.Body.String())
		}
	case <-time.After(5 * time.Second):
		t.Fatal("a request outlived its connection")
	}
	select {
	case <-abandoned:
	case <-time.After(5 * time.Second):
		t.Fatal("the panel was never told the request had been abandoned")
	}

	// The lifetime also ends when the app closes, and a new one begins on relink.
	h = bootHost(t, panel)
	before := h.connection()
	h.mu.Lock()
	h.replaceSessionLocked(h.session)
	h.mu.Unlock()
	if after := h.connection(); !before.ended() || after.ended() || after.id == before.id {
		t.Fatal("replacing the connection did not end the previous lifetime and start another")
	}
}

func TestAdministratorReadsWaitForTheAccountAndAreSkippedForMembers(t *testing.T) {
	for _, administrator := range []bool{true, false} {
		panel := newBootPanel(t, func(w http.ResponseWriter, r *http.Request) bool {
			if r.URL.Path != bootAccountPath || !administrator {
				return false
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = io.WriteString(w, `{"attributes":{"uuid":"user-a","root_admin":true}}`)
			return true
		})
		h := bootHost(t, panel)
		h.startBootReads()
		h.boot.settle()
		early := 0
		if administrator {
			early = 1
		}
		for _, uri := range bootAdminPaths["/"] {
			if panel.count("GET "+uri) != early {
				t.Fatalf("administrator %v: %s was read %d times at launch", administrator, uri, panel.count("GET "+uri))
			}
			// A member's page never asks; if it did, the request would simply be live.
			if w := bootRequest(h, "GET", uri); w.Code != 200 || panel.count("GET "+uri) != 1 {
				t.Fatalf("administrator %v: %s answered %d after %d panel requests", administrator, uri, w.Code, panel.count("GET "+uri))
			}
		}
	}
}

func TestLaunchAccountIdentifiesTheThemeProfile(t *testing.T) {
	panel := newBootPanel(t, nil)
	h := bootHost(t, panel)
	h.startBootReads()
	// The page takes its copy first; the identity must remain available.
	if w := bootRequest(h, "GET", bootAccountPath); w.Code != 200 {
		t.Fatal(w.Code)
	}
	if w := themeRequest(h, "POST", "user-a", sampleTheme); w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	if w := themeRequest(h, "GET", "user-a", ""); w.Code != 200 || !strings.Contains(w.Body.String(), `"accentA":"#4d78c9"`) {
		t.Fatal(w.Code, w.Body.String())
	}
	if w := themeRequest(h, "GET", "user-b", ""); w.Code != 409 {
		t.Fatal("another account read this profile's theme", w.Code)
	}
	if panel.count("GET "+bootAccountPath) != 1 {
		t.Fatalf("theme reads asked the panel for the account %d times", panel.count("GET "+bootAccountPath))
	}
	h.boot.forget()
	if w := themeRequest(h, "GET", "user-a", ""); w.Code != 200 || panel.count("GET "+bootAccountPath) != 2 {
		t.Fatal("without a launch answer the panel must identify the account", w.Code)
	}
}

func TestDesktopKeepsOneOriginAndFallsBackWhenItsPortIsTaken(t *testing.T) {
	probe, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	usual := desktopAddress
	desktopAddress = probe.Addr().String()
	t.Cleanup(func() { desktopAddress = usual })
	_ = probe.Close()

	first := newHost(t.TempDir(), fstest.MapFS{"index.html": &fstest.MapFile{Data: []byte("<html>Voltra</html>")}})
	_, stopFirst, err := first.start()
	if err != nil {
		t.Fatal(err)
	}
	if first.origin != "http://"+desktopAddress {
		t.Fatalf("origin %s, want %s", first.origin, desktopAddress)
	}
	second := newHost(t.TempDir(), fstest.MapFS{})
	_, stopSecond, err := second.start()
	if err != nil {
		t.Fatal("a taken port must not stop the app:", err)
	}
	if second.origin == first.origin {
		t.Fatal("two hosts share one origin")
	}
	stopSecond()
	stopFirst()

	again := newHost(t.TempDir(), first.assets)
	_, stopAgain, err := again.start()
	if err != nil {
		t.Fatal(err)
	}
	defer stopAgain()
	if again.origin != first.origin {
		t.Fatalf("the next launch moved from %s to %s", first.origin, again.origin)
	}
	// Reusing the origin must not let the previous launch's cookie back in.
	for cookie, want := range map[string]int{first.launch: http.StatusForbidden, again.launch: http.StatusOK} {
		r, _ := http.NewRequest("GET", again.origin+"/", nil)
		r.AddCookie(&http.Cookie{Name: "voltra_desktop", Value: cookie})
		resp, err := http.DefaultClient.Do(r)
		if err != nil {
			t.Fatal(err)
		}
		_ = resp.Body.Close()
		if resp.StatusCode != want {
			t.Fatalf("launch cookie answered %d, want %d", resp.StatusCode, want)
		}
	}
}

func TestDesktopAssetsAreStoredOnlyWhenNamedByContent(t *testing.T) {
	h := newHost(t.TempDir(), fstest.MapFS{
		"index.html":           &fstest.MapFile{Data: []byte("<html>Voltra</html>")},
		"startup.js":           &fstest.MapFile{Data: []byte("void 0")},
		"assets/index-abc1.js": &fstest.MapFile{Data: []byte("void 0")},
	})
	h.origin, h.launch = "http://127.0.0.1:1234", "launch"
	for uri, want := range map[string]string{
		"/":                     "no-store",
		"/server/abc":           "no-store",
		"/startup.js":           "no-cache",
		"/assets/index-abc1.js": "public, max-age=31536000, immutable",
	} {
		if w := bootRequest(h, "GET", uri); w.Code != 200 || w.Header().Get("Cache-Control") != want {
			t.Fatalf("%s: %d Cache-Control %q, want %q", uri, w.Code, w.Header().Get("Cache-Control"), want)
		}
	}
	if w := bootRequest(h, "GET", "/assets/missing.js"); w.Code != 404 {
		t.Fatal("a missing build file was answered with the app shell", w.Code)
	}
}
