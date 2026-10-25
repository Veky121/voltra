package panel

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

// Exercises the actual provider-integrity -> manifest gate -> Wings route using
// a randomly isolated PostgreSQL schema and in-process provider/Wings fixtures.
func TestMinecraftContentLoaderConstraintsInstallRoute(t *testing.T) {
	a, _, admin := infraTestApp(t)
	insert := func(table string, row M) M {
		t.Helper()
		value, err := a.insert(context.Background(), table, row)
		if err != nil {
			t.Fatal(err)
		}
		return value
	}
	existing := []byte("operator-owned existing file\x00\xff")
	existingHash := sha256.Sum256(existing)
	files := map[string][]byte{"operator.jar": append([]byte(nil), existing...)}
	var mu sync.Mutex
	mutations, writes, renames := 0, 0, 0
	wings := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		if r.Method != "GET" {
			mutations++
		}
		switch {
		case strings.HasSuffix(r.URL.Path, "/files/list-directory"):
			entries := []M{}
			for name, data := range files {
				entries = append(entries, M{"name": name, "file": true, "size": len(data)})
			}
			writeJSON(w, 200, entries)
		case strings.HasSuffix(r.URL.Path, "/files/create-directory"):
			w.WriteHeader(204)
		case strings.HasSuffix(r.URL.Path, "/files/write"):
			writes++
			body, err := io.ReadAll(r.Body)
			if err != nil {
				t.Error(err)
			}
			files[strings.TrimPrefix(r.URL.Query().Get("file"), "/mods/")] = body
			w.WriteHeader(204)
		case strings.HasSuffix(r.URL.Path, "/files/rename"):
			renames++
			var input M
			if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
				t.Error(err)
			}
			for _, value := range asSlice(input["files"]) {
				file := asMap(value)
				from, to := str(file["from"]), str(file["to"])
				files[to] = files[from]
				delete(files, from)
			}
			w.WriteHeader(204)
		case strings.HasSuffix(r.URL.Path, "/files/delete"):
			var input M
			_ = json.NewDecoder(r.Body).Decode(&input)
			for _, value := range asSlice(input["files"]) {
				delete(files, str(value))
			}
			w.WriteHeader(204)
		default:
			writeJSON(w, 200, M{"state": "offline"})
		}
	}))
	defer wings.Close()
	location := insert("locations", M{"short": "loader-constraints"})
	nodeData := daemonTestNode(t, wings)
	nodeData["uuid"] = newUUID()
	nodeData["name"] = "loader-constraints"
	nodeData["location_id"] = location["id"]
	nodeData["daemon_token"], _ = a.seal("fixture-only")
	node := insert("nodes", nodeData)
	nest := insert("nests", M{"uuid": newUUID(), "name": "loader-constraints", "author": "test"})
	egg := insert("eggs", M{"uuid": newUUID(), "nest_id": nest["id"], "name": "loader-constraints", "author": "test"})
	insert("servers", M{"uuid": newUUID(), "uuid_short": "mcloader", "identifier": "mcloader", "name": "loader-constraints", "owner_id": admin, "node_id": node["id"], "nest_id": nest["id"], "egg_id": egg["id"], "image": "test"})
	for name, value := range map[string]string{"MINECRAFT_VERSION": "1.21.1", "MINECRAFT_LOADER": "neoforge", "MINECRAFT_LOADER_VERSION": "21.1.217"} {
		insert("egg_variables", M{"egg_id": egg["id"], "name": name, "env_variable": name, "default_value": value})
	}
	data := mcLoaderTestJar(t, mcLoaderTestMember{name: "META-INF/neoforge.mods.toml", body: mcLoaderTestManifest("neoforge", "[21.1.218,)", "type='required'\nside='BOTH'")})
	release := mcContentTestRelease(data, "project", "release", "ferritecore.jar")
	release["loaders"] = []any{"neoforge"}
	project := mcContentTestProject("project")
	project["loaders"] = []any{"neoforge"}
	credentials, _ := a.seal(`{"api_token":"fixture-only-token"}`)
	insert("integrations", M{"name": "loader-constraints", "provider": "modrinth", "enabled": true, "credentials": credentials})
	downloads := 0
	a.HTTP = &http.Client{Transport: mcContentTestTransport(func(r *http.Request) (*http.Response, error) {
		switch r.URL.Host {
		case "api.modrinth.com":
			switch r.URL.Path {
			case "/v2/project/project":
				return mcContentTestResponse(project), nil
			case "/v2/version/release":
				return mcContentTestResponse(release), nil
			}
		case "cdn.modrinth.com":
			downloads++
			return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(bytes.NewReader(data)), ContentLength: int64(len(data))}, nil
		default:
			return http.DefaultTransport.RoundTrip(r)
		}
		return nil, fmt.Errorf("unexpected fixture request %s", r.URL.Path)
	})}
	mux := http.NewServeMux()
	a.registerMinecraftContent(mux)
	payload := M{"provider": "modrinth", "project_id": "project", "version_id": "release"}
	route := "/api/client/servers/mcloader/minecraft/content/install"
	rejection := infraExpect(t, mux, admin, "POST", route, payload, 422)
	if !strings.Contains(fmt.Sprint(rejection), "21.1.218") {
		t.Fatalf("missing actionable required build: %#v", rejection)
	}
	mu.Lock()
	if mutations != 0 || writes != 0 || renames != 0 || len(files) != 1 || sha256.Sum256(files["operator.jar"]) != existingHash {
		t.Errorf("rejected artifact changed Wings: mutations=%d writes=%d renames=%d files=%d", mutations, writes, renames, len(files))
	}
	mu.Unlock()
	if downloads != 1 {
		t.Fatalf("did not exercise actual integrity-checked download: %d", downloads)
	}
	if err := a.exec(context.Background(), "UPDATE egg_variables SET default_value=$1 WHERE egg_id=$2 AND env_variable=$3", "21.1.264", egg["id"], "MINECRAFT_LOADER_VERSION"); err != nil {
		t.Fatal(err)
	}
	infraExpect(t, mux, admin, "POST", route, payload, 201)
	mu.Lock()
	defer mu.Unlock()
	if writes != 1 || renames != 1 || len(files) != 2 || sha256.Sum256(files["operator.jar"]) != existingHash || !bytes.Equal(files["ferritecore.jar"], data) {
		t.Fatalf("valid loader install did not preserve existing file and commit verified bytes: writes=%d renames=%d files=%d", writes, renames, len(files))
	}
	if downloads != 2 {
		t.Fatalf("expected both provider-integrity paths: downloads=%d", downloads)
	}
}
