package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestResumeSurvivesHostRestartAndIsolatesConnections(t *testing.T) {
	dir := t.TempDir()
	s := session{PanelURL: "https://panel.example", DeviceID: "first", Token: "linked"}
	h := &desktopHost{dir: dir, session: s}
	// page is a request from the page loaded for the host's connection as it is now.
	page := func(method, body string) *http.Request {
		r := httptest.NewRequest(method, "/desktop/resume", strings.NewReader(body))
		r.AddCookie(&http.Cookie{Name: pageCookie, Value: h.connection().id})
		return r
	}
	w := httptest.NewRecorder()
	h.serveResume(w, page("POST", `{"path":"/server/abc/files"}`))
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	h = &desktopHost{dir: dir, session: s}
	get := func() string {
		w := httptest.NewRecorder()
		h.serveResume(w, page("GET", ""))
		return w.Body.String()
	}
	if !strings.Contains(get(), "/server/abc/files") {
		t.Fatal("route lost after restart")
	}
	h.session.DeviceID = "other"
	if strings.Contains(get(), "/server/") {
		t.Fatal("route leaked into another linked account")
	}
	h.session.DeviceID = "first"
	h.session.PanelURL = "https://other.example"
	if strings.Contains(get(), "/server/") {
		t.Fatal("route leaked into another panel")
	}
}

func TestResumeRejectsExternalAndSensitiveURLs(t *testing.T) {
	for _, path := range []string{"//evil.example", "/account?token=secret", "/api/auth/logout", "/desktop/unlink", "/server/../admin", "/account#secret"} {
		if resumePath.MatchString(path) {
			t.Errorf("accepted %q", path)
		}
	}
	h := &desktopHost{dir: t.TempDir()}
	w := httptest.NewRecorder()
	h.serveResume(w, httptest.NewRequest("GET", "/desktop/resume", nil))
	if w.Code != 401 {
		t.Fatal("unlinked access accepted")
	}
}
