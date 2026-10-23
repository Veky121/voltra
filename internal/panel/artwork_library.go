package panel

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"image"
	_ "image/jpeg"
	"image/png"
	"io"
	"net/http"
	"os"
	"path"
	"strings"
)

const artworkFileLimit = 8 << 20

type panelArtworkLibrary struct {
	Catalog map[string]map[string]string `json:"catalog"`
	Images  map[string][]byte            `json:"-"`
}

// OpenRoot prevents escapes through symlinks, including concurrent replacement.
// Only manifest-listed raster files are decoded; responses contain pixels only.
func loadPanelArtwork(directory string) *panelArtworkLibrary {
	out := &panelArtworkLibrary{Catalog: map[string]map[string]string{"server": {}, "library": {}}, Images: map[string][]byte{}}
	if directory == "" {
		return out
	}
	root, err := os.OpenRoot(directory)
	if err != nil {
		return out
	}
	defer root.Close()
	manifest, err := root.Open("manifest.json")
	if err != nil {
		return out
	}
	defer manifest.Close()
	var mappings map[string]map[string]string
	data, err := io.ReadAll(io.LimitReader(manifest, (1<<20)+1))
	if err != nil || len(data) > 1<<20 || json.Unmarshal(data, &mappings) != nil {
		return out
	}
	total := 0
	for _, group := range []string{"server", "library"} {
		for id, name := range mappings[group] {
			if len(out.Images) >= 512 || len(id) > 160 || id == "" || strings.ContainsAny(id, "/\\") || path.Clean(name) != name || strings.HasPrefix(name, "/") || strings.ContainsAny(name, "\\:") {
				continue
			}
			switch strings.ToLower(path.Ext(name)) {
			case ".jpg", ".jpeg", ".png", ".webp":
			default:
				continue
			}
			file, err := root.Open(name)
			if err != nil {
				continue
			}
			info, err := file.Stat()
			if err != nil || !info.Mode().IsRegular() || info.Size() > artworkFileLimit {
				file.Close()
				continue
			}
			raw, err := io.ReadAll(io.LimitReader(file, artworkFileLimit+1))
			file.Close()
			if err != nil || len(raw) > artworkFileLimit {
				continue
			}
			cfg, format, err := image.DecodeConfig(bytes.NewReader(raw))
			if err != nil || (format != "jpeg" && format != "png" && format != "webp") || cfg.Width < 1 || cfg.Height < 1 || cfg.Width > 4096 || cfg.Height > 4096 || cfg.Width*cfg.Height > 8<<20 {
				continue
			}
			img, _, err := image.Decode(bytes.NewReader(raw))
			if err != nil {
				continue
			}
			var encoded bytes.Buffer
			if png.Encode(&encoded, img) != nil || encoded.Len() > artworkFileLimit {
				continue
			}
			hash := fmt.Sprintf("%x.png", sha256.Sum256(encoded.Bytes()))
			if _, exists := out.Images[hash]; !exists {
				if total+encoded.Len() > 128<<20 {
					continue
				}
				out.Images[hash] = encoded.Bytes()
				total += encoded.Len()
			}
			out.Catalog[group][id] = "/api/client/artwork/" + hash
		}
	}
	return out
}

func (a *App) registerArtworkLibrary(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/client/artwork/catalog", a.panelArtwork)
	mux.HandleFunc("GET /api/client/artwork/{asset}", a.panelArtwork)
}
func (a *App) panelArtwork(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "private, no-cache")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if UserID(r) <= 0 {
		fail(w, APIError{401, "AuthenticationException", "Sign in to continue."})
		return
	}
	a.artworkLibraryOnce.Do(func() { a.artworkLibrary = loadPanelArtwork(a.Config.ArtworkDirectory) })
	if r.URL.Path == "/api/client/artwork/catalog" {
		writeJSON(w, 200, a.artworkLibrary.Catalog)
		return
	}
	name := r.PathValue("asset")
	data, ok := a.artworkLibrary.Images[name]
	if !ok {
		fail(w, notFound())
		return
	}
	w.Header().Set("Content-Type", "image/png")
	w.Header().Set("Cache-Control", "private, max-age=86400")
	etag := `"` + strings.TrimSuffix(name, ".png") + `"`
	w.Header().Set("ETag", etag)
	if r.Header.Get("If-None-Match") == etag {
		w.WriteHeader(304)
		return
	}
	w.Header().Set("Content-Length", fmt.Sprint(len(data)))
	if r.Method != "HEAD" {
		_, _ = w.Write(data)
	}
}
