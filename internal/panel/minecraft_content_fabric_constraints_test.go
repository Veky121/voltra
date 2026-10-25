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
	"os"
	"strings"
	"sync"
	"testing"
)

func mcFabricTestJar(t *testing.T, body string) []byte {
	return mcLoaderTestJar(t, mcLoaderTestMember{name: "fabric.mod.json", body: body})
}
func TestMinecraftContentFabricTopLevelNativeSemantics(t *testing.T) {
	for _, tc := range []struct {
		extra, version string
		reject         bool
	}{
		{`"depends":{"fabricloader":">=0.15.11"}`, "0.20.1", false},
		{`"depends":{"fabricloader":">=0.15.11"}`, "0.15.10", true},
		{`"depends":{"fabricloader":["<0.15",">=0.20"]}`, "0.20.1", false},
		{`"depends":{"fabricloader":">=0.15 <0.20"}`, "0.20.1", true},
		{`"depends":{"fabricloader":"^0.15.1"}`, "0.20.1", false},
		{`"breaks":{"fabricloader":">=0.20"}`, "0.20.1", true},
		{`"breaks":{"fabricloader":"<0.20"}`, "0.20.1", false},
		{`"recommends":{"fabricloader":">=1"},"conflicts":{"fabricloader":"*"},"suggests":{"fabricloader":">=1"}`, "0.20.1", false},
		{`"depends":{"fabricloader":[]}`, "0.20.1", true},
	} {
		body := `{"schemaVersion":1,"id":"fixture","version":"1",` + tc.extra + `}`
		e := mcContentValidateFabricLoaderConstraints(mcFabricTestJar(t, body), mcLoaderTestInfo("fabric", tc.version))
		if (e != nil) != tc.reject {
			t.Errorf("%s / %s: %v", tc.extra, tc.version, e)
		}
	}
}
func TestMinecraftContentFabricMetadataPolicy(t *testing.T) {
	info := mcLoaderTestInfo("fabric", "0.20.1")
	for _, body := range []string{`{`, `[]`, `null`, `{"schemaVersion":null}`, `{"schemaVersion":2}`, `{"schemaVersion":1,"id":"fixture","version":"1","depends":{"fabricloader":null}}`, `{"schemaVersion":1,"id":"fixture","version":"1","depends":{"fabricloader":[null]}}`, `{"schemaVersion":1,"id":"fixture","version":"1","depends":{"fabricloader":42}}`, `{"schemaVersion":1,"id":"fixture","version":"1","depends":{"fabricloader":">=1.x"}}`, `{"schemaVersion":1,"id":"fixture","version":"1","depends":{"fabricloader":"*","fabricloader":">=1"}}`} {
		if e := mcContentValidateFabricLoaderConstraints(mcFabricTestJar(t, body), info); e == nil {
			t.Errorf("accepted malformed %s", body)
		}
	}
	for _, body := range []string{`{}`, `{"schemaVersion":0}`, `{"schemaVersion":1,"id":"fixture","version":"1"}`} {
		if e := mcContentValidateFabricLoaderConstraints(mcFabricTestJar(t, body), info); e != nil {
			t.Errorf("unknown/absent declaration: %v", e)
		}
	}
	if e := mcContentValidateFabricLoaderConstraints(mcLoaderTestJar(t, mcLoaderTestMember{name: "empty", body: "x"}), info); e != nil {
		t.Fatal(e)
	}
	for _, member := range []mcLoaderTestMember{{name: "Fabric.Mod.Json", body: `{}`}, {name: "fabric.mod.json", body: strings.Repeat("x", mcContentLoaderMetadataMax+1)}, {name: "fabric.mod.json", body: `{}`, symlink: true}} {
		if e := mcContentValidateFabricLoaderConstraints(mcLoaderTestJar(t, member), info); e == nil {
			t.Fatal("unsafe metadata accepted")
		}
	}
	if e := mcContentValidateFabricLoaderConstraints([]byte("not a JAR"), mcLoaderTestInfo("forge", "47.0")); e != nil {
		t.Fatal("unrelated family affected")
	}
}
func TestMinecraftContentFabricArchivedArtifactManifests(t *testing.T) {
	body, e := os.ReadFile("../../tools/runtime/fabric-artifact-manifests.json")
	if e != nil {
		t.Fatal(e)
	}
	var record struct {
		Manifests []struct{ Manifest json.RawMessage }
	}
	if e = json.Unmarshal(body, &record); e != nil || len(record.Manifests) != 2 {
		t.Fatal("bad archived fixtures", e)
	}
	for _, fixture := range record.Manifests {
		jar := mcFabricTestJar(t, string(fixture.Manifest))
		if e = mcContentValidateFabricLoaderConstraints(jar, mcLoaderTestInfo("fabric", "0.20.1")); e != nil {
			t.Fatal(e)
		}
		if e = mcContentValidateFabricLoaderConstraints(jar, mcLoaderTestInfo("fabric", "0.14.0")); e == nil {
			t.Fatal("old loader accepted")
		}
	}
}

// Exercises the actual provider-integrity -> manifest gate -> Wings route using
// a randomly isolated PostgreSQL schema and in-process provider/Wings fixtures.
func TestMinecraftContentFabricAtomicInstallRoute(t *testing.T) {
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
	location := insert("locations", M{"short": "fabric-constraints"})
	nodeData := daemonTestNode(t, wings)
	nodeData["uuid"] = newUUID()
	nodeData["name"] = "fabric-constraints"
	nodeData["location_id"] = location["id"]
	nodeData["daemon_token"], _ = a.seal("fixture-only")
	node := insert("nodes", nodeData)
	nest := insert("nests", M{"uuid": newUUID(), "name": "fabric-constraints", "author": "test"})
	egg := insert("eggs", M{"uuid": newUUID(), "nest_id": nest["id"], "name": "fabric-constraints", "author": "test"})
	insert("servers", M{"uuid": newUUID(), "uuid_short": "mcfabric", "identifier": "mcfabric", "name": "fabric-constraints", "owner_id": admin, "node_id": node["id"], "nest_id": nest["id"], "egg_id": egg["id"], "image": "test"})
	for name, value := range map[string]string{"MINECRAFT_VERSION": "1.21.1", "MINECRAFT_LOADER": "fabric", "MINECRAFT_LOADER_VERSION": "0.15.10"} {
		insert("egg_variables", M{"egg_id": egg["id"], "name": name, "env_variable": name, "default_value": value})
	}
	data := mcFabricTestJar(t, `{"schemaVersion":1,"id":"root","version":"1","depends":{"fabricloader":">=0.15.11"}}`)
	dependencyData := mcFabricTestJar(t, `{"schemaVersion":1,"id":"library","version":"1","depends":{"fabricloader":">=0.15.1"}}`)
	dependencyRelease := mcContentTestRelease(dependencyData, "library", "libraryrelease", "library.jar")
	release := mcContentTestRelease(data, "project", "release", "fabricroot.jar")
	release["dependencies"] = []any{M{"project_id": "library", "version_id": "libraryrelease", "dependency_type": "required"}}
	release["loaders"] = []any{"fabric"}
	project := mcContentTestProject("project")
	project["loaders"] = []any{"fabric"}
	credentials, _ := a.seal(`{"api_token":"fixture-only-token"}`)
	insert("integrations", M{"name": "fabric-constraints", "provider": "modrinth", "enabled": true, "credentials": credentials})
	downloads := 0
	a.HTTP = &http.Client{Transport: mcContentTestTransport(func(r *http.Request) (*http.Response, error) {
		switch r.URL.Host {
		case "api.modrinth.com":
			switch r.URL.Path {
			case "/v2/project/library":
				return mcContentTestResponse(mcContentTestProject("library")), nil
			case "/v2/version/libraryrelease":
				return mcContentTestResponse(dependencyRelease), nil
			case "/v2/project/project":
				return mcContentTestResponse(project), nil
			case "/v2/version/release":
				return mcContentTestResponse(release), nil
			}
		case "cdn.modrinth.com":
			downloads++
			body := data
			if strings.HasSuffix(r.URL.Path, "/library.jar") {
				body = dependencyData
			}
			return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(bytes.NewReader(body)), ContentLength: int64(len(body))}, nil
		default:
			return http.DefaultTransport.RoundTrip(r)
		}
		return nil, fmt.Errorf("unexpected fixture request %s", r.URL.Path)
	})}
	mux := http.NewServeMux()
	a.registerMinecraftContent(mux)
	payload := M{"provider": "modrinth", "project_id": "project", "version_id": "release"}
	route := "/api/client/servers/mcfabric/minecraft/content/install"
	rejection := infraExpect(t, mux, admin, "POST", route, payload, 422)
	if !strings.Contains(fmt.Sprint(rejection), "0.15.11") {
		t.Fatalf("missing actionable required build: %#v", rejection)
	}
	mu.Lock()
	if mutations != 0 || writes != 0 || renames != 0 || len(files) != 1 || sha256.Sum256(files["operator.jar"]) != existingHash {
		t.Errorf("rejected artifact changed Wings: mutations=%d writes=%d renames=%d files=%d", mutations, writes, renames, len(files))
	}
	mu.Unlock()
	if downloads != 2 {
		t.Fatalf("did not exercise actual integrity-checked download: %d", downloads)
	}
	if err := a.exec(context.Background(), "UPDATE egg_variables SET default_value=$1 WHERE egg_id=$2 AND env_variable=$3", "0.20.1", egg["id"], "MINECRAFT_LOADER_VERSION"); err != nil {
		t.Fatal(err)
	}
	infraExpect(t, mux, admin, "POST", route, payload, 201)
	mu.Lock()
	defer mu.Unlock()
	if writes != 2 || renames != 2 || len(files) != 3 || sha256.Sum256(files["operator.jar"]) != existingHash || !bytes.Equal(files["fabricroot.jar"], data) || !bytes.Equal(files["library.jar"], dependencyData) {
		t.Fatalf("valid loader install did not preserve existing file and commit verified bytes: writes=%d renames=%d files=%d", writes, renames, len(files))
	}
	if downloads != 4 {
		t.Fatalf("expected both provider-integrity paths: downloads=%d", downloads)
	}
}
