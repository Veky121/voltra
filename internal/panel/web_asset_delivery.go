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

func acceptsGzip(value string) bool {
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
		switch strings.ToLower(strings.TrimSpace(parts[0])) {
		case "gzip":
			return quality > 0
		case "*":
			wildcard = quality > 0
		}
	}
	return wildcard
}

func (a *App) serveWebFile(w http.ResponseWriter, r *http.Request, name string, info os.FileInfo) {
	hashed := strings.HasPrefix(r.URL.Path, "/assets/") && immutableWebAsset.MatchString(filepath.Base(name))
	if !hashed {
		w.Header().Set("Cache-Control", "no-cache")
		http.ServeFile(w, r, name)
		return
	}
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	if ext := filepath.Ext(name); ext == ".js" || ext == ".css" {
		w.Header().Add("Vary", "Accept-Encoding")
		if acceptsGzip(r.Header.Get("Accept-Encoding")) {
			// Compression happens at build time, never on an API or asset request.
			if compressed, err := os.Open(name + ".gz"); err == nil {
				defer compressed.Close()
				if stat, err := compressed.Stat(); err == nil && !stat.IsDir() && !stat.ModTime().Before(info.ModTime()) {
					w.Header().Set("Content-Encoding", "gzip")
					http.ServeContent(w, r, filepath.Base(name), info.ModTime(), compressed)
					return
				}
			}
		}
	}
	http.ServeFile(w, r, name)
}
