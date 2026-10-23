package panel

import (
	"bytes"
	"encoding/json"
	"image"
	"image/png"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPanelArtworkLibrary(t *testing.T) {
	dir := t.TempDir()
	var pixels bytes.Buffer
	_ = png.Encode(&pixels, image.NewRGBA(image.Rect(0, 0, 2, 2)))
	if err := os.WriteFile(filepath.Join(dir, "tile.png"), pixels.Bytes(), 0600); err != nil {
		t.Fatal(err)
	}
	outside := t.TempDir()
	_ = os.WriteFile(filepath.Join(outside, "secret.png"), pixels.Bytes(), 0600)
	_ = os.Symlink(filepath.Join(outside, "secret.png"), filepath.Join(dir, "link.png"))
	manifest := map[string]map[string]string{"server": {"rust": "tile.png", "escape": "../secret.png", "link": "link.png", "svg": "bad.svg"}, "library": {"steam-1": "tile.png"}}
	data, _ := json.Marshal(manifest)
	_ = os.WriteFile(filepath.Join(dir, "manifest.json"), data, 0600)
	_ = os.WriteFile(filepath.Join(dir, "bad.svg"), []byte(`<svg onload="alert(1)"/>`), 0600)
	a := &App{Config: Config{ArtworkDirectory: dir}}
	mux := http.NewServeMux()
	a.registerArtworkLibrary(mux)
	request := func(url string, user bool, etag string) *httptest.ResponseRecorder {
		r := httptest.NewRequest("GET", url, nil)
		if user {
			r = WithUser(r, 1)
		}
		r.Header.Set("If-None-Match", etag)
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, r)
		return w
	}
	if w := request("/api/client/artwork/catalog", false, ""); w.Code != 401 {
		t.Fatalf("unauthenticated catalog: %d", w.Code)
	}
	w := request("/api/client/artwork/catalog", true, "")
	if w.Code != 200 {
		t.Fatal(w.Code)
	}
	var catalog map[string]map[string]string
	if json.Unmarshal(w.Body.Bytes(), &catalog) != nil {
		t.Fatal(w.Body.String())
	}
	if len(catalog["server"]) != 1 || len(catalog["library"]) != 1 {
		t.Fatal(catalog)
	}
	asset := catalog["server"]["rust"]
	w = request(asset, true, "")
	if w.Code != 200 || w.Header().Get("Content-Type") != "image/png" || !strings.HasPrefix(w.Header().Get("Cache-Control"), "private") {
		t.Fatal(w)
	}
	if _, err := png.Decode(w.Body); err != nil {
		t.Fatal(err)
	}
	if request(asset, false, "").Code != 401 {
		t.Fatal("unauthenticated image")
	}
	if request(asset, true, w.Header().Get("ETag")).Code != 304 {
		t.Fatal("etag")
	}
	for _, url := range []string{"/api/client/artwork/manifest.json", "/api/client/artwork/tile.png", "/api/client/artwork/SOURCES.json", "/api/client/artwork/%2e%2e%2fsecret.png"} {
		if got := request(url, true, ""); got.Code == 200 {
			t.Fatal(url)
		}
	}
}
func TestPanelArtworkMissingAndInvalidPack(t *testing.T) {
	for _, dir := range []string{"", t.TempDir()} {
		pack := loadPanelArtwork(dir)
		if len(pack.Images) != 0 || len(pack.Catalog["server"]) != 0 {
			t.Fatal(pack)
		}
	}
}
