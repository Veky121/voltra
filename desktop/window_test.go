package main

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestWindowControlsAllowlistAndState(t *testing.T) {
	h := &desktopHost{origin: "http://127.0.0.1:12345", launch: "test-cookie"}
	var actions []string
	maximized := false
	h.setWindowControl(func(action string) (bool, error) {
		actions = append(actions, action)
		if action == "maximize" {
			maximized = !maximized
		}
		return maximized, nil
	})
	for _, tc := range []struct{ method, path, body string }{
		{"GET", "/desktop/window", "false"},
		{"POST", "/desktop/window/maximize", "true"},
		{"POST", "/desktop/window/maximize", "false"},
		{"POST", "/desktop/window/minimize", "false"},
		{"POST", "/desktop/window/drag", "false"},
		{"POST", "/desktop/window/close", "false"},
	} {
		w := windowRequest(h, tc.method, tc.path, true, h.origin, "same-origin")
		if w.Code != 200 || strings.TrimSpace(w.Body.String()) != `{"maximized":`+tc.body+`}` {
			t.Fatalf("%s %s: %d %s", tc.method, tc.path, w.Code, w.Body.String())
		}
	}
	if strings.Join(actions, ",") != "state,maximize,maximize,minimize,drag,close" {
		t.Fatal(actions)
	}
	for _, tc := range []struct{ method, path string }{
		{"POST", "/desktop/window/eval"}, {"POST", "/desktop/window/minimise"},
		{"GET", "/desktop/window/close"}, {"DELETE", "/desktop/window"},
		{"POST", "/desktop/window"}, {"POST", "/desktop/window/maximize/extra"},
	} {
		if w := windowRequest(h, tc.method, tc.path, true, h.origin, ""); w.Code != 404 {
			t.Fatalf("invalid route accepted: %+v: %d", tc, w.Code)
		}
	}
	if len(actions) != 6 {
		t.Fatal("unknown route dispatched native callback", actions)
	}
}

func TestWindowControlsSecurityAndErrors(t *testing.T) {
	h := &desktopHost{origin: "http://127.0.0.1:12345", launch: "test-cookie"}
	for _, method := range []string{"GET", "POST"} {
		path := "/desktop/window"
		if method == "POST" {
			path += "/close"
		}
		for _, tc := range []struct {
			cookie       bool
			origin, site string
		}{
			{false, h.origin, ""}, {true, "https://evil.example", ""}, {true, h.origin, "cross-site"},
		} {
			if w := windowRequest(h, method, path, tc.cookie, tc.origin, tc.site); w.Code != 403 {
				t.Fatalf("security check bypassed: %+v: %d", tc, w.Code)
			}
		}
	}
	if w := windowRequest(h, "GET", "/desktop/window", true, "", ""); w.Code != 503 {
		t.Fatal("missing callback", w.Code)
	}
	h.setWindowControl(func(string) (bool, error) { return false, errors.New("private native detail") })
	w := windowRequest(h, "POST", "/desktop/window/maximize", true, h.origin, "")
	if w.Code != 500 || strings.Contains(w.Body.String(), "private") {
		t.Fatal("callback error not generic", w.Code, w.Body.String())
	}
}

func TestWindowControlsNeverProxyToPanel(t *testing.T) {
	calls := 0
	panel := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { calls++ }))
	defer panel.Close()
	h := &desktopHost{origin: "http://127.0.0.1:12345", launch: "test-cookie", session: session{PanelURL: panel.URL, Token: "linked"}}
	h.setWindowControl(func(string) (bool, error) { return false, nil })
	for _, path := range []string{"/desktop/window/maximize", "/desktop/window/arbitrary"} {
		windowRequest(h, "POST", path, true, h.origin, "")
	}
	if calls != 0 {
		t.Fatal("window request reached panel")
	}
}

func windowRequest(h *desktopHost, method, path string, cookie bool, origin, site string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, h.origin+path, nil)
	if cookie {
		r.AddCookie(&http.Cookie{Name: "voltra_desktop", Value: h.launch})
	}
	r.Header.Set("Origin", origin)
	r.Header.Set("Sec-Fetch-Site", site)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}
