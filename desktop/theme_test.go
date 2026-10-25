package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
)

const sampleTheme = `{"version":1,"backgroundA":"#1b202b","backgroundB":"#141820","accentA":"#4d78c9","accentB":"#326f73","backgroundGradient":true,"accentGradient":false}`

func themeRequest(h *desktopHost, method, account, body string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, h.origin+"/desktop/theme", strings.NewReader(body))
	r.Header.Set("Origin", h.origin)
	r.Header.Set("X-Voltra-Account", account)
	r.AddCookie(&http.Cookie{Name: "voltra_desktop", Value: h.launch})
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}
func TestThemePersistsAcrossDesktopOriginsAndIsolatesAccountsAndPanels(t *testing.T) {
	account := "user-a"
	panel := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/client/account" || r.Header.Get("Authorization") != "Bearer private-session" {
			t.Error("invalid account lookup")
			http.Error(w, "invalid", 401)
			return
		}
		desktopJSON(w, 200, map[string]any{"attributes": map[string]string{"uuid": account}})
	}))
	defer panel.Close()
	dir := t.TempDir()
	host := func(origin string) *desktopHost {
		h := newHost(dir, fstest.MapFS{})
		h.origin = origin
		h.launch = "launch"
		h.session = session{PanelURL: panel.URL, Token: "private-session"}
		return h
	}
	h := host("http://127.0.0.1:1234")
	if w := themeRequest(h, "POST", account, sampleTheme); w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	// An atomic replacement must work on Windows, too.
	glassTheme := strings.TrimSuffix(sampleTheme, "}") + `,"glassCards":true,"cardOpacity":57}`
	if w := themeRequest(h, "POST", account, glassTheme); w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	h = host("http://127.0.0.1:5678")
	if w := themeRequest(h, "GET", account, ""); w.Code != 200 || !strings.Contains(w.Body.String(), `"cardOpacity":57`) || !strings.Contains(w.Body.String(), `"glassCards":true`) {
		t.Fatal("glass preferences lost on restart", w.Code, w.Body.String())
	}
	if w := themeRequest(h, "GET", account, ""); w.Code != 200 || !strings.Contains(w.Body.String(), `"accentA":"#4d78c9"`) {
		t.Fatal("theme lost on restart", w.Code, w.Body.String())
	}
	account = "user-b"
	if w := themeRequest(h, "GET", account, ""); w.Code != 200 || !strings.Contains(w.Body.String(), `"theme":null`) {
		t.Fatal("account theme leaked", w.Code, w.Body.String())
	}
	if w := themeRequest(h, "POST", "user-a", sampleTheme); w.Code != 409 {
		t.Fatal("account mismatch accepted", w.Code)
	}
	account = "user-a"
	h.session.PanelURL = panel.URL + "/other-panel"
	// Test namespace isolation against the same authenticated account on another panel URL.
	second := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		desktopJSON(w, 200, map[string]any{"attributes": map[string]string{"uuid": account}})
	}))
	defer second.Close()
	h.session.PanelURL = second.URL
	if w := themeRequest(h, "GET", account, ""); w.Code != 200 || !strings.Contains(w.Body.String(), `"theme":null`) {
		t.Fatal("panel theme leaked", w.Code, w.Body.String())
	}
	data, err := os.ReadFile(filepath.Join(dir, "themes.json"))
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(data, []byte("private-session")) || bytes.Contains(data, []byte(panel.URL)) || bytes.Contains(data, []byte(account)) {
		t.Fatal("theme file contains identity or credentials")
	}
}
func TestThemeValidationAndHostGuards(t *testing.T) {
	panel := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		desktopJSON(w, 200, map[string]any{"attributes": map[string]string{"uuid": "user"}})
	}))
	defer panel.Close()
	h := newHost(t.TempDir(), fstest.MapFS{})
	h.origin = "http://127.0.0.1:1234"
	h.launch = "launch"
	h.session = session{PanelURL: panel.URL, Token: "private-session"}
	for _, body := range []string{`{}`, `null`, strings.Replace(sampleTheme, "#4d78c9", "red", 1), strings.Replace(sampleTheme, `"version":1`, `"version":2`, 1), sampleTheme + `{}`, strings.Replace(sampleTheme, `"accentGradient":false`, `"accentGradient":false,"extra":true`, 1), strings.Repeat(" ", 4097) + sampleTheme} {
		if w := themeRequest(h, "POST", "user", body); w.Code != 422 {
			t.Fatalf("invalid theme accepted: %d", w.Code)
		}
	}
	if w := themeRequest(h, "POST", "user", sampleTheme); w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	if w := themeRequest(h, "DELETE", "user", ""); w.Code != 405 {
		t.Fatal(w.Code)
	}
	r := httptest.NewRequest("GET", h.origin+"/desktop/theme", nil)
	r.AddCookie(&http.Cookie{Name: "voltra_desktop", Value: h.launch})
	r.Header.Set("Origin", "https://foreign.test")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 403 {
		t.Fatal("cross-origin accepted")
	}
	r = httptest.NewRequest("GET", h.origin+"/desktop/theme", nil)
	w = httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 403 {
		t.Fatal("unauthenticated launch accepted")
	}
	h.session = session{}
	if w := themeRequest(h, "GET", "user", ""); w.Code != 401 {
		t.Fatal("unlinked account accepted")
	}
	data, _ := os.ReadFile(filepath.Join(h.dir, "themes.json"))
	var saved map[string]themePreferences
	if json.Unmarshal(data, &saved) != nil || len(saved) != 1 {
		t.Fatal("invalid requests damaged stored themes")
	}
}
