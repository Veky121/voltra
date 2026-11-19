package main

import (
	"encoding/json"
	"io"
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

	"github.com/gorilla/websocket"
)

func snapshotRequest(h *desktopHost, method, body string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, h.origin+"/desktop/snapshots", strings.NewReader(body))
	r.Header.Set("Origin", h.origin)
	r.Header.Set("Content-Type", "application/json")
	asPage(h, r)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

// snapshotHost is a host already linked as s, whose panel has accepted the
// connection in this launch. newHost would read the connection from dir, find
// none, and clear the pages these tests put there.
func snapshotHost(dir, origin string, s session) *desktopHost {
	h := unheardHost(dir, origin, s)
	h.panelAccepted(h.connection())
	return h
}

// unheardHost is the same host before the panel has said anything.
func unheardHost(dir, origin string, s session) *desktopHost {
	return &desktopHost{dir: dir, origin: origin, launch: "launch", session: s, assets: fstest.MapFS{}, sockets: map[*websocket.Conn]struct{}{}, client: &http.Client{Timeout: 5 * time.Second}}
}

var savedPages = map[string]string{"voltra.snapshot.v1.overview.user-a": `{"at":1,"value":[{"uuid":"u1","name":"Survival"}]}`}

// readPages is what the page receives: its entries and the connection they are for.
func readPages(t *testing.T, h *desktopHost) snapshotExchange {
	t.Helper()
	w := snapshotRequest(h, "GET", "")
	var answer snapshotExchange
	if w.Code != 200 || w.Header().Get("Cache-Control") != "no-store" || json.Unmarshal(w.Body.Bytes(), &answer) != nil || answer.Connection == "" || answer.Entries == nil {
		t.Fatal("saved pages could not be read", w.Code, w.Body.String())
	}
	return answer
}

// pendingPages is what the page receives before the panel has accepted the
// connection: no entries, and nothing to save under.
func pendingPages(t *testing.T, h *desktopHost) {
	t.Helper()
	w := snapshotRequest(h, "GET", "")
	var answer snapshotExchange
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &answer) != nil || !answer.Pending || answer.Connection != "" || len(answer.Entries) != 0 {
		t.Fatal("saved pages were offered for a connection the panel has not accepted", w.Code, w.Body.String())
	}
}

// savePages writes entries back the way the page does, for the connection it read them from.
func savePages(h *desktopHost, connection string, entries map[string]string) *httptest.ResponseRecorder {
	body, _ := json.Marshal(snapshotExchange{Connection: connection, Entries: entries})
	return snapshotRequest(h, "POST", string(body))
}

func TestSavedPagesFollowTheConnectionAcrossPortsAndStayWithIt(t *testing.T) {
	dir := t.TempDir()
	first := session{PanelURL: "https://panel.example.test", Token: "private-session", DeviceID: "device-a"}
	h := snapshotHost(dir, "http://127.0.0.1:47613", first)
	opened := readPages(t, h)
	if len(opened.Entries) != 0 {
		t.Fatal("a connection with nothing saved must read as empty", opened.Entries)
	}
	if w := savePages(h, opened.Connection, savedPages); w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	// The next launch may be on any port; the copy belongs to the connection.
	h = snapshotHost(dir, "http://127.0.0.1:50123", first)
	reopened := readPages(t, h)
	if reopened.Entries["voltra.snapshot.v1.overview.user-a"] != savedPages["voltra.snapshot.v1.overview.user-a"] {
		t.Fatal("saved pages were lost on restart", reopened.Entries)
	}
	if reopened.Connection == opened.Connection {
		t.Fatal("two launches named their connection the same")
	}
	for name, other := range map[string]session{
		"another device": {PanelURL: first.PanelURL, Token: "private-session", DeviceID: "device-b"},
		"another panel":  {PanelURL: "https://other.example.test", Token: "private-session", DeviceID: first.DeviceID},
	} {
		if entries := readPages(t, snapshotHost(dir, h.origin, other)).Entries; len(entries) != 0 {
			t.Fatal(name, "read this connection's pages", entries)
		}
	}
	data, err := os.ReadFile(filepath.Join(dir, snapshotFile(first)))
	if err != nil || strings.Contains(string(data), "private-session") || strings.Contains(snapshotFile(first), "device-a") {
		t.Fatal("the saved pages file names its connection or holds a credential", err)
	}
}

func TestSavedPagesNeedALinkAndAcceptOnlyTheStoreTheyAreReadFrom(t *testing.T) {
	dir := t.TempDir()
	linked := session{PanelURL: "https://panel.example.test", Token: "private-session", DeviceID: "device-a"}
	if w := snapshotRequest(snapshotHost(dir, "http://127.0.0.1:1234", session{}), "GET", ""); w.Code != 401 {
		t.Fatal("an unlinked app read saved pages", w.Code)
	}
	if w := savePages(snapshotHost(dir, "http://127.0.0.1:1234", session{}), "any", savedPages); w.Code != 401 {
		t.Fatal("an unlinked app saved pages", w.Code)
	}
	h := snapshotHost(dir, "http://127.0.0.1:1234", linked)
	connection := readPages(t, h).Connection
	if w := savePages(h, connection, savedPages); w.Code != 200 {
		t.Fatal(w.Code)
	}
	for name, body := range map[string]string{
		"not json":      "pages",
		"a list":        `["a"]`,
		"null":          "null",
		"no entries":    `{"connection":"` + connection + `"}`,
		"bare entries":  `{"a":"b"}`,
		"nested values": `{"connection":"` + connection + `","entries":{"a":{"b":1}}}`,
		"too large":     `{"connection":"` + connection + `","entries":{"a":"` + strings.Repeat("x", snapshotLimit) + `"}}`,
	} {
		if w := snapshotRequest(h, "POST", body); w.Code != 422 {
			t.Fatal(name, "was accepted", w.Code)
		}
	}
	if entries := readPages(t, h).Entries; len(entries) != 1 {
		t.Fatal("a rejected save replaced the saved pages", entries)
	}
	if w := snapshotRequest(h, "DELETE", ""); w.Code != 405 {
		t.Fatal(w.Code)
	}
	// A file damaged on disk only costs the head start.
	if err := os.WriteFile(filepath.Join(dir, snapshotFile(linked)), []byte("damaged"), 0600); err != nil {
		t.Fatal(err)
	}
	if entries := readPages(t, h).Entries; len(entries) != 0 {
		t.Fatal(entries)
	}
}

func TestASessionThePanelRejectsTakesItsSavedPagesWithIt(t *testing.T) {
	var rejecting bool
	var mu sync.Mutex
	panel := newBootPanel(t, func(w http.ResponseWriter, r *http.Request) bool {
		mu.Lock()
		defer mu.Unlock()
		if !rejecting {
			return false
		}
		w.WriteHeader(http.StatusUnauthorized)
		return true
	})
	dir := t.TempDir()
	linked := session{PanelURL: panel.URL, Token: "private-session", DeviceID: "device"}
	h := snapshotHost(dir, "http://127.0.0.1:47613", linked)
	before := readPages(t, h).Connection
	if w := savePages(h, before, savedPages); w.Code != 200 {
		t.Fatal(w.Code)
	}
	// An ordinary answer changes nothing.
	if w := bootRequest(h, "GET", "/api/client/account"); w.Code != 200 || len(readPages(t, h).Entries) != 1 {
		t.Fatal("an accepted request disturbed the saved pages", w.Code)
	}
	// The panel revokes the device. The page learns of it from this answer
	// and would clear its copies half a second later; the app may be closed
	// before then, so the host does not wait to be told.
	mu.Lock()
	rejecting = true
	mu.Unlock()
	if w := bootRequest(h, "GET", "/api/client/account"); w.Code != http.StatusUnauthorized {
		t.Fatal(w.Code)
	}
	if _, err := os.Stat(filepath.Join(dir, snapshotFile(linked))); err == nil {
		t.Fatal("the saved pages of a rejected session were left on disk")
	}
	// A save the page had already sent on its way must not put them back.
	if w := savePages(h, before, savedPages); w.Code != http.StatusConflict {
		t.Fatal("a save from before the rejection was accepted", w.Code)
	}
	// Nor is there anything to read, or anything to save under, from then on.
	pendingPages(t, h)
	// The connection itself is still there to be relinked or unlinked.
	if h.current() != linked {
		t.Fatal("a rejected request changed the saved connection")
	}
}

func TestUnlinkingAndRelinkingRemoveTheSavedPagesOnAnyPort(t *testing.T) {
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
	saved := func(dir string, s session) bool {
		_, err := os.Stat(filepath.Join(dir, snapshotFile(s)))
		return err == nil
	}
	save := func(h *desktopHost) string {
		t.Helper()
		connection := readPages(t, h).Connection
		if w := savePages(h, connection, savedPages); w.Code != 200 {
			t.Fatal(w.Code, w.Body.String())
		}
		return connection
	}
	linked := session{PanelURL: panel.URL, Token: "private-session", DeviceID: "device"}

	// Saved on the usual port, unlinked from a launch that fell back to another.
	dir := t.TempDir()
	if save(snapshotHost(dir, "http://127.0.0.1:47613", linked)); !saved(dir, linked) {
		t.Fatal("nothing was saved")
	}
	// A save that was interrupted before it was renamed, and another
	// preference being written at this very moment.
	interrupted, unrelated := filepath.Join(dir, ".pages-123"), filepath.Join(dir, ".preference-456")
	for _, file := range []string{interrupted, unrelated} {
		if err := os.WriteFile(file, []byte("{}"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	h := snapshotHost(dir, "http://127.0.0.1:50123", linked)
	if w := post(h, "/desktop/unlink", "{}"); w.Code != 200 || saved(dir, linked) {
		t.Fatal("unlinking left the account's pages on this computer", w.Code)
	}
	if _, err := os.Stat(interrupted); err == nil {
		t.Fatal("unlinking left an interrupted save of the account's pages")
	}
	if _, err := os.Stat(unrelated); err != nil {
		t.Fatal("unlinking removed a preference that is not a saved page")
	}

	// A connection whose record can no longer be read leaves no pages behind:
	// the next start removes them, and so does unlinking without knowing it.
	dir = t.TempDir()
	orphan := session{PanelURL: panel.URL, Token: "private-session", DeviceID: "lost-device"}
	if save(snapshotHost(dir, "http://127.0.0.1:47613", orphan)); !saved(dir, orphan) {
		t.Fatal("nothing was saved")
	}
	// Making the host deletes nothing: a second launch that is about to hand
	// over to the running instance gets this far too.
	if h = newHost(dir, fstest.MapFS{}); h.current().Token != "" || !saved(dir, orphan) {
		t.Fatal("pages were deleted before this launch was known to be the running instance")
	}
	if h.startBootReads(); saved(dir, orphan) {
		t.Fatal("an app with no readable connection kept an earlier account's pages")
	}
	save(snapshotHost(dir, "http://127.0.0.1:47613", orphan))
	if w := post(snapshotHost(dir, "http://127.0.0.1:47613", linked), "/desktop/unlink", "{}"); w.Code != 200 || saved(dir, orphan) {
		t.Fatal("unlinking left another connection's pages on this computer", w.Code)
	}

	if runtime.GOOS != "windows" {
		t.Skip("Windows protected session required to link")
	}
	dir = t.TempDir()
	h = snapshotHost(dir, "http://127.0.0.1:47613", linked)
	before := save(h)
	link := `{"panel_url":"` + panel.URL + `","code":"` + strings.Repeat("A", 26) + `","name":"Test computer"}`
	if w := post(h, "/desktop/link", link); w.Code != 200 || saved(dir, linked) {
		t.Fatal("linking another connection kept the previous account's pages", w.Code, w.Body.String())
	}
	after := readPages(t, h)
	if len(after.Entries) != 0 || after.Connection == before {
		t.Fatal("the new connection read the previous account's pages", after)
	}
	// The page that was open before the relink still has a save on its way.
	if w := savePages(h, before, savedPages); w.Code != http.StatusConflict {
		t.Fatal("a save made for the previous connection was accepted", w.Code)
	}
	if entries := readPages(t, h).Entries; len(entries) != 0 || saved(dir, linked) {
		t.Fatal("the previous account's pages were written into the new connection's file", entries)
	}
	if w := savePages(h, after.Connection, savedPages); w.Code != 200 {
		t.Fatal("the new connection could not save its own pages", w.Code)
	}
}

func TestSavedPagesAreHandedOverOnlyOnceThePanelHasAcceptedTheConnection(t *testing.T) {
	// A connection can be revoked while the app is closed, or its rejection
	// can have gone unrecorded. A new launch therefore shows nothing saved
	// until the panel has accepted the connection again.
	var accepting, slow bool
	var mu sync.Mutex
	release := make(chan struct{})
	panel := newBootPanel(t, func(w http.ResponseWriter, r *http.Request) bool {
		mu.Lock()
		accept, wait := accepting, slow && r.URL.Path == bootAccountPath
		mu.Unlock()
		if wait {
			<-release
		}
		if accept {
			return false
		}
		w.WriteHeader(http.StatusUnauthorized)
		return true
	})
	dir := t.TempDir()
	linked := session{PanelURL: panel.URL, Token: "private-session", DeviceID: "device"}
	writer := snapshotHost(dir, "http://127.0.0.1:47613", linked)
	if w := savePages(writer, readPages(t, writer).Connection, savedPages); w.Code != 200 {
		t.Fatal(w.Code)
	}

	// The next launch, before the panel has answered anything.
	h := unheardHost(dir, "http://127.0.0.1:47613", linked)
	pendingPages(t, h)
	// Without a name to save under, the page cannot replace what it was not shown.
	if w := savePages(h, "", map[string]string{}); w.Code != http.StatusConflict {
		t.Fatal("a save was accepted before the pages were handed over", w.Code)
	}
	if w := savePages(h, h.connection().id+".0", map[string]string{}); w.Code != http.StatusConflict {
		t.Fatal("a guessed name was accepted before the pages were handed over", w.Code)
	}
	if data, err := os.ReadFile(filepath.Join(dir, snapshotFile(linked))); err != nil || !strings.Contains(string(data), "Survival") {
		t.Fatal("the pages saved earlier did not survive a launch that began unheard", err)
	}
	// The page asks for its pages while the launch's account read is still on
	// its way: the answer waits for it, and follows what the panel says.
	mu.Lock()
	accepting, slow = true, true
	mu.Unlock()
	h = unheardHost(dir, "http://127.0.0.1:47613", linked)
	h.startBootReads()
	defer h.boot.forget()
	answered := make(chan snapshotExchange, 1)
	go func() { answered <- readPages(t, h) }()
	select {
	case early := <-answered:
		t.Fatal("the pages were answered before the panel was heard from", early.Entries)
	case <-time.After(50 * time.Millisecond):
	}
	close(release)
	select {
	case pages := <-answered:
		if len(pages.Entries) != 1 {
			t.Fatal("an accepted connection did not get its saved pages", pages.Entries)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("the pages were never answered")
	}

	// A launch whose reads are answered partly before and partly after the
	// device is revoked. The host hears the refusal before the page asks for
	// anything, so the answers from before it are not replayed.
	var mixed *bootPanel
	mixed = newBootPanel(t, func(w http.ResponseWriter, r *http.Request) bool {
		if r.URL.Path != "/api/client/settings" {
			return false
		}
		// The refusal comes once the account read has reached the panel, so
		// that read is one of the answers from before it.
		for deadline := time.Now().Add(5 * time.Second); mixed.count("GET "+bootAccountPath) == 0 && time.Now().Before(deadline); {
			time.Sleep(time.Millisecond)
		}
		w.WriteHeader(http.StatusUnauthorized)
		return true
	})
	dir = t.TempDir()
	revoked := session{PanelURL: mixed.URL, Token: "private-session", DeviceID: "device"}
	writer = snapshotHost(dir, "http://127.0.0.1:47613", revoked)
	if w := savePages(writer, readPages(t, writer).Connection, savedPages); w.Code != 200 {
		t.Fatal(w.Code)
	}
	h = unheardHost(dir, "http://127.0.0.1:47613", revoked)
	h.startBootReads()
	// Settled by hand: the refusal ends the batch, so there is nothing left to wait on.
	for deadline := time.Now().Add(5 * time.Second); mixed.count("GET /api/client/settings") == 0 || h.boot.offered(); time.Sleep(time.Millisecond) {
		if time.Now().After(deadline) {
			t.Fatal("the launch reads never heard the refusal")
		}
	}
	before := mixed.count("GET " + bootAccountPath)
	if w := bootRequest(h, "GET", bootAccountPath); w.Code != 200 || mixed.count("GET "+bootAccountPath) != before+1 {
		t.Fatal("an answer fetched before the refusal was replayed after it", w.Code, mixed.count("GET "+bootAccountPath)-before)
	}
	if _, err := os.Stat(filepath.Join(dir, snapshotFile(revoked))); err == nil {
		t.Fatal("the refused connection kept its saved pages")
	}
}

// What is in front of a panel can answer 200 to anything: a sign-in page, a
// maintenance notice. Only an answer that names the account shows that the
// panel has taken the connection's credential.
func TestOnlyAnAccountAnswerUnlocksTheSavedPages(t *testing.T) {
	var mu sync.Mutex
	answering := "page"
	account := `{"object":"user","attributes":{"uuid":"user-a","username":"` + strings.Repeat("a", 4096) + `"}}`
	panel := newBootPanel(t, func(w http.ResponseWriter, r *http.Request) bool {
		mu.Lock()
		now := answering
		mu.Unlock()
		switch {
		case now == "page":
			w.Header().Set("Content-Type", "text/html")
			_, _ = io.WriteString(w, "<!doctype html><title>Sign in</title>")
		case now == "nobody" && r.URL.Path == bootAccountPath:
			desktopJSON(w, 200, map[string]any{"attributes": map[string]string{"uuid": ""}})
		case r.URL.Path == bootAccountPath:
			// The page's read, which the host looks into on its way through.
			if r.URL.RawQuery != "" && (r.Header.Get("Accept-Encoding") != "identity" || r.Header.Get("If-None-Match") != "") {
				t.Error("the account read the host checks was not asked for plain and in full:", r.Header.Get("Accept-Encoding"), r.Header.Get("If-None-Match"))
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = io.WriteString(w, account)
		default:
			return false
		}
		return true
	})
	dir := t.TempDir()
	linked := session{PanelURL: panel.URL, Token: "private-session", DeviceID: "device"}
	writer := snapshotHost(dir, "http://127.0.0.1:47613", linked)
	if w := savePages(writer, readPages(t, writer).Connection, savedPages); w.Code != 200 {
		t.Fatal(w.Code)
	}

	// A launch where every read is answered 200 with something else's page.
	h := unheardHost(dir, "http://127.0.0.1:47613", linked)
	h.startBootReads()
	h.boot.settle()
	defer h.boot.forget()
	pendingPages(t, h)
	// The page's own requests are answered the same way, the account read included.
	for _, uri := range []string{"/api/setup/status", "/api/client/servers/test", bootAccountPath, bootAccountPath} {
		if w := bootRequest(h, "GET", uri); w.Code != 200 || !strings.Contains(w.Body.String(), "Sign in") {
			t.Fatal(uri, w.Code, w.Body.String())
		}
	}
	pendingPages(t, h)
	// Nor does an account answer that names no one.
	mu.Lock()
	answering = "nobody"
	mu.Unlock()
	if w := bootRequest(h, "GET", bootAccountPath); w.Code != 200 {
		t.Fatal(w.Code)
	}
	if w := themeRequest(h, "GET", "user-a", ""); w.Code != 502 {
		t.Fatal("the theme was served for an account the panel did not name", w.Code)
	}
	pendingPages(t, h)

	// The panel is back. The page's account read, passing through the host,
	// reaches the page unchanged and is what unlocks the pages.
	mu.Lock()
	answering = "panel"
	mu.Unlock()
	if w := bootRequest(h, "GET", "/api/client/settings"); w.Code != 200 {
		t.Fatal(w.Code)
	}
	pendingPages(t, h)
	// The WebView may hold an earlier answer and ask only whether it changed.
	revalidating := asPage(h, httptest.NewRequest("GET", h.origin+bootAccountPath+"?include=none", nil))
	revalidating.Header.Set("If-None-Match", `"v1"`)
	answer := httptest.NewRecorder()
	h.ServeHTTP(answer, revalidating)
	if answer.Code != 200 || answer.Body.String() != account {
		t.Fatal("the account answer did not reach the page as the panel sent it", answer.Code, answer.Body.Len())
	}
	if entries := readPages(t, h).Entries; len(entries) != 1 {
		t.Fatal("the pages were not handed over once the panel had named the account", entries)
	}

	// The theme's own account lookup is the same evidence.
	h = unheardHost(dir, "http://127.0.0.1:47613", linked)
	pendingPages(t, h)
	if w := themeRequest(h, "GET", "user-a", ""); w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	if entries := readPages(t, h).Entries; len(entries) != 1 {
		t.Fatal("the pages were not handed over after the theme lookup identified the account", entries)
	}

	// A write to the account is not an account read.
	h = unheardHost(dir, "http://127.0.0.1:47613", linked)
	r := asPage(h, httptest.NewRequest("POST", h.origin+bootAccountPath, strings.NewReader("{}")))
	r.Header.Set("Origin", h.origin)
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	pendingPages(t, h)
}

func TestSavedPagesAreRemovedFromTheNamedFolderOnly(t *testing.T) {
	// A profile folder may be named with characters a file pattern reads as
	// wildcards. "Voltra[1]" as a pattern would match the folder "Voltra1".
	base := t.TempDir()
	named, sibling := filepath.Join(base, "Voltra[1]"), filepath.Join(base, "Voltra1")
	for _, dir := range []string{named, sibling} {
		if err := os.MkdirAll(dir, 0700); err != nil {
			t.Fatal(err)
		}
		for _, file := range []string{"pages-abc.json", ".pages-123", "themes.json"} {
			if err := os.WriteFile(filepath.Join(dir, file), []byte("{}"), 0600); err != nil {
				t.Fatal(err)
			}
		}
	}
	if err := removeSnapshots(named); err != nil {
		t.Fatal(err)
	}
	left := func(dir string) string {
		entries, _ := os.ReadDir(dir)
		names := []string{}
		for _, entry := range entries {
			names = append(names, entry.Name())
		}
		return strings.Join(names, " ")
	}
	if left(named) != "themes.json" {
		t.Fatal("the named folder still holds saved pages, or lost something else:", left(named))
	}
	if left(sibling) != ".pages-123 pages-abc.json themes.json" {
		t.Fatal("another folder's files were removed:", left(sibling))
	}
	if err := removeSnapshots(filepath.Join(base, "missing")); err != nil {
		t.Fatal("a folder that does not exist has nothing to remove:", err)
	}
}

func TestThePanelRejectingTheHostsOwnRequestsAlsoRemovesTheSavedPages(t *testing.T) {
	panel := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer panel.Close()
	linked := session{PanelURL: panel.URL, Token: "private-session", DeviceID: "device"}
	// Each of these is a request the host makes to the panel itself. None
	// needs a page to have asked for anything through the ordinary proxy.
	for name, hear := range map[string]func(h *desktopHost){
		"a launch read, before any window exists": func(h *desktopHost) {
			h.startBootReads()
			h.boot.settle()
			// A rejection drops the launch reads before it deletes the pages,
			// all under the host's lock. Taking the lock once waits for one
			// that had only got as far as dropping them.
			h.connection()
		},
		"the console handshake": func(h *desktopHost) {
			r := asPage(h, httptest.NewRequest("GET", h.origin+"/api/client/servers/test/ws", nil))
			r.Header.Set("Origin", h.origin)
			r.Header.Set("Connection", "Upgrade")
			r.Header.Set("Upgrade", "websocket")
			r.Header.Set("Sec-WebSocket-Version", "13")
			r.Header.Set("Sec-WebSocket-Key", "dGhlIHNhbXBsZSBub25jZQ==")
			w := httptest.NewRecorder()
			h.ServeHTTP(w, r)
			if w.Code != http.StatusUnauthorized {
				t.Fatal("the rejected console handshake was reported as", w.Code)
			}
		},
		"the theme's account lookup": func(h *desktopHost) {
			if w := themeRequest(h, "GET", "user-a", ""); w.Code != 502 {
				t.Fatal(w.Code, w.Body.String())
			}
		},
	} {
		dir := t.TempDir()
		h := snapshotHost(dir, "http://127.0.0.1:47613", linked)
		before := readPages(t, h).Connection
		if w := savePages(h, before, savedPages); w.Code != 200 {
			t.Fatal(name, w.Code)
		}
		hear(h)
		h.boot.forget()
		if _, err := os.Stat(filepath.Join(dir, snapshotFile(linked))); err == nil {
			t.Fatal(name, "heard the panel reject the connection and left its saved pages on disk")
		}
		if w := savePages(h, before, savedPages); w.Code != http.StatusConflict {
			t.Fatal(name, "accepted a save from before the rejection:", w.Code)
		}
		if _, err := os.Stat(filepath.Join(dir, snapshotsRejected)); err == nil {
			t.Fatal(name, "left the cleanup marked as unfinished")
		}
	}
}

func TestRejectedPagesThatCannotBeDeletedAreNeitherReadNorWrittenOver(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("needs a system that refuses to delete a file another handle holds open")
	}
	// The premise, checked on a file of no consequence.
	probe := filepath.Join(t.TempDir(), "probe")
	if err := os.WriteFile(probe, nil, 0600); err != nil {
		t.Fatal(err)
	}
	held, err := os.Open(probe)
	if err != nil {
		t.Fatal(err)
	}
	removable := os.Remove(probe) == nil
	_ = held.Close()
	if removable {
		t.Skip("this system deletes a file that is open elsewhere")
	}

	var rejecting bool
	var mu sync.Mutex
	panel := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		if rejecting {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		desktopJSON(w, 200, map[string]any{"attributes": map[string]string{"uuid": "user-a"}})
	}))
	defer panel.Close()
	dir := t.TempDir()
	linked := session{PanelURL: panel.URL, Token: "vdt_" + strings.Repeat("d", 64), DeviceID: "device"}
	if err := saveSession(dir, linked); err != nil {
		t.Fatal(err)
	}
	h := snapshotHost(dir, "http://127.0.0.1:47613", linked)
	before := readPages(t, h).Connection
	if w := savePages(h, before, savedPages); w.Code != 200 {
		t.Fatal(w.Code)
	}
	// Something else, a scanner perhaps, holds the file open when the panel
	// rejects the connection.
	file := filepath.Join(dir, snapshotFile(linked))
	if held, err = os.Open(file); err != nil {
		t.Fatal(err)
	}
	mu.Lock()
	rejecting = true
	mu.Unlock()
	r := asPage(h, httptest.NewRequest("GET", h.origin+"/api/client/account", nil))
	r.Header.Set("Authorization", "ignored")
	w := httptest.NewRecorder()
	h.forward(w, r, h.connection())
	if w.Code != http.StatusUnauthorized {
		t.Fatal(w.Code)
	}
	if _, err := os.Stat(file); err != nil {
		t.Fatal("the premise failed: the held file was deleted")
	}
	// The pages are still on disk, but they are no longer anyone's to read,
	// and nothing can be saved for a connection the panel has refused.
	pendingPages(t, h)
	if w := savePages(h, before, savedPages); w.Code != http.StatusConflict {
		t.Fatal("new pages were written while the rejected ones were still there", w.Code)
	}
	// The app is closed and started again with the connection still saved,
	// and this time the panel accepts it: the device was restored, say. The
	// pages from before the refusal are still not that connection's to read.
	mu.Lock()
	rejecting = false
	mu.Unlock()
	restarted := newHost(dir, fstest.MapFS{})
	restarted.origin, restarted.launch = h.origin, "launch"
	restarted.startBootReads()
	restarted.boot.settle()
	defer restarted.boot.forget()
	if restarted.current().DeviceID != linked.DeviceID {
		t.Fatal("the saved connection was not restored")
	}
	stuck := readPages(t, restarted)
	if len(stuck.Entries) != 0 {
		t.Fatal("a restart made the rejected pages readable again", stuck.Entries)
	}
	if w := savePages(restarted, stuck.Connection, savedPages); w.Code != 500 {
		t.Fatal("new pages were written over the rejected ones that could not be deleted", w.Code)
	}
	// Once the other handle lets go, the next request finishes the job.
	_ = held.Close()
	if entries := readPages(t, restarted).Entries; len(entries) != 0 {
		t.Fatal(entries)
	}
	for _, leftover := range []string{file, filepath.Join(dir, snapshotsRejected)} {
		if _, err := os.Stat(leftover); err == nil {
			t.Fatal("left after the cleanup could finish:", filepath.Base(leftover))
		}
	}
	if w := savePages(restarted, readPages(t, restarted).Connection, savedPages); w.Code != 200 {
		t.Fatal("pages could not be saved again after the cleanup", w.Code)
	}
}
