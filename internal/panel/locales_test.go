package panel

import (
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestNativeLocaleEndpoint(t *testing.T) {
	a := &App{}
	r := httptest.NewRequest("GET", "/locales/locale.json?locale=en&namespace=activity", nil)
	w := httptest.NewRecorder()
	a.localeJSON(w, r)
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	var value M
	if err := json.Unmarshal(w.Body.Bytes(), &value); err != nil {
		t.Fatal(err)
	}
	activity := asMap(asMap(value["en"])["activity"])
	if !strings.Contains(str(asMap(asMap(activity["server"])["console"])["command"]), "{{command}}") {
		t.Fatal("native interpolation not converted")
	}
	if !strings.Contains(w.Header().Get("Cache-Control"), "stale-while-revalidate") {
		t.Fatal("native caching missing")
	}
	r.Header.Set("If-None-Match", w.Header().Get("ETag"))
	cached := httptest.NewRecorder()
	a.localeJSON(cached, r)
	if cached.Code != 304 || cached.Body.Len() != 0 {
		t.Fatal("conditional cache response incorrect")
	}
	for _, query := range []string{"locale=../en&namespace=activity", "locale=en&namespace=../activity", "locale=english&namespace=activity", "locale=en"} {
		w = httptest.NewRecorder()
		a.localeJSON(w, httptest.NewRequest("GET", "/locales/locale.json?"+query, nil))
		if w.Code != 422 {
			t.Fatal("invalid path accepted", query)
		}
	}
}
func TestCustomLocalePackAndFallback(t *testing.T) {
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "de"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "de", "activity.json"), []byte(`{"server":{"power":{"start":"Server :name gestartet"}}}`), 0600); err != nil {
		t.Fatal(err)
	}
	a := &App{Config: Config{LocalesDir: dir}}
	w := httptest.NewRecorder()
	a.localeJSON(w, httptest.NewRequest("GET", "/locales/locale.json?locale=de&namespace=activity", nil))
	if w.Code != 200 || !strings.Contains(w.Body.String(), "{{name}}") {
		t.Fatal(w.Code, w.Body.String())
	}
	w = httptest.NewRecorder()
	a.localeJSON(w, httptest.NewRequest("GET", "/locales/locale.json?locale=fr&namespace=missing", nil))
	if strings.TrimSpace(w.Body.String()) != `{"fr":{"missing":[]}}` {
		t.Fatal("unknown locale differs from native emptyloader", w.Body.String())
	}
}
