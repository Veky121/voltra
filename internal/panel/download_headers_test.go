package panel

import (
	"context"
	"encoding/json"
	"net/http"
	"reflect"
	"strconv"
	"testing"
)

func TestDownloadHeaderPolicy(t *testing.T) {
	rules, err := normalizeDownloadHeaders(M{"cdn25.giants-software.com": M{"referer": "https://www.farming-simulator.com/"}})
	if err != nil {
		t.Fatal(err)
	}
	for _, raw := range []string{"https://cdn25.giants-software.com/mod.zip", "https://CDN25.GIANTS-SOFTWARE.COM:443/mod.zip"} {
		if str(downloadHeadersForURL(rules, raw)["Referer"]) != "https://www.farming-simulator.com/" {
			t.Fatal(raw)
		}
	}
	for _, raw := range []string{"http://cdn25.giants-software.com/mod.zip", "https://cdn25.giants-software.com:444/mod.zip", "https://cdn25.giants-software.com.evil.test/mod.zip", "https://sub.cdn25.giants-software.com/mod.zip", "https://user@cdn25.giants-software.com/mod.zip", "https://elsewhere.test/mod.zip"} {
		if len(downloadHeadersForURL(rules, raw)) != 0 {
			t.Fatal("headers escaped host scope:", raw)
		}
	}
	for _, value := range []any{[]any{}, M{"*.giants-software.com": M{"Referer": "https://example.com/"}}, M{"127.0.0.1": M{"Accept": "*/*"}}, M{"example.com": M{"Authorization": "secret"}}, M{"example.com": M{"Host": "other.test"}}, M{"example.com": M{"Referer": "https://example.com/?token=secret"}}, M{"example.com": M{"User-Agent": "bad\r\nHeader: injected"}}, M{"example.com": M{"referer": "https://example.com/", "Referer": "https://other.test/"}}} {
		if _, err := normalizeDownloadHeaders(value); err == nil {
			t.Fatalf("accepted invalid policy: %#v", value)
		}
	}
	empty, err := normalizeDownloadHeaders(nil)
	if err != nil || len(empty) != 0 {
		t.Fatal("missing policy must be disabled")
	}
}

func TestDownloadHeadersFS25Template(t *testing.T) {
	egg, _, err := parseEggDocument(farmingSimulatorTemplate().Egg)
	if err != nil {
		t.Fatal(err)
	}
	for _, host := range []string{"cdn25", "cdn26", "cdn99", "cdn"} {
		headers := downloadHeadersForURL(asMap(egg["download_headers"]), "https://"+host+".giants-software.com/mod.zip")
		if str(headers["Referer"]) != "https://www.farming-simulator.com/" {
			t.Fatal(host, headers)
		}
	}
}

func TestDownloadHeadersGiantsCDNPattern(t *testing.T) {
	rules, err := normalizeDownloadHeaders(M{giantsDownloadHostPattern: M{"Referer": "https://www.farming-simulator.com/"}, "cdn25.giants-software.com": M{"Accept": "application/zip"}})
	if err != nil {
		t.Fatal(err)
	}
	for _, raw := range []string{"https://cdn.giants-software.com/mod.zip", "https://cdn26.giants-software.com/mod.zip", "https://CDN999.GIANTS-SOFTWARE.COM:443/mod.zip"} {
		if str(downloadHeadersForURL(rules, raw)["Referer"]) != "https://www.farming-simulator.com/" {
			t.Fatal("missed GIANTS CDN", raw)
		}
	}
	if got := downloadHeadersForURL(rules, "https://cdn25.giants-software.com/mod.zip"); len(got) != 1 || got["Accept"] != "application/zip" {
		t.Fatal("exact rule must override the pattern", got)
	}
	for _, raw := range []string{
		"http://cdn26.giants-software.com/mod.zip", "https://cdn26.giants-software.com:444/mod.zip",
		"https://cdn26.giants-software.com.evil.test/mod.zip", "https://evil-cdn26.giants-software.com/mod.zip",
		"https://sub.cdn26.giants-software.com/mod.zip", "https://cdnfoo.giants-software.com/mod.zip",
		"https://cdn26.giants-software.com./mod.zip", "https://user@cdn26.giants-software.com/mod.zip",
		"https://giants-software.com/mod.zip", "https://eshop.giants-software.com/mod.zip",
	} {
		if got := downloadHeadersForURL(rules, raw); len(got) != 0 {
			t.Fatal("headers escaped CDN scope", raw, got)
		}
	}
	for _, host := range []string{"*.giants-software.com", "cdn*.example.com", "cdn*.giants-software.com.evil.test", "cdn??.giants-software.com"} {
		if _, err := normalizeDownloadHeaders(M{host: M{"Accept": "application/zip"}}); err == nil {
			t.Fatal("unsupported wildcard", host)
		}
	}
}

func TestDownloadHeadersEggRoundTrip(t *testing.T) {
	f := operationsFixtureNew(t)
	ctx := context.Background()
	egg, vars, err := parseEggDocument(farmingSimulatorTemplate().Egg)
	if err != nil {
		t.Fatal(err)
	}
	egg["nest_id"] = f.server["nest_id"]
	saved, err := f.a.importEggRecord(ctx, 0, egg, vars)
	if err != nil {
		t.Fatal(err)
	}
	exported, err := f.a.eggExport(ctx, num(saved["id"]))
	if err != nil {
		t.Fatal(err)
	}
	parsed, _, err := parseEggDocument(exported)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(parsed["download_headers"], egg["download_headers"]) {
		t.Fatal("download policy lost during import/export")
	}
	// A legacy PTDL document without the Voltra extension stays disabled.
	delete(exported, "voltra")
	legacy, _, err := parseEggDocument(exported)
	if err != nil || len(asMap(legacy["download_headers"])) != 0 {
		t.Fatal("legacy egg unexpectedly enabled headers", err)
	}
}

func TestDownloadHeadersPullIntegration(t *testing.T) {
	for _, supported := range []bool{false, true} {
		t.Run(map[bool]string{false: "old node", true: "supported node"}[supported], func(t *testing.T) {
			f := operationsFixtureNew(t)
			ctx := context.Background()
			rules := M{"cdn25.giants-software.com": M{"Referer": "https://www.farming-simulator.com/"}}
			if _, err := f.a.update(ctx, "eggs", num(f.server["egg_id"]), M{"download_headers": rules}); err != nil {
				t.Fatal(err)
			}
			// Exercise the real request handler with a protocol fixture, not a game node.
			var received M
			old := f.daemon.Config.Handler
			f.daemon.Config.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/api/system" {
					if supported {
						w.Header().Set("X-Voltra-Download-Headers", "1")
					}
					writeJSON(w, 200, M{})
					return
				}
				if r.Method == "POST" {
					if err := json.NewDecoder(r.Body).Decode(&received); err != nil {
						t.Error(err)
					}
					w.WriteHeader(204)
					return
				}
				old.ServeHTTP(w, r)
			})
			response := f.request("POST", f.serverPath("/files/pull"), M{"url": "https://cdn25.giants-software.com/mod.zip", "remote_headers": M{"Authorization": "client-secret"}}, f.owner)
			want := 409
			if supported {
				want = 204
			}
			if response.Code != want {
				t.Fatalf("%d: %s", response.Code, response.Body.String())
			}
			if supported && !reflect.DeepEqual(asMap(received["remote_headers"]), asMap(rules["cdn25.giants-software.com"])) {
				t.Fatal(received)
			}
			if !supported && received != nil {
				t.Fatal("old node must not queue incompatible download")
			}
		})
	}
}

func TestDownloadHeadersClientInjectionIgnored(t *testing.T) {
	f := operationsFixtureNew(t)
	body := M{"url": "https://example.com/mod.zip", "headers": M{"Referer": "evil"}, "remote_headers": M{"Authorization": "secret"}, "download_headers": M{}, "REMOTE_HEADERS": M{"Referer": "https://evil.test/"}}
	if err := f.a.applyDownloadHeaders(context.Background(), f.server, body); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"headers", "remote_headers", "download_headers", "REMOTE_HEADERS"} {
		if _, ok := body[key]; ok {
			t.Fatal("client header survived", key)
		}
	}
}

func TestDownloadHeadersAdminEditor(t *testing.T) {
	f := operationsFixtureNew(t)
	f.a.registerEggs(f.mux)
	egg, vars, err := parseEggDocument(farmingSimulatorTemplate().Egg)
	if err != nil {
		t.Fatal(err)
	}
	egg["nest_id"] = f.server["nest_id"]
	saved, err := f.a.importEggRecord(context.Background(), 0, egg, vars)
	if err != nil {
		t.Fatal(err)
	}
	endpoint := "/api/admin/eggs/" + strconv.FormatInt(num(saved["id"]), 10)
	rules := M{"cdn25.giants-software.com": M{"Referer": "https://www.farming-simulator.com/"}}
	response := f.request("PATCH", endpoint, M{"download_headers": rules}, f.owner)
	if response.Code != 403 {
		t.Fatalf("non-admin changed egg headers: %d", response.Code)
	}
	response = f.request("PATCH", endpoint, M{"download_headers": rules}, f.admin)
	if response.Code != 200 {
		t.Fatalf("save: %d %s", response.Code, response.Body.String())
	}
	response = f.request("PATCH", endpoint, M{"download_headers": M{"example.com": M{"Authorization": "secret"}}}, f.admin)
	if response.Code != 422 && response.Code != 400 {
		t.Fatalf("invalid headers accepted: %d", response.Code)
	}
	row, err := f.a.one(context.Background(), "SELECT download_headers FROM eggs WHERE id=$1", saved["id"])
	if err != nil || !reflect.DeepEqual(asMap(row["download_headers"]), rules) {
		t.Fatal("invalid edit changed saved policy", row, err)
	}
	response = f.request("PATCH", endpoint, M{"download_headers": M{}}, f.admin)
	if response.Code != 200 {
		t.Fatalf("disable: %d %s", response.Code, response.Body.String())
	}
}
