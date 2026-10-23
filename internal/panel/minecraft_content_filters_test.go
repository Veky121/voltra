package panel

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestMinecraftContentEnvironmentFilters(t *testing.T) {
	for _, tc := range []struct {
		environment, classification string
		independent                 bool
	}{
		{"client_only", "unsupported", false}, {"singleplayer_only", "unsupported", false},
		{"client_and_server", "client_and_server", false}, {"client_only_server_optional", "server_optional", false},
		{"server_only", "server_only", true}, {"dedicated_server_only", "server_only", true},
		{"server_only_client_optional", "server_only", true}, {"client_or_server", "server_only", true},
		{"client_or_server_prefers_both", "server_only", true},
	} {
		row := M{"environment": []any{tc.environment}, "server_side": "optional", "client_side": "required"}
		if actual := mcContentProjectCompatibility(row); actual != tc.classification {
			t.Fatalf("%s classified as %s", tc.environment, actual)
		}
		if actual := mcContentMatchesCompatibility(row, "server_only"); actual != tc.independent {
			t.Fatalf("%s independent=%v", tc.environment, actual)
		}
	}
	legacy := M{"environment": []any{"unknown"}, "server_side": "required", "client_side": "unsupported"}
	if !mcContentMatchesCompatibility(legacy, "server_only") {
		t.Fatal("legacy server-only declaration was ignored")
	}
	mixed := M{"environment": []any{"server_only", "client_and_server"}, "server_side": "required"}
	if mcContentMatchesCompatibility(mixed, "server_only") {
		t.Fatal("mixed client requirements described as server-only")
	}
	for _, query := range []string{"?compatibility=client", "?include_unverified=maybe"} {
		if mcContentFilter(httptest.NewRequest("GET", "/"+query, nil), &mcContentInfo{}) == nil {
			t.Fatal("invalid filter accepted")
		}
	}
}

func TestMinecraftContentSearchRechecksProviderFilters(t *testing.T) {
	hit := func(id, environment, loader, version string) M {
		return M{"project_id": id, "title": id, "environment": []string{environment}, "server_side": "optional", "client_side": "required", "categories": []string{loader}, "versions": []string{version}}
	}
	hits := []M{hit("server", "server_only", "fabric", "1.21.1"), hit("both", "client_and_server", "fabric", "1.21.1"), hit("client", "client_only", "fabric", "1.21.1"), hit("single", "singleplayer_only", "fabric", "1.21.1"), hit("wrongloader", "server_only", "forge", "1.21.1"), hit("wronggame", "server_only", "fabric", "1.20.1")}
	requests := 0
	a := &App{HTTP: &http.Client{Transport: mcContentTestTransport(func(r *http.Request) (*http.Response, error) {
		requests++
		if r.URL.Host == "api.curseforge.com" {
			return mcContentTestResponse(M{"data": []M{{"id": 12, "gameId": 432, "classId": 6, "name": "Unverified"}}}), nil
		}
		var facets [][]string
		if err := json.Unmarshal([]byte(r.URL.Query().Get("facets")), &facets); err != nil {
			t.Fatal(err)
		}
		found := false
		for _, group := range facets {
			for _, facet := range group {
				if facet == "environment:server_only" {
					found = true
				}
				if facet == "environment:client_only" || facet == "environment:singleplayer_only" {
					t.Fatal("client-only search facet included")
				}
			}
		}
		if !found {
			t.Fatal("server environment facet missing")
		}
		return mcContentTestResponse(M{"hits": hits}), nil
	})}}
	p := mcContentProvider{app: a, name: "modrinth"}
	info := mcContentInfo{Version: "1.21.1", Loader: "fabric", Kind: "mod", Compatibility: "server"}
	rows, err := p.search(context.Background(), info, "")
	if err != nil || len(rows) != 2 || rows[0]["id"] != "server" || rows[1]["compatibility"] != "client_and_server" {
		t.Fatalf("catalog filter failed: %v %v", rows, err)
	}
	info.Compatibility = "server_only"
	rows, err = p.search(context.Background(), info, "")
	if err != nil || len(rows) != 1 || rows[0]["id"] != "server" {
		t.Fatalf("server-only filter failed: %v %v", rows, err)
	}
	file := mcContentTestRelease(mcContentTestJAR(t), "project", "version", "mod.jar")
	file["environment"] = "client_and_server"
	if len(p.parseReleases(info, "project", []M{file})) != 0 {
		t.Fatal("client-required version passed server-only filter")
	}
	file["environment"] = "server_only"
	if len(p.parseReleases(info, "project", []M{file})) != 1 {
		t.Fatal("server-only version rejected")
	}
	p.name = "curseforge"
	info.Compatibility = "server"
	before := requests
	rows, err = p.search(context.Background(), info, "")
	if err != nil || len(rows) != 0 || requests != before {
		t.Fatal("unverified CurseForge mods were fetched by default")
	}
	info.IncludeUnverified = true
	rows, err = p.search(context.Background(), info, "")
	if err != nil || len(rows) != 1 || rows[0]["compatibility"] != "unknown" {
		t.Fatalf("explicit unverified results missing: %v %v", rows, err)
	}
}
