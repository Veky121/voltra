package panel

import (
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

// Vite's content hashes make these URLs safe to retain across releases.
var immutableWebAsset = regexp.MustCompile(`^.+-[A-Za-z0-9_-]{8,}\.(js|css|woff2?|png|webp|svg|avif)$`)

func acceptsGzip(value string) bool { return acceptsEncoding(value, "gzip") }

// acceptsEncoding reports whether an Accept-Encoding value allows coding. An
// explicit entry for the coding wins over a wildcard.
func acceptsEncoding(value, coding string) bool {
	wildcard := false
	for _, encoding := range strings.Split(value, ",") {
		parts := strings.Split(encoding, ";")
		quality := 1.0
		for _, parameter := range parts[1:] {
			key, raw, ok := strings.Cut(strings.TrimSpace(parameter), "=")
			if ok && strings.EqualFold(key, "q") {
				parsed, err := strconv.ParseFloat(strings.TrimSpace(raw), 64)
				if err != nil || parsed < 0 || parsed > 1 {
					quality = 0
				} else {
					quality = parsed
				}
			}
		}
		switch name := strings.ToLower(strings.TrimSpace(parts[0])); {
		case name == coding:
			return quality > 0
		case name == "*":
			wildcard = quality > 0
		}
	}
	return wildcard
}

// Shipped artwork, icons and fonts keep their names between releases, so they
// cannot be immutable. A day of reuse with background revalidation stops a
// library page from re-checking every image on each visit. The page shell and
// start-up files stay no-cache so a new build is picked up at once.
func shippedMedia(path string) bool {
	for _, prefix := range []string{"/artwork/", "/game-artwork/", "/game-icons/", "/backgrounds/", "/fonts/", "/brand/"} {
		if strings.HasPrefix(path, prefix) {
			return true
		}
	}
	return false
}

func (a *App) serveWebFile(w http.ResponseWriter, r *http.Request, name string, info os.FileInfo) {
	hashed := strings.HasPrefix(r.URL.Path, "/assets/") && immutableWebAsset.MatchString(filepath.Base(name))
	if !hashed {
		w.Header().Set("Cache-Control", "no-cache")
		if shippedMedia(r.URL.Path) {
			w.Header().Set("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800")
		}
		http.ServeFile(w, r, name)
		return
	}
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	if ext := filepath.Ext(name); ext == ".js" || ext == ".css" {
		w.Header().Add("Vary", "Accept-Encoding")
		// Compression happens at build time, never on an asset request. Brotli
		// copies are smaller, so they are preferred when the browser takes them.
		accept := r.Header.Get("Accept-Encoding")
		for _, encoding := range []struct{ name, suffix string }{{"br", ".br"}, {"gzip", ".gz"}} {
			if acceptsEncoding(accept, encoding.name) && serveCompressedWebFile(w, r, name, info, encoding.name, encoding.suffix) {
				return
			}
		}
	}
	http.ServeFile(w, r, name)
}

// serveCompressedWebFile serves name+suffix as the encoded form of name, if
// that copy exists and is not older than name (a copy left from an earlier
// build must not be served for a newer file).
func serveCompressedWebFile(w http.ResponseWriter, r *http.Request, name string, info os.FileInfo, encoding, suffix string) bool {
	compressed, err := os.Open(name + suffix)
	if err != nil {
		return false
	}
	defer compressed.Close()
	stat, err := compressed.Stat()
	if err != nil || stat.IsDir() || stat.ModTime().Before(info.ModTime()) {
		return false
	}
	w.Header().Set("Content-Encoding", encoding)
	http.ServeContent(w, r, filepath.Base(name), info.ModTime(), compressed)
	return true
}
