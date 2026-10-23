package panel

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha1"
	"crypto/sha512"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

func minecraftFixtureZip(t *testing.T, files map[string][]byte) []byte {
	t.Helper()
	var out bytes.Buffer
	writer := zip.NewWriter(&out)
	for name, data := range files {
		entry, err := writer.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = entry.Write(data); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return out.Bytes()
}

func minecraftFixtureHash(data []byte, algorithm string) string {
	if algorithm == "sha1" {
		hash := sha1.Sum(data)
		return hex.EncodeToString(hash[:])
	}
	hash := sha512.Sum512(data)
	return hex.EncodeToString(hash[:])
}

// Opt-in protocol check against public upstream metadata. Offline tests above
// remain deterministic and use a real isolated PostgreSQL schema when supplied.
func TestGameLibraryLiveLoaderMetadata(t *testing.T) {
	if os.Getenv("MINECRAFT_LIVE_METADATA_TEST") != "1" {
		t.Skip("Set MINECRAFT_LIVE_METADATA_TEST=1 to check public upstream metadata")
	}
	a := &App{HTTP: &http.Client{Timeout: 45 * time.Second}}
	plans := []minecraftPlan{}
	for _, tc := range []struct{ loader, game string }{{"vanilla", "1.12.2"}, {"paper", "1.21.1"}, {"fabric", "1.21.1"}, {"forge", "1.17.1"}, {"forge", "1.12.2"}, {"neoforge", "26.1"}, {"quilt", "1.21.1"}} {
		t.Run(tc.loader+tc.game, func(t *testing.T) {
			plan, err := a.minecraftBuildPlan(context.Background(), tc.game, tc.loader, "stable")
			if err != nil {
				t.Fatal(err)
			}
			if plan.Version != tc.game || plan.Loader != tc.loader || plan.Java < 8 || len(plan.Files) == 0 {
				t.Fatal("invalid upstream install plan")
			}
			plans = append(plans, plan)
			t.Logf("%s %s loader=%s java=%d launch=%s", plan.Loader, plan.Version, plan.LoaderVersion, plan.Java, plan.Launch)
		})
	}
	if filename := os.Getenv("MINECRAFT_LIVE_PLAN_OUT"); filename != "" {
		data, err := json.MarshalIndent(plans, "", "  ")
		if err != nil {
			t.Fatal(err)
		}
		if err = os.WriteFile(filename, data, 0600); err != nil {
			t.Fatal(err)
		}
	}
}

func minecraftFixtureHTTP(t *testing.T, extra map[string]any) *http.Client {
	t.Helper()
	return &http.Client{Transport: gameLibraryTransport(func(r *http.Request) (*http.Response, error) {
		address := r.URL.Host + r.URL.Path
		var payload any
		switch {
		case r.URL.Host == "piston-meta.mojang.com" && r.URL.Path == "/mc/game/version_manifest_v2.json":
			rows := []M{}
			for _, v := range []string{"26.2", "26.1", "1.21.1", "1.17.1", "1.16.5", "1.12.2"} {
				rows = append(rows, M{"id": v, "type": "release", "url": "https://piston-meta.mojang.com/" + v + ".json"})
			}
			payload = M{"latest": M{"release": "26.2"}, "versions": rows}
		case r.URL.Host == "piston-meta.mojang.com":
			version := strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/"), ".json")
			payload = M{"id": version, "downloads": M{"server": M{"url": "https://piston-data.mojang.com/" + version + ".jar", "sha1": strings.Repeat("1", 40)}}}
			if !strings.HasPrefix(version, "1.1") {
				payload.(M)["javaVersion"] = M{"majorVersion": minecraftFallbackJava(version)}
			}
		case strings.HasSuffix(r.URL.Path, ".sha1"):
			payload = strings.Repeat("a", 40)
		case address == "fill.papermc.io/v3/projects/paper/versions/1.21.1/builds":
			payload = []M{{"id": 12, "channel": "EXPERIMENTAL", "java": M{"version": M{"minimum": 25}}, "downloads": M{"server:default": M{"url": "https://fill-data.papermc.io/paper.jar", "checksums": M{"sha256": strings.Repeat("a", 64)}}}}, {"id": 11, "channel": "STABLE", "java": M{"version": M{"minimum": 21}}, "downloads": M{"server:default": M{"url": "https://fill-data.papermc.io/stable.jar", "checksums": M{"sha256": strings.Repeat("b", 64)}}}}}
		case strings.HasPrefix(address, "meta.fabricmc.net/v2/versions/loader/"):
			payload = []M{{"loader": M{"version": "0.16.9", "stable": true}}}
		case strings.HasPrefix(address, "meta.quiltmc.org/v3/versions/loader/"):
			payload = []M{{"loader": M{"version": "0.27.1", "stable": true}}}
		case address == "meta.fabricmc.net/v2/versions/installer":
			payload = []M{{"url": "https://maven.fabricmc.net/net/fabricmc/fabric-installer/1.0.1/fabric-installer-1.0.1.jar", "stable": true}}
		case address == "meta.quiltmc.org/v3/versions/installer":
			payload = []M{{"url": "https://maven.quiltmc.org/repository/release/org/quiltmc/quilt-installer/0.10.0/quilt-installer-0.10.0.jar"}}
		case address == "maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml":
			payload = `<metadata><versioning><versions><version>1.12.2-14.23.5.2860</version><version>1.16.5-36.2.42</version><version>1.17.1-37.1.1</version><version>1.21.1-52.0.3</version></versions></versioning></metadata>`
		case address == "files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json":
			payload = M{"promos": M{"1.21.1-recommended": "52.0.3", "1.17.1-recommended": "37.1.1", "1.16.5-recommended": "36.2.42", "1.12.2-recommended": "14.23.5.2860"}}
		case address == "maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml":
			payload = `<metadata><versioning><versions><version>21.1.100</version><version>21.2.1-beta</version><version>26.1.0.10</version><version>26.2.0.1-beta</version></versions></versioning></metadata>`
		default:
			var exists bool
			payload, exists = extra[address]
			if !exists {
				t.Errorf("unexpected provider request %s", address)
				return &http.Response{StatusCode: 404, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`{}`))}, nil
			}
		}
		if r.Header.Get("User-Agent") == "" {
			t.Error("missing provider User-Agent")
		}
		if r.Header.Get("x-api-key") != "" && r.URL.Host != "api.curseforge.com" {
			t.Error("credential leaked to download host")
		}
		var data []byte
		switch value := payload.(type) {
		case []byte:
			data = value
		case string:
			data = []byte(value)
		default:
			data, _ = json.Marshal(value)
		}
		return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(bytes.NewReader(data))}, nil
	})}
}

func TestGameLibraryLoaderPlans(t *testing.T) {
	a := &App{HTTP: minecraftFixtureHTTP(t, nil)}
	ctx := context.Background()
	for _, tc := range []struct {
		loader, game, selection, launch string
		java                            int
	}{
		{"vanilla", "1.12.2", "", "-jar server.jar", 8},
		{"vanilla", "1.17.1", "", "-jar server.jar", 16},
		{"vanilla", "26.2", "", "-jar server.jar", 25},
		{"paper", "1.21.1", "stable", "-jar server.jar", 21},
		{"paper", "1.21.1", "latest", "-jar server.jar", 25},
		{"fabric", "1.21.1", "", "-jar fabric-server-launch.jar", 21},
		{"quilt", "1.12.2", "", "-jar quilt-server-launch.jar", 17},
		{"forge", "1.12.2", "", "-jar .voltra-forge-server.jar", 8},
		{"forge", "1.17.1", "", "@libraries/net/minecraftforge/forge/1.17.1-37.1.1/unix_args.txt", 16},
		{"forge", "1.21.1", "", "@libraries/net/minecraftforge/forge/1.21.1-52.0.3/unix_args.txt", 21},
		{"neoforge", "1.21.1", "", "@libraries/net/neoforged/neoforge/21.1.100/unix_args.txt", 21},
		{"neoforge", "26.1", "", "@libraries/net/neoforged/neoforge/26.1.0.10/unix_args.txt", 25},
	} {
		t.Run(tc.loader+tc.game+tc.selection, func(t *testing.T) {
			plan, err := a.minecraftBuildPlan(ctx, tc.game, tc.loader, tc.selection)
			if err != nil {
				t.Fatal(err)
			}
			if plan.Launch != tc.launch || plan.Java != tc.java {
				t.Fatalf("unexpected plan %#v", plan)
			}
			if _, err = minecraftEncodePlan(plan); err != nil {
				t.Fatal(err)
			}
		})
	}
	for _, tc := range []struct{ loader, version string }{{"fabric", "unpublished"}, {"forge", "37.1.1"}, {"shell;command", ""}} {
		if _, err := a.minecraftBuildPlan(ctx, "1.21.1", tc.loader, tc.version); err == nil {
			t.Fatalf("accepted invalid loader selection %v", tc)
		}
	}
}

func TestGameLibraryModrinthManifest(t *testing.T) {
	hash := strings.Repeat("a", 128)
	manifest := M{"formatVersion": 1, "game": "minecraft", "dependencies": M{"minecraft": "1.21.1", "fabric-loader": "0.16.9"}, "files": []M{
		{"path": "mods/server.jar", "hashes": M{"sha512": hash}, "downloads": []string{"https://cdn.modrinth.com/server.jar"}, "env": M{"server": "required"}},
		{"path": "mods/client.jar", "hashes": M{"sha512": hash}, "downloads": []string{"https://cdn.modrinth.com/client.jar"}, "env": M{"server": "unsupported"}},
		{"path": "mods/optional.jar", "hashes": M{"sha512": hash}, "downloads": []string{"https://cdn.modrinth.com/optional.jar"}, "env": M{"server": "optional"}},
	}}
	raw, _ := json.Marshal(manifest)
	archive := minecraftFixtureZip(t, map[string][]byte{"modrinth.index.json": raw, "overrides/config/common.txt": []byte("common"), "server-overrides/config/common.txt": []byte("server"), "client-overrides/config/client.txt": []byte("client")})
	game, loader, version, files, err := minecraftParseMRPack(archive)
	if err != nil || game != "1.21.1" || loader != "fabric" || version != "0.16.9" || len(files) != 1 || files[0].Path != "mods/server.jar" {
		t.Fatalf("incorrect server manifest: %s %s %s %v %v", game, loader, version, files, err)
	}
	for _, name := range []string{"../escape", "/absolute", "C:/drive", "overrides/../../outside", "overrides\\mods\\x", "overrides/.voltra-start.sh"} {
		if _, err = minecraftReadZip(minecraftFixtureZip(t, map[string][]byte{name: []byte("bad")})); err == nil {
			t.Errorf("accepted unsafe ZIP %s", name)
		}
	}
	var out bytes.Buffer
	writer := zip.NewWriter(&out)
	header := &zip.FileHeader{Name: "overrides/link"}
	header.SetMode(os.ModeSymlink | 0777)
	entry, _ := writer.CreateHeader(header)
	_, _ = entry.Write([]byte("../../outside"))
	_ = writer.Close()
	if _, err = minecraftReadZip(out.Bytes()); err == nil {
		t.Fatal("accepted symlink ZIP")
	}
	oversized := minecraftFixtureZip(t, map[string][]byte{"overrides/config/big": []byte("tiny")})
	central := bytes.Index(oversized, []byte{'P', 'K', 1, 2})
	binary.LittleEndian.PutUint32(oversized[central+24:], 513<<20)
	if _, err = minecraftReadZip(oversized); err == nil {
		t.Fatal("accepted oversized ZIP entry")
	}
	badFile := minecraftDownload{URL: "https://cdn.modrinth.com/pack.mrpack", Hash: strings.Repeat("a", 128), Algorithm: "sha512"}
	if err = minecraftVerify(archive, badFile); err == nil {
		t.Fatal("accepted corrupt archive")
	}
}

func TestGameLibraryPackCatalogAndProvisioning(t *testing.T) {
	a, _, admin := infraTestApp(t)
	ctx := context.Background()
	mux := http.NewServeMux()
	a.registerGameLibrary(mux)
	manifest := M{"formatVersion": 1, "game": "minecraft", "dependencies": M{"minecraft": "1.21.1", "fabric-loader": "0.16.9"}, "files": []M{{"path": "mods/server.jar", "hashes": M{"sha512": strings.Repeat("c", 128)}, "downloads": []string{"https://cdn.modrinth.com/server.jar"}, "env": M{"server": "required"}}, {"path": "mods/client.jar", "hashes": M{"sha512": strings.Repeat("d", 128)}, "downloads": []string{"https://cdn.modrinth.com/client.jar"}, "env": M{"server": "unsupported"}}}}
	raw, _ := json.Marshal(manifest)
	mrArchive := minecraftFixtureZip(t, map[string][]byte{"modrinth.index.json": raw, "overrides/config/a": []byte("common"), "server-overrides/config/a": []byte("server")})
	cfManifest, _ := json.Marshal(M{"minecraft": M{"version": "1.21.1", "modLoaders": []M{{"id": "forge-52.0.3", "primary": true}}}})
	cfClient := minecraftFixtureZip(t, map[string][]byte{"manifest.json": cfManifest})
	cfServer := minecraftFixtureZip(t, map[string][]byte{"ServerPack/mods/server.jar": []byte("server-only"), "ServerPack/config/settings.cfg": []byte("configured"), "ServerPack/run.sh": []byte("must not execute")})
	cfFile := M{"id": 100, "modId": 42, "isAvailable": true, "displayName": "Server release", "gameVersions": []string{"1.21.1", "Forge"}, "downloadUrl": "https://edge.forgecdn.net/client.zip", "hashes": []M{{"algo": 1, "value": minecraftFixtureHash(cfClient, "sha1")}}, "serverPackFileId": 101}
	cfServerFile := M{"id": 101, "modId": 42, "isAvailable": true, "isServerPack": true, "parentProjectFileId": 100, "downloadUrl": "https://edge.forgecdn.net/server.zip", "hashes": []M{{"algo": 1, "value": minecraftFixtureHash(cfServer, "sha1")}}}
	mrProject := M{"id": "project", "project_type": "modpack", "title": "Server Pack", "description": "Fixture pack", "server_side": "required", "icon_url": "https://cdn.modrinth.com/data/project/icon.png"}
	fixture := map[string]any{
		"api.modrinth.com/v2/search":                  M{"hits": []M{{"project_id": "project", "title": "Server Pack", "description": "Fixture", "downloads": 123, "author": "Author"}}, "total_hits": 1},
		"api.modrinth.com/v2/project/project":         mrProject,
		"api.modrinth.com/v2/project/project/version": []M{{"id": "version", "project_id": "project", "name": "Release", "game_versions": []string{"1.21.1"}, "loaders": []string{"fabric"}, "files": []M{{"filename": "fixture.mrpack", "url": "https://cdn.modrinth.com/pack.mrpack", "primary": true, "hashes": M{"sha512": minecraftFixtureHash(mrArchive, "sha512")}}}}},
		"cdn.modrinth.com/pack.mrpack":                mrArchive,
		"api.curseforge.com/v1/mods/search":           M{"data": []M{{"id": 42, "name": "Curse Pack", "summary": "Fixture", "logo": M{"url": "https://media.forgecdn.net/icon.png"}, "authors": []M{{"name": "Author"}}, "downloadCount": 200}}, "pagination": M{"totalCount": 1}},
		"api.curseforge.com/v1/mods/42":               M{"data": M{"id": 42, "gameId": 432, "classId": 4471, "name": "Curse Pack", "summary": "Fixture", "logo": M{"url": "https://media.forgecdn.net/icon.png"}}},
		"api.curseforge.com/v1/mods/42/files":         M{"data": []M{cfFile}, "pagination": M{"totalCount": 1}},
		"api.curseforge.com/v1/mods/42/files/101":     M{"data": cfServerFile},
		"edge.forgecdn.net/client.zip":                cfClient, "edge.forgecdn.net/server.zip": cfServer,
	}
	provider := minecraftFixtureHTTP(t, fixture)
	requests := 0
	daemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { requests++; w.WriteHeader(202) }))
	defer daemon.Close()
	a.HTTP = &http.Client{Transport: gameLibraryTransport(func(r *http.Request) (*http.Response, error) {
		if r.URL.Host == strings.TrimPrefix(daemon.URL, "http://") {
			return http.DefaultTransport.RoundTrip(r)
		}
		if r.URL.Host == "api.curseforge.com" && r.Header.Get("x-api-key") != "private-fixture-key" {
			t.Error("missing private provider header")
		}
		return provider.Transport.RoundTrip(r)
	})}
	key, _ := a.seal(`{"api_key":"private-fixture-key"}`)
	if _, err := a.insert(ctx, "integrations", M{"name": "Catalog key", "provider": "curseforge", "credentials": key, "enabled": true}); err != nil {
		t.Fatal(err)
	}
	for _, catalogProvider := range []string{"modrinth", "curseforge"} {
		response := infraExpect(t, mux, admin, "GET", "/api/client/game-library/minecraft/modpacks?provider="+catalogProvider+"&query=fixture&offset=0&version=1.21.1&loader=forge", nil, 200)
		encoded, _ := json.Marshal(response)
		if bytes.Contains(encoded, []byte("private-fixture-key")) || len(asSlice(asMap(response["attributes"])["projects"])) != 1 {
			t.Fatal("catalog returned invalid rows or a credential")
		}
	}
	for _, route := range []string{"modrinth/project", "curseforge/42"} {
		response := asMap(infraExpect(t, mux, admin, "GET", "/api/client/game-library/minecraft/modpacks/"+route+"/versions", nil, 200)["attributes"])
		if len(asSlice(response["versions"])) != 1 || !boolean(asMap(asSlice(response["versions"])[0])["server_supported"]) {
			t.Fatal("server pack version not available")
		}
	}
	location, err := a.insert(ctx, "locations", M{"short": "packs"})
	if err != nil {
		t.Fatal(err)
	}
	nd := daemonTestNode(t, daemon)
	nd["uuid"] = newUUID()
	nd["name"] = "Pack node"
	nd["location_id"] = location["id"]
	nd["memory"], nd["disk"], nd["public"] = 32768, 100000, true
	nd["daemon_token"], _ = a.seal("fixture-token")
	node, err := a.insert(ctx, "nodes", nd)
	if err != nil {
		t.Fatal(err)
	}
	for port := 27000; port < 27004; port++ {
		if _, err = a.insert(ctx, "allocations", M{"node_id": node["id"], "ip": "127.0.0.1", "port": port}); err != nil {
			t.Fatal(err)
		}
	}
	for _, selection := range []M{{"provider": "modrinth", "project_id": "project", "version_id": "version"}, {"provider": "curseforge", "project_id": "42", "version_id": "100"}} {
		input := M{"name": "Pack fixture", "modpack": selection, "memory": 4096, "max_players": 20, "game_mode": "survival", "difficulty": "normal", "accept_eula": true, "request_id": newUUID()}
		result := asMap(infraExpect(t, mux, admin, "POST", "/api/client/game-library/minecraft/install", input, 201)["attributes"])
		server, err := a.one(ctx, "SELECT * FROM servers WHERE uuid_short=$1", result["identifier"])
		if err != nil {
			t.Fatal(err)
		}
		env, err := a.serverEnvironment(ctx, server)
		if err != nil {
			t.Fatal(err)
		}
		if env["MINECRAFT_VERSION"] != "1.21.1" || env["MINECRAFT_LOADER"] == "vanilla" || env["MINECRAFT_INSTALL_PLAN"] == "" {
			t.Fatal("pack did not populate loader requirements")
		}
		packArtwork := asMap(server["minecraft_pack"])
		if packArtwork["provider"] != selection["provider"] || packArtwork["project_id"] != selection["project_id"] || str(packArtwork["name"]) == "" || mcContentIcon(str(packArtwork["icon_url"])) == "" {
			t.Fatalf("Verified pack identity was not persisted: %#v", packArtwork)
		}
		// Renaming and a fresh DB read must retain the provider's pack identity.
		server, err = a.update(ctx, "servers", num(server["id"]), M{"name": "Custom display name"})
		if err != nil || str(asMap(server["minecraft_pack"])["icon_url"]) != str(packArtwork["icon_url"]) {
			t.Fatal("Renaming lost the modpack artwork")
		}
		raw, _ := json.Marshal(env)
		if bytes.Contains(raw, []byte("private-fixture-key")) {
			t.Fatal("provider key persisted in server environment")
		}
	}
	if requests != 2 {
		t.Fatal("pack installation did not provision exactly two servers")
	}
	mrProject["server_side"] = "unsupported"
	if _, err = a.minecraftModpackPlan(ctx, M{"provider": "modrinth", "project_id": "project", "version_id": "version"}); err == nil {
		t.Fatal("accepted client-only Modrinth pack")
	}
	mrProject["server_side"] = "required"
	cfFile["serverPackFileId"] = 0
	if _, err = a.minecraftModpackPlan(ctx, M{"provider": "curseforge", "project_id": "42", "version_id": "100"}); err == nil {
		t.Fatal("accepted CurseForge pack without approved server archive")
	}
	cfFile["serverPackFileId"] = 101
	cfServerFile["downloadUrl"] = ""
	if _, err = a.minecraftModpackPlan(ctx, M{"provider": "curseforge", "project_id": "42", "version_id": "100"}); err == nil || !strings.Contains(err.Error(), "disabled API downloads") {
		t.Fatalf("missing actionable disabled-download error: %v", err)
	}
}

func TestGameLibraryExtendedProvisioning(t *testing.T) {
	a, _, admin := infraTestApp(t)
	ctx := context.Background()
	mux := http.NewServeMux()
	a.registerGameLibrary(mux)
	requests := 0
	daemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/servers" || r.Method != "POST" {
			t.Errorf("unexpected Wings %s %s", r.Method, r.URL.Path)
		}
		requests++
		w.WriteHeader(202)
	}))
	defer daemon.Close()
	provider := minecraftFixtureHTTP(t, nil)
	base := http.DefaultTransport
	a.HTTP = &http.Client{Transport: gameLibraryTransport(func(r *http.Request) (*http.Response, error) {
		if r.URL.Host == strings.TrimPrefix(daemon.URL, "http://") {
			return base.RoundTrip(r)
		}
		return provider.Transport.RoundTrip(r)
	})}
	location, err := a.insert(ctx, "locations", M{"short": "extended"})
	if err != nil {
		t.Fatal(err)
	}
	nodeData := daemonTestNode(t, daemon)
	nodeData["location_id"] = location["id"]
	nodeData["uuid"] = newUUID()
	nodeData["name"] = "Extended node"
	nodeData["memory"] = 131072
	nodeData["disk"] = 1048576
	nodeData["public"] = true
	nodeData["daemon_token"], _ = a.seal("fixture-token")
	node, err := a.insert(ctx, "nodes", nodeData)
	if err != nil {
		t.Fatal(err)
	}
	for port := 26000; port < 26012; port++ {
		if _, err = a.insert(ctx, "allocations", M{"node_id": node["id"], "ip": "127.0.0.1", "port": port}); err != nil {
			t.Fatal(err)
		}
	}
	// Simulate the already-deployed old template, including an administrator edit.
	nest, err := a.insert(ctx, "nests", M{"uuid": gameLibraryNestUUID, "name": "Admin library", "author": "fixture@example.invalid"})
	if err != nil {
		t.Fatal(err)
	}
	old, err := a.insert(ctx, "eggs", M{"uuid": minecraftLibraryEggUUID, "nest_id": nest["id"], "name": "Edited vanilla", "author": "fixture@example.invalid", "script_install": "echo preserve-this-admin-edit"})
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		loader, game string
		java         int64
	}{{"vanilla", "1.12.2", 8}, {"paper", "1.21.1", 21}, {"fabric", "1.21.1", 21}, {"quilt", "1.21.1", 21}, {"forge", "1.12.2", 8}, {"forge", "1.17.1", 16}, {"neoforge", "26.1", 25}} {
		input := M{"name": "Fixture " + tc.loader, "version": tc.game, "loader": tc.loader, "loader_version": "stable", "memory": 3072, "max_players": 20, "game_mode": "survival", "difficulty": "normal", "accept_eula": true, "request_id": newUUID(), "runtime_id": "auto"}
		result := asMap(infraExpect(t, mux, admin, "POST", "/api/client/game-library/minecraft/install", input, 201)["attributes"])
		server, err := a.one(ctx, "SELECT * FROM servers WHERE uuid_short=$1", result["identifier"])
		if err != nil {
			t.Fatal(err)
		}
		if num(asMap(server["java_config"])["required_major"]) != tc.java || str(server["image"]) != fmt.Sprintf("ghcr.io/pterodactyl/yolks:java_%d", tc.java) {
			t.Fatal("wrong Java requirements/runtime")
		}
		environment, err := a.serverEnvironment(ctx, server)
		if err != nil {
			t.Fatal(err)
		}
		if environment["MINECRAFT_LOADER"] != tc.loader || environment["MINECRAFT_VERSION"] != tc.game || environment["MINECRAFT_LOADER_VERSION"] == "" || environment["MINECRAFT_INSTALL_PLAN"] == "" {
			t.Fatal("missing loader environment")
		}
		envelope, err := a.remoteEnvelope(ctx, server)
		if err != nil {
			t.Fatal(err)
		}
		encoded, _ := json.Marshal(envelope)
		if !bytes.Contains(encoded, []byte("java")) {
			t.Fatal("Wings did not receive Java invocation")
		}
		egg, err := a.one(ctx, "SELECT * FROM eggs WHERE id=$1", server["egg_id"])
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(str(egg["script_install"]), "bootstrap_java") || str(egg["script_container"]) != "ghcr.io/pterodactyl/installers:debian" {
			t.Fatal("invalid installer contract")
		}
		infraExpect(t, mux, admin, "POST", "/api/client/game-library/minecraft/install", input, 200)
	}
	if requests != 7 {
		t.Fatalf("expected 7 real Wings contract requests, got %d", requests)
	}
	preserved, err := a.one(ctx, "SELECT * FROM eggs WHERE id=$1", old["id"])
	if err != nil || preserved["script_install"] != "echo preserve-this-admin-edit" {
		t.Fatal("old managed egg edits were changed")
	}
	infraExpect(t, mux, admin, "GET", "/api/client/game-library/minecraft/modpacks?provider=curseforge", nil, 422)
	options := asMap(infraExpect(t, mux, admin, "GET", "/api/client/game-library/minecraft", nil, 200)["attributes"])
	if len(asSlice(options["loaders"])) != 6 || len(asSlice(options["runtimes"])) < 6 || len(asSlice(options["versions"])) != 6 {
		t.Fatal("incomplete setup options")
	}
}
