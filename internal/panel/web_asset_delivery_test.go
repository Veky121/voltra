package panel

import (
	"bytes"
	"compress/gzip"
	"io"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestServeWebPrecompressedAssets(t *testing.T) {
	root := t.TempDir()
	if err := os.Mkdir(filepath.Join(root, "assets"), 0755); err != nil {
		t.Fatal(err)
	}
	const path = "/assets/Client-Ab12cd34.js"
	body := []byte(strings.Repeat("export const ready=true;\n", 100))
	if err := os.WriteFile(filepath.Join(root, path), body, 0644); err != nil {
		t.Fatal(err)
	}
	var compressed bytes.Buffer
	zw := gzip.NewWriter(&compressed)
	_, _ = zw.Write(body)
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, path)+".gz", compressed.Bytes(), 0644); err != nil {
		t.Fatal(err)
	}
	a := &App{Config: Config{WebDir: root}}
	for _, accept := range []string{"gzip, br", "gzip;q=0", "br", "*;q=1", "*;q=1, gzip;q=0", "gzip;q=bad"} {
		t.Run(accept, func(t *testing.T) {
			r := httptest.NewRequest("GET", path, nil)
			r.Header.Set("Accept-Encoding", accept)
			w := httptest.NewRecorder()
			a.serveWeb(w, r)
			if w.Code != 200 || !strings.Contains(w.Header().Get("Content-Type"), "javascript") {
				t.Fatalf("response %d %v", w.Code, w.Header())
			}
			if w.Header().Get("Cache-Control") != "public, max-age=31536000, immutable" || w.Header().Get("Vary") != "Accept-Encoding" {
				t.Fatal(w.Header())
			}
			got := w.Body.Bytes()
			if acceptsGzip(accept) {
				if w.Header().Get("Content-Encoding") != "gzip" {
					t.Fatal("gzip was not served")
				}
				zr, err := gzip.NewReader(bytes.NewReader(got))
				if err != nil {
					t.Fatal(err)
				}
				got, err = io.ReadAll(zr)
				if err != nil {
					t.Fatal(err)
				}
				_ = zr.Close()
			} else if w.Header().Get("Content-Encoding") != "" {
				t.Fatal("gzip served despite exclusion")
			}
			if !bytes.Equal(got, body) {
				t.Fatal("representation differs")
			}
		})
	}
	r := httptest.NewRequest("HEAD", path, nil)
	r.Header.Set("Accept-Encoding", "gzip")
	w := httptest.NewRecorder()
	a.serveWeb(w, r)
	if w.Body.Len() != 0 || w.Header().Get("Content-Encoding") != "gzip" {
		t.Fatal("HEAD must retain gzip headers without a body")
	}
	if err := os.Remove(filepath.Join(root, path) + ".gz"); err != nil {
		t.Fatal(err)
	}
	w = httptest.NewRecorder()
	r = httptest.NewRequest("GET", path, nil)
	r.Header.Set("Accept-Encoding", "gzip")
	a.serveWeb(w, r)
	if w.Header().Get("Content-Encoding") != "" || !bytes.Equal(w.Body.Bytes(), body) {
		t.Fatal("older builds must fall back to uncompressed assets")
	}
}

func TestAcceptsGzip(t *testing.T) {
	for _, tc := range []struct {
		value string
		want  bool
	}{
		{"gzip", true}, {"GZIP; q=0.2", true}, {"", false}, {"br", false}, {"gzip;q=0", false}, {"*", true}, {"*;q=0", false}, {"gzip;q=0,*", false}, {"gzip;q=2", false}, {"gzip;q=oops", false},
	} {
		if got := acceptsGzip(tc.value); got != tc.want {
			t.Errorf("%q=%v want %v", tc.value, got, tc.want)
		}
	}
}

func TestServeWebCachesShippedMediaButNotTheShell(t *testing.T) {
	root := t.TempDir()
	files := map[string]string{
		"/game-artwork/rust.webp": "public, max-age=86400, stale-while-revalidate=604800",
		"/game-icons/paper.png":   "public, max-age=86400, stale-while-revalidate=604800",
		"/fonts/inter.woff2":      "public, max-age=86400, stale-while-revalidate=604800",
		"/index.html":             "no-cache",
		"/startup.js":             "no-cache",
		"/manifest.json":          "no-cache",
	}
	for path := range files {
		name := filepath.Join(root, filepath.FromSlash(path))
		if err := os.MkdirAll(filepath.Dir(name), 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(name, []byte("content"), 0644); err != nil {
			t.Fatal(err)
		}
	}
	a := &App{Config: Config{WebDir: root}}
	for path, want := range files {
		w := httptest.NewRecorder()
		a.serveWeb(w, httptest.NewRequest("GET", path, nil))
		if got := w.Header().Get("Cache-Control"); (w.Code != 200 && w.Code != 301) || got != want {
			t.Fatalf("%s: status %d, Cache-Control %q, want %q", path, w.Code, got, want)
		}
	}
}

func TestServeWebPrefersBrotliAssets(t *testing.T) {
	root := t.TempDir()
	if err := os.Mkdir(filepath.Join(root, "assets"), 0755); err != nil {
		t.Fatal(err)
	}
	name := filepath.Join(root, "assets", "Client-Ab12cd34.js")
	// One build writes all three; give them one time, so none looks older than its file.
	built := time.Now().Add(-time.Minute)
	for suffix, content := range map[string]string{"": "identity", ".gz": "gzip-bytes", ".br": "brotli-bytes"} {
		if err := os.WriteFile(name+suffix, []byte(content), 0644); err != nil {
			t.Fatal(err)
		}
		if err := os.Chtimes(name+suffix, built, built); err != nil {
			t.Fatal(err)
		}
	}
	a := &App{Config: Config{WebDir: root}}
	get := func(accept string) *httptest.ResponseRecorder {
		r := httptest.NewRequest("GET", "/assets/Client-Ab12cd34.js", nil)
		r.Header.Set("Accept-Encoding", accept)
		w := httptest.NewRecorder()
		a.serveWeb(w, r)
		return w
	}
	for accept, want := range map[string]string{
		"gzip, deflate, br": "br", "br": "br", "*": "br", "gzip": "gzip", "br;q=0, gzip": "gzip", "br;q=0, *": "gzip", "": "", "identity": "",
	} {
		w := get(accept)
		body := map[string]string{"br": "brotli-bytes", "gzip": "gzip-bytes", "": "identity"}[want]
		if w.Code != 200 || w.Header().Get("Content-Encoding") != want || w.Body.String() != body || w.Header().Get("Vary") != "Accept-Encoding" || !strings.Contains(w.Header().Get("Content-Type"), "javascript") {
			t.Errorf("%q: %d %q %q %v", accept, w.Code, w.Header().Get("Content-Encoding"), w.Body.String(), w.Header())
		}
	}
	// A .br copy older than its file comes from an earlier build: use gzip.
	old := time.Now().Add(-time.Hour)
	if err := os.Chtimes(name+".br", old, old); err != nil {
		t.Fatal(err)
	}
	if w := get("br, gzip"); w.Header().Get("Content-Encoding") != "gzip" {
		t.Fatalf("stale brotli served: %v", w.Header())
	}
	if !acceptsEncoding("BR;q=0.5", "br") || acceptsEncoding("gzip", "br") || acceptsEncoding("br;q=0,*", "br") {
		t.Fatal("acceptsEncoding")
	}
}
