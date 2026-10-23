package panel

import (
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestServeWebAssetsAndRoutes(t *testing.T) {
	root := t.TempDir()
	if err := os.Mkdir(filepath.Join(root, "assets"), 0755); err != nil {
		t.Fatal(err)
	}
	for name, body := range map[string]string{"index.html": "<!doctype html><title>Voltra</title>", "assets/Admin-current.js": "export const ready=true;"} {
		if err := os.WriteFile(filepath.Join(root, name), []byte(body), 0644); err != nil {
			t.Fatal(err)
		}
	}
	a := &App{Config: Config{WebDir: root}}
	for _, tc := range []struct {
		path   string
		status int
		html   bool
	}{
		{"/", 200, true}, {"/admin/nodes", 200, true}, {"/server/abcd/files", 200, true},
		{"/assets/Admin-current.js", 200, false},
		{"/assets/Admin-old.js", 404, false}, {"/assets/Admin-old.css", 404, false},
		{"/assets/missing", 404, false}, {"/artwork/missing.webp", 404, false},
	} {
		t.Run(tc.path, func(t *testing.T) {
			w := httptest.NewRecorder()
			a.serveWeb(w, httptest.NewRequest("GET", tc.path, nil))
			if w.Code != tc.status {
				t.Fatalf("status=%d want %d", w.Code, tc.status)
			}
			if got := strings.Contains(w.Body.String(), "<!doctype html>"); got != tc.html {
				t.Fatalf("SPA HTML=%v want %v", got, tc.html)
			}
			if tc.html && w.Header().Get("Cache-Control") != "no-cache" {
				t.Fatal("HTML must revalidate to discover the current build")
			}
			if tc.status == 404 && w.Header().Get("Cache-Control") != "no-store" {
				t.Fatal("missing assets must not be cached across publication")
			}
		})
	}
}
