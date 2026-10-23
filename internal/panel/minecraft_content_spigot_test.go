package panel

import (
	"context"
	"net/http"
	"strings"
	"testing"
)

func TestMinecraftContentSpigotExactCompatibility(t *testing.T) {
	info, reason := mcContentEnvironment(M{"DL_VERSION": "26.3", "MINECRAFT_LOADER": "spigot"})
	if reason != "" || info.Loader != "spigot" || info.Kind != "plugin" || info.Directory != "/plugins" {
		t.Fatal(info, reason)
	}
	info.Compatibility = "server"
	a := &App{HTTP: &http.Client{Transport: mcContentTestTransport(func(r *http.Request) (*http.Response, error) {
		facets := r.URL.Query().Get("facets")
		if !strings.Contains(facets, "categories:spigot") || strings.Contains(facets, "categories:paper") {
			t.Fatal("Spigot masqueraded as Paper", facets)
		}
		return mcContentTestResponse(M{"hits": []M{
			{"project_id": "compatible", "environment": []string{"server_only"}, "categories": []string{"spigot"}, "versions": []string{"26.3"}},
			{"project_id": "paper", "environment": []string{"server_only"}, "categories": []string{"paper"}, "versions": []string{"26.3"}},
			{"project_id": "client", "environment": []string{"client_only"}, "categories": []string{"spigot"}, "versions": []string{"26.3"}},
		}}), nil
	})}}
	rows, err := (mcContentProvider{app: a, name: "modrinth"}).search(context.Background(), info, "")
	if err != nil || len(rows) != 1 || rows[0]["id"] != "compatible" {
		t.Fatal(rows, err)
	}
}

func TestMinecraftContentSpigotCurseForgeOptInAndAcknowledgment(t *testing.T) {
	requests := 0
	a := &App{HTTP: &http.Client{Transport: mcContentTestTransport(func(r *http.Request) (*http.Response, error) {
		requests++
		return mcContentTestResponse(M{"data": []M{{"id": 1, "gameId": 432, "classId": 5, "name": "Unknown plugin API"}}}), nil
	})}}
	p := mcContentProvider{app: a, name: "curseforge", credential: "fixture-only"}
	info := mcContentInfo{Version: "26.3", Loader: "spigot", Kind: "plugin", Directory: "/plugins", Compatibility: "server"}
	if rows, err := p.search(context.Background(), info, ""); err != nil || len(rows) != 0 || requests != 0 {
		t.Fatal("unknown plugin API fetched by default", rows, err)
	}
	if _, err := p.project(context.Background(), info, "1"); err == nil || requests != 0 {
		t.Fatal("direct project bypassed opt-in")
	}
	if _, err := p.release(context.Background(), info, "1", "2"); err == nil || requests != 0 {
		t.Fatal("direct release bypassed opt-in")
	}
	if mcContentAcknowledged("curseforge", info, M{"confirm_server_compatibility": true}) == nil {
		t.Fatal("acknowledgment bypassed disabled opt-in")
	}
	info.IncludeUnverified = true
	rows, err := p.search(context.Background(), info, "")
	if err != nil || len(rows) != 1 || rows[0]["server_compatibility_unknown"] != true {
		t.Fatal(rows, err)
	}
	if mcContentAcknowledged("curseforge", info, M{}) == nil || mcContentAcknowledged("curseforge", info, M{"confirm_server_compatibility": true}) != nil {
		t.Fatal("explicit author acknowledgment not enforced")
	}
	if !strings.Contains(mcContentProviderWarning("curseforge", info), "Spigot") || !strings.Contains(mcContentProviderWarning("curseforge", info), "Paper") {
		t.Fatal("API compatibility warning is unclear")
	}
	info.Compatibility = "server_only"
	if rows, err := p.search(context.Background(), info, ""); err != nil || len(rows) != 0 || mcContentAcknowledged("curseforge", info, M{"confirm_server_compatibility": true}) == nil {
		t.Fatal("strict compatibility filter accepted unknown plugin API")
	}
}
