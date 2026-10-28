package main

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync/atomic"
	"testing"
	"testing/fstest"
	"time"

	"github.com/gorilla/websocket"
)

func TestDesktopProxyCompressedWebsocketMetadata(t *testing.T) {
	remote := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/client/servers/test/websocket" && r.Header.Get("Accept-Encoding") != "identity" {
			t.Error("rewritten metadata did not request identity encoding")
		}
		if r.URL.Path == "/api/client/artwork/test.png" && r.Header.Get("Accept-Encoding") != "gzip, deflate, br" {
			t.Error("ordinary proxy encoding changed")
		}
		if r.Header.Get("Authorization") != "Bearer test-device-credential" || r.Header.Get("Cookie") != "" {
			t.Error("proxy credential isolation changed")
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Content-Encoding", "gzip")
		compressed := gzip.NewWriter(w)
		defer compressed.Close()
		_, _ = io.WriteString(compressed, `{"data":{"token":"test-console-signature","socket":"wss://panel.example/api/client/servers/test/ws?signature=test"}}`)
	}))
	defer remote.Close()
	h := &desktopHost{session: session{PanelURL: remote.URL, Token: "test-device-credential"}}
	req := httptest.NewRequest("GET", "http://localhost/api/client/servers/test/websocket", nil)
	req.Header.Set("Accept-Encoding", "gzip, deflate, br")
	req.Header.Set("Cookie", "local-only=test")
	w := httptest.NewRecorder()
	h.proxy(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("compressed metadata returned %d", w.Code)
	}
	var result struct {
		Data map[string]string `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.Data["socket"] != "/api/client/servers/test/ws?signature=test" || result.Data["token"] != "test-console-signature" {
		t.Fatal("metadata path or signature changed")
	}
	if w.Header().Get("Content-Encoding") != "" {
		t.Fatal("rewritten metadata still marked compressed")
	}
	req = httptest.NewRequest("GET", "http://localhost/api/client/artwork/test.png", nil)
	req.Header.Set("Accept-Encoding", "gzip, deflate, br")
	w = httptest.NewRecorder()
	h.proxy(w, req)
	if w.Code != http.StatusOK || w.Header().Get("Content-Encoding") != "gzip" {
		t.Fatal("ordinary compressed response was changed")
	}
	compressed, err := gzip.NewReader(w.Body)
	if err != nil {
		t.Fatal(err)
	}
	defer compressed.Close()
	body, err := io.ReadAll(compressed)
	if err != nil || !bytes.Contains(body, []byte("wss://panel.example/")) {
		t.Fatal("ordinary response body was rewritten")
	}
}

func TestDesktopProtectedSession(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("Windows DPAPI test")
	}
	dir := t.TempDir()
	want := session{PanelURL: "https://panel.example.test", Token: "vdt_" + strings.Repeat("a", 64), DeviceID: "device", Name: "Desktop"}
	if err := saveSession(dir, want); err != nil {
		t.Fatal(err)
	}
	stored, err := os.ReadFile(filepath.Join(dir, "connection.dat"))
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(stored, []byte(want.Token)) || bytes.Contains(stored, []byte(want.PanelURL)) {
		t.Fatal("connection saved in plaintext")
	}
	got, err := loadSession(dir)
	if err != nil || got != want {
		t.Fatalf("restart restore failed: %v", err)
	}
	want.Name = "Renamed"
	if err := saveSession(dir, want); err != nil {
		t.Fatal("replace saved session", err)
	}
	got, err = loadSession(dir)
	if err != nil || got != want {
		t.Fatal("replacement restore failed", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "connection.dat"), []byte("corrupted"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err = loadSession(dir); err == nil {
		t.Fatal("corrupt protected session accepted")
	}
}

func TestDesktopPanelAddresses(t *testing.T) {
	for _, raw := range []string{"http://127.0.0.1:8088", "http://[::1]:8088", "http://localhost:8088", "https://panel.example.test/"} {
		if _, err := panelURL(raw); err != nil {
			t.Errorf("valid address rejected %s", raw)
		}
	}
	for _, raw := range []string{"http://panel.example.test", "https://user:secret@example.test", "https://example.test/path", "https://example.test?token=x", "file:///tmp/a", "https://example.test#fragment"} {
		if _, err := panelURL(raw); err == nil {
			t.Errorf("invalid address accepted %s", raw)
		}
	}
}

func TestDesktopHostPairProxySocketsAndUnlink(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("Windows protected session required")
	}
	token := "vdt_" + strings.Repeat("b", 64)
	var revocations atomic.Int32
	remote := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/desktop/exchange" {
			var input map[string]string
			if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
				t.Error(err)
			}
			if input["code"] != strings.Repeat("A", 26) || input["name"] != "Test computer" {
				t.Error("pairing fields were not sent")
			}
			desktopJSON(w, 201, map[string]any{"attributes": map[string]string{"token": token, "device_id": "test-device"}})
			return
		}
		if r.Header.Get("Authorization") != "Bearer "+token {
			t.Error("native credential missing from proxy")
		}
		if r.Header.Get("Cookie") != "" || r.Header.Get("X-Dev-User-ID") != "" || r.Header.Get("X-Forwarded-For") != "" {
			t.Error("browser identity leaked upstream")
		}
		switch r.URL.Path {
		case "/api/client/servers/test/websocket":
			desktopJSON(w, 200, map[string]any{"data": map[string]string{"token": "console-jwt", "socket": "ws://example.test/api/client/servers/test/ws"}})
		case "/api/client/servers/test/ws":
			up := websocket.Upgrader{CheckOrigin: func(r *http.Request) bool { return true }}
			c, err := up.Upgrade(w, r, nil)
			if err != nil {
				t.Error(err)
				return
			}
			defer c.Close()
			kind, message, err := c.ReadMessage()
			if err != nil {
				return
			}
			_ = c.WriteMessage(kind, message)
		case "/api/client/account/desktop/devices/test-device":
			revocations.Add(1)
			w.WriteHeader(204)
		case "/api/download":
			w.Header().Set("Content-Disposition", "attachment; filename=test.txt")
			_, _ = w.Write([]byte("download-data"))
		case "/api/client/artwork/catalog":
			desktopJSON(w, 200, map[string]any{"server": map[string]string{"rust": "/api/client/artwork/test.png"}})
		case "/api/client/artwork/test.png":
			w.Header().Set("Content-Type", "image/png")
			w.Header().Set("Cache-Control", "private, max-age=86400")
			w.Header().Set("ETag", `"library-image"`)
			w.WriteHeader(http.StatusNotModified)
		case "/api/client/servers/test/artwork/icon":
			w.Header().Set("ETag", `"server-icon"`)
			w.WriteHeader(http.StatusNotModified)
		case "/api/upload":
			body, _ := io.ReadAll(r.Body)
			_, _ = w.Write(body)
		case "/api/rejected":
			w.WriteHeader(401)
		case "/api/redirect":
			w.Header().Set("Location", "https://elsewhere.example.test")
			w.WriteHeader(302)
		default:
			desktopJSON(w, 200, map[string]bool{"ok": true})
		}
	}))
	defer remote.Close()
	dir := t.TempDir()
	h := newHost(dir, fstest.MapFS{"index.html": &fstest.MapFile{Data: []byte("<html>Voltra</html>")}})
	launch, closeHost, err := h.start()
	if err != nil {
		t.Fatal(err)
	}
	defer closeHost()
	jar, _ := cookiejar.New(nil)
	client := &http.Client{Jar: jar, Timeout: 5 * time.Second}
	request := func(method, path, origin string, body any) (int, []byte) {
		t.Helper()
		var encoded []byte
		if body != nil {
			encoded, _ = json.Marshal(body)
		}
		req, _ := http.NewRequest(method, h.origin+path, bytes.NewReader(encoded))
		req.Header.Set("Origin", origin)
		resp, err := client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		b, _ := io.ReadAll(resp.Body)
		return resp.StatusCode, b
	}
	if status, _ := request("GET", "/desktop/status", "", nil); status != 403 {
		t.Fatal("desktop host allowed a browser without its launch cookie")
	}
	resp, err := client.Get(launch)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if status, _ := request("POST", "/desktop/link", "https://attacker.example.test", nil); status != 403 {
		t.Fatal("cross-origin desktop link accepted")
	}
	status, b := request("POST", "/desktop/link", h.origin, map[string]string{"panel_url": remote.URL, "code": strings.Repeat("a", 26), "name": "Test computer"})
	if status != 200 {
		t.Fatalf("link failed %d %s", status, b)
	}
	status, b = request("GET", "/desktop/status", "", nil)
	if status != 200 || bytes.Contains(b, []byte(token)) || !bytes.Contains(b, []byte(`"linked":true`)) {
		t.Fatal("desktop status leaks credential or lost connection")
	}
	restored := newHost(dir, h.assets)
	if restored.current().Token != token {
		t.Fatal("saved native connection did not restore")
	}
	// A fresh native launch requires a fresh local cookie even with a saved session.
	_, stopRestored, err := restored.start()
	if err != nil {
		t.Fatal(err)
	}
	stopRestored()
	if status, _ = request("GET", "/account/desktop", "", nil); status != 200 {
		t.Fatal("SPA route refresh failed")
	}
	req, _ := http.NewRequest("POST", h.origin+"/api/upload", strings.NewReader(strings.Repeat("streamed", 1024)))
	req.Header.Set("Origin", h.origin)
	req.Header.Set("X-Dev-User-ID", "1")
	req.Header.Set("X-Forwarded-For", "spoofed")
	req.Header.Set("Authorization", "Bearer spoofed")
	resp, err = client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	b, _ = io.ReadAll(resp.Body)
	_ = resp.Body.Close()
	if len(b) != len("streamed")*1024 {
		t.Fatal("upload did not stream through")
	}
	status, b = request("GET", "/api/download", "", nil)
	if status != 200 || string(b) != "download-data" {
		t.Fatal("download proxy failed")
	}
	if status, b = request("GET", "/api/client/artwork/catalog", "", nil); status != 200 || !bytes.Contains(b, []byte("/api/client/artwork/test.png")) {
		t.Fatal("artwork catalog proxy failed")
	}
	if status, _ = request("GET", "/api/client/artwork/test.png", "", nil); status != http.StatusNotModified {
		t.Fatal("library image proxy failed")
	}
	if status, b = request("GET", "/api/client/servers/test/artwork/icon", "", nil); status != http.StatusNotModified || len(b) != 0 {
		t.Fatal("Unchanged server artwork did not pass through the desktop proxy")
	}
	status, b = request("GET", "/api/client/servers/test/websocket", "", nil)
	if status != 200 || !bytes.Contains(b, []byte(`"socket":"/api/client/servers/test/ws"`)) {
		t.Fatal("console address was not rewritten")
	}
	u, _ := url.Parse(h.origin)
	headers := http.Header{}
	headers.Set("Origin", h.origin)
	for _, cookie := range jar.Cookies(u) {
		headers.Add("Cookie", cookie.String())
	}
	c, resp, err := websocket.DefaultDialer.Dial("ws://"+u.Host+"/api/client/servers/test/ws", headers)
	if err != nil {
		t.Fatal("native console socket", err)
	}
	defer c.Close()
	if err = c.WriteMessage(websocket.TextMessage, []byte("console-command")); err != nil {
		t.Fatal(err)
	}
	_ = c.SetReadDeadline(time.Now().Add(3 * time.Second))
	_, b, err = c.ReadMessage()
	if err != nil || string(b) != "console-command" {
		t.Fatal("bidirectional console failed", err)
	}
	if status, _ = request("GET", "/api/rejected", "", nil); status != 401 {
		t.Fatal("revoked credential error was hidden")
	}
	if status, _ = request("GET", "/api/redirect", "", nil); status != 502 {
		t.Fatal("remote redirect followed")
	}
	if status, _ = request("POST", "/api/auth/logout", h.origin, map[string]string{}); status != 200 {
		t.Fatal("native sign out failed")
	}
	if _, err = os.Stat(filepath.Join(dir, "connection.dat")); !os.IsNotExist(err) {
		t.Fatal("saved connection survived unlink")
	}
	deadline := time.Now().Add(2 * time.Second)
	for revocations.Load() == 0 && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if revocations.Load() != 1 {
		t.Fatal("unlink did not revoke remote device")
	}
	if status, _ = request("GET", "/api/client/account", "", nil); status != 401 {
		t.Fatal("proxy stayed authenticated after unlink")
	}
}
