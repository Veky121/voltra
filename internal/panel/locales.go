package panel

import (
	"crypto/md5"
	"embed"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

//go:embed locales
var bundledLocales embed.FS
var localeCodePattern = regexp.MustCompile(`^[a-z]{2}$`)
var localeNamespacePattern = regexp.MustCompile(`^[a-z]{1,191}$`)
var localePlaceholderPattern = regexp.MustCompile(`:([\w.-]+\w)([^\w:]?|$)`)

func localeI18n(value any) any {
	switch v := value.(type) {
	case string:
		return localePlaceholderPattern.ReplaceAllString(v, "{{$1}}$2")
	case map[string]any:
		out := M{}
		for k, x := range v {
			out[k] = localeI18n(x)
		}
		return out
	case []any:
		out := make([]any, len(v))
		for i, x := range v {
			out[i] = localeI18n(x)
		}
		return out
	default:
		return value
	}
}
func (a *App) localeJSON(w http.ResponseWriter, r *http.Request) {
	locale, namespace := r.URL.Query().Get("locale"), r.URL.Query().Get("namespace")
	if !localeCodePattern.MatchString(locale) || !localeNamespacePattern.MatchString(namespace) {
		fail(w, bad("Locale must be two lowercase letters and namespace must contain lowercase letters only."))
		return
	}
	var value any = []any{}
	var raw []byte
	var err error
	directory := a.Config.LocalesDir
	if directory != "" {
		raw, err = os.ReadFile(filepath.Join(directory, locale, namespace+".json"))
		if err != nil && !os.IsNotExist(err) {
			fail(w, err)
			return
		}
	}
	if len(raw) == 0 {
		raw, err = bundledLocales.ReadFile("locales/" + locale + "/" + namespace + ".json")
		if err != nil && !os.IsNotExist(err) {
			fail(w, err)
			return
		}
	}
	if len(raw) > 0 {
		if err = json.Unmarshal(raw, &value); err != nil {
			fail(w, err)
			return
		}
	}
	body, err := json.Marshal(M{locale: M{namespace: localeI18n(value)}})
	if err != nil {
		fail(w, err)
		return
	}
	digest := md5.Sum(body)
	tag := `"` + hex.EncodeToString(digest[:]) + `"`
	w.Header().Set("ETag", tag)
	w.Header().Set("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400")
	for _, candidate := range strings.Split(r.Header.Get("If-None-Match"), ",") {
		if strings.TrimSpace(candidate) == tag {
			w.WriteHeader(http.StatusNotModified)
			return
		}
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(200)
	_, _ = w.Write(body)
}
