package panel

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

func TestMinecraftContentPluginSearchModernIndex(t *testing.T) {
	a := &App{HTTP: &http.Client{Transport: mcContentTestTransport(func(r *http.Request) (*http.Response, error) {
		var facets [][]string
		if e := json.Unmarshal([]byte(r.URL.Query().Get("facets")), &facets); e != nil {
			t.Fatal(e)
		}
		if len(facets) == 0 || !mcContentContains(facets[0], "project_type:plugin") || !mcContentContains(facets[0], "project_type:mod") {
			// Mirrors the live index: the legacy-only filter loses LuckPerms.
			return mcContentTestResponse(M{"hits": []M{}}), nil
		}
		return mcContentTestResponse(M{"hits": []M{{"project_id": "Vebnzrzj", "title": "LuckPerms", "project_type": "mod", "environment": []string{"server_only"}, "categories": []string{"paper"}, "versions": []string{"1.21.1"}}}}), nil
	})}}
	p := mcContentProvider{app: a, name: "modrinth"}
	rows, e := p.search(context.Background(), mcContentInfo{Kind: "plugin", Version: "1.21.1", Loader: "paper", Compatibility: "server"}, "LuckPerms")
	if e != nil || len(rows) != 1 || rows[0]["id"] != "Vebnzrzj" {
		t.Fatalf("Compatible plugin hidden by legacy type facet: %v %v", rows, e)
	}
}

func TestMinecraftContentCurseForgeLargeNumericIDs(t *testing.T) {
	data := mcContentTestJAR(t)
	// Both IDs are above fmt.Sprint(float64)'s exponent threshold. Exercise the
	// real metadata decoder instead of passing pre-decoded Go integer fixtures.
	project, fileID := "1459857", "7524152"
	row := M{"id": json.Number(fileID), "modId": json.Number(project), "isAvailable": true, "fileName": "compatible.jar", "fileLength": len(data), "downloadUrl": "https://edge.forgecdn.net/files/7524/152/compatible.jar", "hashes": []M{{"algo": 1, "value": strings.Repeat("a", 40)}}, "gameVersions": []string{"Fabric", "1.21.1"}, "dependencies": []M{{"modId": json.Number("1459858"), "relationType": 3}}}
	a := &App{HTTP: &http.Client{Transport: mcContentTestTransport(func(r *http.Request) (*http.Response, error) {
		switch r.URL.Path {
		case "/v1/mods/search":
			return mcContentTestResponse(M{"data": []M{{"id": json.Number(project), "gameId": 432, "classId": 6, "name": "Compatible"}}}), nil
		case "/v1/mods/" + project:
			return mcContentTestResponse(M{"data": M{"id": json.Number(project), "gameId": 432, "classId": 6}}), nil
		case "/v1/mods/" + project + "/files":
			return mcContentTestResponse(M{"data": []M{row}}), nil
		case "/v1/mods/" + project + "/files/" + fileID:
			return mcContentTestResponse(M{"data": row}), nil
		default:
			t.Fatalf("Unexpected metadata URL %s", r.URL.Path)
			return nil, nil
		}
	})}}
	p := mcContentProvider{app: a, name: "curseforge", credential: "fixture"}
	info := mcContentInfo{Version: "1.21.1", Loader: "fabric", Kind: "mod", Compatibility: "server", IncludeUnverified: true}
	projects, e := p.search(context.Background(), info, "Compatible")
	if e != nil || len(projects) != 1 || projects[0]["id"] != project {
		t.Fatalf("Search project ID changed: %v %v", projects, e)
	}
	versions, e := p.releases(context.Background(), info, project)
	if e != nil || len(versions) != 1 {
		t.Fatalf("Large IDs disappeared: %v %v", versions, e)
	}
	v, e := p.release(context.Background(), info, project, fileID)
	if e != nil || v.ID != fileID || v.Project != project || len(v.Dependencies) != 1 || v.Dependencies[0].Project != "1459858" {
		t.Fatalf("IDs changed during decode: %#v %v", v, e)
	}
}

func TestMinecraftContentReleaseMinecraftAndLoaderMatrix(t *testing.T) {
	for _, loader := range []string{"paper", "spigot", "folia", "fabric", "forge", "neoforge", "quilt"} {
		t.Run(loader, func(t *testing.T) {
			info, reason := mcContentEnvironment(M{"MINECRAFT_VERSION": "1.21.1", "MINECRAFT_LOADER": loader, "MINECRAFT_LOADER_VERSION": "selected-build"})
			if reason != "" {
				t.Fatal(reason)
			}
			info.Compatibility = "server"
			info.IncludeUnverified = true
			p := mcContentProvider{name: "modrinth"}
			row := mcContentTestRelease(mcContentTestJAR(t), "project", "version", "compatible.jar")
			row["loaders"] = []string{loader}
			if len(p.parseReleases(info, "project", []M{row})) != 1 {
				t.Fatal("Matching release rejected")
			}
			row["game_versions"] = []string{"1.21"}
			if len(p.parseReleases(info, "project", []M{row})) != 0 {
				t.Fatal("Neighbour Minecraft patch accepted")
			}
			row["game_versions"] = []string{"1.21.1"}
			wrong := "fabric"
			if loader == wrong {
				wrong = "forge"
			}
			row["loaders"] = []string{wrong}
			if len(p.parseReleases(info, "project", []M{row})) != 0 {
				t.Fatal("Other loader accepted")
			}
			if info.Kind == "mod" {
				p.name = "curseforge"
				cf := M{"id": json.Number("7524152"), "modId": json.Number("1459857"), "isAvailable": true, "fileName": "compatible.jar", "fileLength": 100, "downloadUrl": "https://edge.forgecdn.net/a.jar", "hashes": []M{{"algo": 1, "value": strings.Repeat("a", 40)}}, "gameVersions": []string{"1.21.1", map[string]string{"fabric": "Fabric", "forge": "Forge", "neoforge": "NeoForge", "quilt": "Quilt"}[loader]}}
				if len(p.parseReleases(info, "1459857", []M{cf})) != 1 {
					t.Fatal("Matching CF release rejected")
				}
				cf["gameVersions"] = []string{"1.21.1", "WrongLoader"}
				if len(p.parseReleases(info, "1459857", []M{cf})) != 0 {
					t.Fatal("Wrong CF loader accepted")
				}
				cf["gameVersions"] = []string{"1.21", map[string]string{"fabric": "Fabric", "forge": "Forge", "neoforge": "NeoForge", "quilt": "Quilt"}[loader]}
				if len(p.parseReleases(info, "1459857", []M{cf})) != 0 {
					t.Fatal("Neighbour CF Minecraft patch accepted")
				}
			}
		})
	}
}
