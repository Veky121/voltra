package panel

import (
	"context"
	"net/http"
	"strings"
	"testing"
)

func TestMinecraftContentFoliaKeepsExactLoaderAndServerFilters(t *testing.T) {
	info, reason := mcContentEnvironment(M{"MINECRAFT_VERSION": "1.21.11", "MINECRAFT_LOADER": "folia"})
	if reason != "" || info.Loader != "folia" || info.Kind != "plugin" || info.Directory != "/plugins" {
		t.Fatal(info, reason)
	}
	info.Compatibility = "server"
	a := &App{HTTP: &http.Client{Transport: mcContentTestTransport(func(r *http.Request) (*http.Response, error) {
		if !strings.Contains(r.URL.Query().Get("facets"), "categories:folia") || strings.Contains(r.URL.Query().Get("facets"), "categories:paper") {
			t.Fatal("Folia search lost exact compatibility", r.URL)
		}
		return mcContentTestResponse(M{"hits": []M{
			{"project_id": "folia", "title": "Folia plugin", "environment": []string{"server_only"}, "categories": []string{"folia"}, "versions": []string{"1.21.11"}},
			{"project_id": "paper", "environment": []string{"server_only"}, "categories": []string{"paper"}, "versions": []string{"1.21.11"}},
			{"project_id": "client", "environment": []string{"client_only"}, "categories": []string{"folia"}, "versions": []string{"1.21.11"}},
		}}), nil
	})}}
	p := mcContentProvider{app: a, name: "modrinth"}
	rows, err := p.search(context.Background(), info, "")
	if err != nil || len(rows) != 1 || rows[0]["id"] != "folia" {
		t.Fatalf("exact Folia server filter: %v %v", rows, err)
	}
	row := mcContentTestRelease(mcContentTestJAR(t), "project", "version", "plugin.jar")
	row["game_versions"], row["loaders"], row["environment"] = []string{"1.21.11"}, []string{"paper"}, "server_only"
	if len(p.parseReleases(info, "project", []M{row})) != 0 {
		t.Fatal("Paper-only release accepted for Folia")
	}
	row["loaders"] = []string{"folia"}
	if len(p.parseReleases(info, "project", []M{row})) != 1 {
		t.Fatal("declared Folia release rejected")
	}
	row["environment"] = "client_only"
	if len(p.parseReleases(info, "project", []M{row})) != 0 {
		t.Fatal("Folia bypassed client-only exclusion")
	}
}

func TestMinecraftContentFoliaCurseForgeRequiresOptInAndAcknowledgment(t *testing.T) {
	requests := 0
	a := &App{HTTP: &http.Client{Transport: mcContentTestTransport(func(r *http.Request) (*http.Response, error) {
		requests++
		return mcContentTestResponse(M{"data": []M{{"id": 1, "gameId": 432, "classId": 5, "name": "Unknown Folia support"}}}), nil
	})}}
	p := mcContentProvider{app: a, name: "curseforge", credential: "fixture-only"}
	info := mcContentInfo{Version: "1.21.11", Loader: "folia", Kind: "plugin", Directory: "/plugins", Compatibility: "server"}
	if rows, err := p.search(context.Background(), info, ""); err != nil || len(rows) != 0 || requests != 0 {
		t.Fatal("unknown Folia plugins fetched by default", rows, err)
	}
	if _, err := p.project(context.Background(), info, "1"); err == nil || requests != 0 {
		t.Fatal("direct project lookup bypassed opt-in")
	}
	if _, err := p.release(context.Background(), info, "1", "2"); err == nil || requests != 0 {
		t.Fatal("direct release lookup bypassed opt-in")
	}
	if mcContentAcknowledged("curseforge", info, M{"confirm_server_compatibility": true}) == nil {
		t.Fatal("acknowledgment bypassed disabled opt-in")
	}
	row := M{"id": 2, "modId": 1, "isAvailable": true, "gameVersions": []string{"1.21.11"}, "fileName": "plugin.jar", "downloadUrl": "https://edge.forgecdn.net/files/1/2/plugin.jar", "fileLength": 10, "hashes": []M{{"algo": 1, "value": strings.Repeat("a", 40)}}}
	if len(p.parseReleases(info, "1", []M{row})) != 0 {
		t.Fatal("release parsing bypassed disabled opt-in")
	}
	info.IncludeUnverified = true
	rows, err := p.search(context.Background(), info, "")
	if err != nil || len(rows) != 1 || rows[0]["compatibility"] != "unknown" || rows[0]["server_compatibility_unknown"] != true {
		t.Fatal(rows, err)
	}
	if len(p.parseReleases(info, "1", []M{row})) != 1 {
		t.Fatal("explicitly unverified Folia release rejected")
	}
	for _, ack := range []any{nil, false, "true", 1} {
		if mcContentAcknowledged("curseforge", info, M{"confirm_server_compatibility": ack}) == nil {
			t.Fatal("missing or mistyped acknowledgment accepted")
		}
	}
	if err := mcContentAcknowledged("curseforge", info, M{"confirm_server_compatibility": true}); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(mcContentProviderWarning("curseforge", info), "Folia") {
		t.Fatal("Folia warning missing")
	}
	info.Compatibility = "server_only"
	if len(p.parseReleases(info, "1", []M{row})) != 0 || mcContentAcknowledged("curseforge", info, M{"confirm_server_compatibility": true}) == nil {
		t.Fatal("strict filter accepted unknown Folia compatibility")
	}
	info.Loader, info.IncludeUnverified = "paper", false
	if len(p.parseReleases(info, "1", []M{row})) != 1 || mcContentAcknowledged("curseforge", info, M{}) != nil {
		t.Fatal("ordinary Paper plugin behavior changed")
	}
}
