package panel

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha1"
	"crypto/sha512"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
)

type mcContentTestTransport func(*http.Request) (*http.Response, error)

func (f mcContentTestTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func mcContentTestResponse(value any) *http.Response {
	data, _ := json.Marshal(value)
	return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(bytes.NewReader(data))}
}
func mcContentTestJAR(t *testing.T) []byte {
	t.Helper()
	var data bytes.Buffer
	w := zip.NewWriter(&data)
	f, e := w.Create("META-INF/MANIFEST.MF")
	if e != nil {
		t.Fatal(e)
	}
	_, _ = f.Write([]byte("Manifest-Version: 1.0\n"))
	if e = w.Close(); e != nil {
		t.Fatal(e)
	}
	return data.Bytes()
}
func mcContentTestRelease(data []byte, project, version, filename string) M {
	sum := sha512.Sum512(data)
	return M{"id": version, "project_id": project, "version_number": version, "date_published": "2026-10-22T00:00:00Z", "game_versions": []any{"1.21.1"}, "loaders": []any{"fabric"}, "dependencies": []any{}, "files": []any{M{"primary": true, "filename": filename, "url": "https://cdn.modrinth.com/data/" + project + "/versions/" + version + "/" + filename, "size": len(data), "hashes": M{"sha512": hex.EncodeToString(sum[:])}}}}
}
func mcContentTestProject(id string) M {
	return M{"id": id, "project_type": "mod", "server_side": "required", "game_versions": []any{"1.21.1"}, "loaders": []any{"fabric"}}
}

func TestMinecraftContentPathsEnvironmentAndAcknowledgment(t *testing.T) {
	for _, name := range []string{"../escape.jar", "/root.jar", "a\\b.jar", "a%2fb.jar", "x.jar\n", "x:foo.jar", ".hidden.jar", "bad.jar.exe", "x\x00.jar", " x.jar"} {
		if mcContentSafeFilename(name) {
			t.Errorf("accepted unsafe filename %q", name)
		}
	}
	if !mcContentSafeFilename("fabric-api-0.99+1.21.jar") {
		t.Fatal("safe JAR rejected")
	}
	for _, address := range []string{"http://cdn.modrinth.com/a.jar", "https://cdn.modrinth.com.evil.test/a.jar", "https://cdn.modrinth.com:443/a.jar", "https://user@cdn.modrinth.com/a.jar", "https://127.0.0.1/a.jar", "file:///a.jar"} {
		if mcContentDownloadURL("modrinth", address) {
			t.Errorf("accepted download %s", address)
		}
	}
	for _, env := range []M{{}, {"MINECRAFT_VERSION": "latest", "MINECRAFT_LOADER": "fabric"}, {"MINECRAFT_VERSION": "1.21.1", "MINECRAFT_LOADER": "vanilla"}, {"MINECRAFT_VERSION": "1.21.1", "MINECRAFT_LOADER": "custom"}} {
		if _, reason := mcContentEnvironment(env); reason == "" {
			t.Fatal("accepted unsupported environment")
		}
	}
	info, reason := mcContentEnvironment(M{"MINECRAFT_VERSION": "1.21.1", "MINECRAFT_LOADER": "fabric"})
	if reason != "" || info.Directory != "/mods" {
		t.Fatal("valid environment rejected")
	}
	for _, ack := range []any{nil, false, "true", 1} {
		if mcContentAcknowledged("curseforge", info, M{"confirm_server_compatibility": ack}) == nil {
			t.Fatal("accepted missing or mistyped acknowledgement")
		}
	}
	if mcContentAcknowledged("curseforge", info, M{"confirm_server_compatibility": true}) != nil {
		t.Fatal("ack rejected")
	}
	info.Kind = "plugin"
	if mcContentAcknowledged("curseforge", info, M{}) != nil {
		t.Fatal("plugin requires mod acknowledgement")
	}
	if mcContentErrorDetail(&APIError{Status: 422, Detail: "test detail"}) != "test detail" {
		t.Fatal("pointer error detail lost")
	}
}

func TestMinecraftContentIntegrityAndRedirects(t *testing.T) {
	data := mcContentTestJAR(t)
	sum := sha512.Sum512(data)
	v := mcContentRelease{Filename: "test.jar", URL: "https://cdn.modrinth.com/test.jar", Algorithm: "sha512", Hash: hex.EncodeToString(sum[:]), Size: int64(len(data))}
	var calls int
	a := &App{HTTP: &http.Client{Transport: mcContentTestTransport(func(r *http.Request) (*http.Response, error) {
		calls++
		if r.Header.Get("Authorization") != "" || r.Header.Get("x-api-key") != "" {
			t.Error("credential sent to CDN")
		}
		return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(bytes.NewReader(data)), ContentLength: int64(len(data))}, nil
	})}}
	p := mcContentProvider{app: a, name: "modrinth", credential: "private-test-token"}
	if _, e := p.download(context.Background(), v); e != nil {
		t.Fatal(e)
	}
	invalid := v
	invalid.Hash = strings.Repeat("0", 128)
	if _, e := p.download(context.Background(), invalid); e == nil {
		t.Fatal("hash mismatch accepted")
	}
	invalid = v
	invalid.Size--
	if _, e := p.download(context.Background(), invalid); e == nil {
		t.Fatal("size mismatch accepted")
	}
	invalid = v
	invalid.URL = "http://127.0.0.1/secret.jar"
	before := calls
	if _, e := p.download(context.Background(), invalid); e == nil || calls != before {
		t.Fatal("arbitrary URL fetched")
	}
	a.HTTP.Transport = mcContentTestTransport(func(r *http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 302, Header: http.Header{"Location": []string{"http://127.0.0.1/private"}}, Body: io.NopCloser(strings.NewReader(""))}, nil
	})
	if _, e := p.download(context.Background(), v); e == nil {
		t.Fatal("unsafe redirect accepted")
	}
	// Correctly hashed HTML is still not a JAR.
	html := []byte("<html>not a jar</html>")
	hash := sha512.Sum512(html)
	v.Size = int64(len(html))
	v.Hash = hex.EncodeToString(hash[:])
	a.HTTP.Transport = mcContentTestTransport(func(r *http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(bytes.NewReader(html))}, nil
	})
	if _, e := p.download(context.Background(), v); e == nil {
		t.Fatal("non-JAR accepted")
	}
}

func TestMinecraftContentCompatibilityAndDependencies(t *testing.T) {
	data := mcContentTestJAR(t)
	info := mcContentInfo{Version: "1.21.1", Loader: "fabric", Kind: "mod"}
	root := mcContentTestRelease(data, "root", "rootV", "root.jar")
	dep := mcContentTestRelease(data, "dep", "depV", "dep.jar")
	root["dependencies"] = []any{M{"project_id": "dep", "version_id": "depV", "dependency_type": "required"}}
	clientOnly := false
	wrongLoader := false
	a := &App{HTTP: &http.Client{Transport: mcContentTestTransport(func(r *http.Request) (*http.Response, error) {
		if r.Header.Get("Authorization") != "private-test-token" {
			t.Error("metadata credential missing")
		}
		switch r.URL.Path {
		case "/v2/project/root":
			return mcContentTestResponse(mcContentTestProject("root")), nil
		case "/v2/project/dep":
			project := mcContentTestProject("dep")
			if clientOnly {
				project["server_side"] = "unsupported"
			}
			return mcContentTestResponse(project), nil
		case "/v2/version/depV":
			if wrongLoader {
				row := mcContentTestRelease(data, "dep", "depV", "dep.jar")
				row["loaders"] = []any{"forge"}
				return mcContentTestResponse(row), nil
			}
			return mcContentTestResponse(dep), nil
		case "/v2/version/rootV":
			return mcContentTestResponse(root), nil
		default:
			t.Errorf("unexpected provider path %s", r.URL.Path)
			return mcContentTestResponse(M{}), nil
		}
	})}}
	p := mcContentProvider{app: a, name: "modrinth", credential: "private-test-token"}
	parsed := p.parseReleases(info, "root", []M{root})
	if len(parsed) != 1 {
		t.Fatal("valid root rejected")
	}
	plan, e := p.plan(context.Background(), info, parsed[0])
	if e != nil || len(plan) != 2 || plan[0].Project != "dep" {
		t.Fatalf("dependency not resolved: %v", e)
	}
	clientOnly = true
	if _, e = p.plan(context.Background(), info, parsed[0]); e == nil {
		t.Fatal("client-only dependency accepted")
	}
	clientOnly = false
	wrongLoader = true
	if _, e = p.plan(context.Background(), info, parsed[0]); e == nil {
		t.Fatal("wrong-loader dependency accepted")
	}
	wrongLoader = false
	dep["dependencies"] = []any{M{"project_id": "root", "version_id": "rootV", "dependency_type": "required"}}
	if _, e = p.plan(context.Background(), info, parsed[0]); e == nil || !strings.Contains(mcContentErrorDetail(e), "cycle") {
		t.Fatal("dependency cycle was not blocked")
	}
	dep["dependencies"] = []any{}
	conflict := parsed[0]
	conflict.Dependencies = append(append([]mcContentDependency{}, conflict.Dependencies...), mcContentDependency{Project: "root", Version: "depV", Kind: "required"})
	if _, e = p.plan(context.Background(), info, conflict); e == nil {
		t.Fatal("project/version mismatch was not blocked")
	}
	root["loaders"] = []any{"forge"}
	if len(p.parseReleases(info, "root", []M{root})) != 0 {
		t.Fatal("wrong loader accepted")
	}
	root["loaders"] = []any{"fabric"}
	root["environment"] = "client_only"
	if len(p.parseReleases(info, "root", []M{root})) != 0 {
		t.Fatal("client-only version of a server-compatible project accepted")
	}
	delete(root, "environment")
	root["game_versions"] = []any{"1.20.1"}
	if len(p.parseReleases(info, "root", []M{root})) != 0 {
		t.Fatal("wrong Minecraft version accepted")
	}
	root["game_versions"] = []any{"1.21.1"}
	root["project_id"] = "other"
	if len(p.parseReleases(info, "root", []M{root})) != 0 {
		t.Fatal("wrong project accepted")
	}
	blocker := parsed[0]
	blocker.Dependencies = []mcContentDependency{{Project: "unknown", Kind: "incompatible"}}
	if _, e = p.plan(context.Background(), info, blocker); e == nil {
		t.Fatal("incompatible declaration ignored")
	}
	blocker.Dependencies = []mcContentDependency{{Kind: "required"}}
	if _, e = p.plan(context.Background(), info, blocker); e == nil {
		t.Fatal("unresolvable required dependency ignored")
	}
}

func TestMinecraftContentCurseForgeProtocol(t *testing.T) {
	data := mcContentTestJAR(t)
	sum := sha1.Sum(data)
	info := mcContentInfo{Version: "1.21.1", Loader: "fabric", Kind: "mod"}
	row := M{"id": 100, "modId": 12, "isAvailable": true, "fileName": "mod.jar", "fileLength": len(data), "downloadUrl": "https://edge.forgecdn.net/files/100/mod.jar", "hashes": []any{M{"algo": 1, "value": hex.EncodeToString(sum[:])}}, "gameVersions": []any{"1.21.1", "Fabric"}, "dependencies": []any{M{"modId": 13, "relationType": 3}}}
	var requests int
	a := &App{HTTP: &http.Client{Transport: mcContentTestTransport(func(r *http.Request) (*http.Response, error) {
		requests++
		if r.URL.Host != "api.curseforge.com" || r.Header.Get("x-api-key") != "private-cf-key" {
			t.Error("wrong provider auth")
		}
		switch r.URL.Path {
		case "/v1/mods/12":
			return mcContentTestResponse(M{"data": M{"id": 12, "gameId": 432, "classId": 6, "allowModDistribution": true}}), nil
		case "/v1/mods/12/files":
			if r.URL.Query().Get("gameVersion") != "1.21.1" || r.URL.Query().Get("modLoaderType") != "4" {
				t.Error("compatibility filters missing")
			}
			return mcContentTestResponse(M{"data": []any{row}}), nil
		}
		t.Errorf("unexpected path %s", r.URL.Path)
		return mcContentTestResponse(M{}), nil
	})}}
	p := mcContentProvider{app: a, name: "curseforge", credential: "private-cf-key"}
	versions, e := p.releases(context.Background(), info, "12")
	if e != nil || len(versions) != 1 || len(versions[0].Dependencies) != 1 || versions[0].Dependencies[0].Kind != "required" {
		t.Fatal("CurseForge protocol failed", e)
	}
	if requests != 2 {
		t.Fatal("project validation omitted")
	}
	row["gameVersions"] = []any{"1.21.1", "Forge"}
	if len(p.parseReleases(info, "12", []M{row})) != 0 {
		t.Fatal("wrong CF loader accepted")
	}
	row["gameVersions"] = []any{"1.21.1", "Fabric"}
	row["downloadUrl"] = "https://evil.invalid/mod.jar"
	if p.parseReleases(info, "12", []M{row})[0].Blocked == "" {
		t.Fatal("unsafe provider download allowed")
	}
}

func TestMinecraftContentPermissionsAndDaemonInstall(t *testing.T) {
	a, _, admin := infraTestApp(t)
	ctx := context.Background()
	insert := func(table string, row M) M {
		t.Helper()
		result, e := a.insert(ctx, table, row)
		if e != nil {
			t.Fatal(e)
		}
		return result
	}
	files := map[string][]byte{}
	var mu sync.Mutex
	var running atomic.Bool
	var corrupt atomic.Bool
	var writeCalls atomic.Int32
	var failRename atomic.Bool
	var normalizedListing atomic.Bool
	daemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		switch {
		case strings.HasSuffix(r.URL.Path, "/files/list-directory"):
			entries := []M{}
			for name, data := range files {
				entry := M{"name": name, "file": true, "size": len(data), "mime": "application/java-archive", "modified": "2026-10-23T00:00:00Z"}
				if normalizedListing.Load() {
					entry = opFileTransform(entry)
				}
				entries = append(entries, entry)
			}
			writeJSON(w, 200, entries)
		case strings.HasSuffix(r.URL.Path, "/files/create-directory"):
			w.WriteHeader(204)
		case strings.HasSuffix(r.URL.Path, "/files/write"):
			writeCalls.Add(1)
			if r.ContentLength <= 0 {
				t.Error("Wings write needs Content-Length")
			}
			data, _ := io.ReadAll(r.Body)
			name := strings.TrimPrefix(r.URL.Query().Get("file"), "/mods/")
			if !strings.HasPrefix(name, ".voltra-content-") {
				t.Error("write was not staged")
			}
			files[name] = data
			w.WriteHeader(204)
		case strings.HasSuffix(r.URL.Path, "/files/rename"):
			if failRename.Load() {
				writeJSON(w, 409, M{"error": "rename denied"})
				return
			}
			var input M
			_ = json.NewDecoder(r.Body).Decode(&input)
			file := asMap(asSlice(input["files"])[0])
			from, to := str(file["from"]), str(file["to"])
			if _, exists := files[to]; exists {
				writeJSON(w, 409, M{"error": "exists"})
				return
			}
			files[to] = files[from]
			delete(files, from)
			w.WriteHeader(204)
		case strings.HasSuffix(r.URL.Path, "/files/delete"):
			var input M
			_ = json.NewDecoder(r.Body).Decode(&input)
			for _, name := range asSlice(input["files"]) {
				delete(files, str(name))
			}
			w.WriteHeader(204)
		default:
			state := "offline"
			if running.Load() {
				state = "running"
			}
			writeJSON(w, 200, M{"state": state})
		}
	}))
	defer daemon.Close()
	location := insert("locations", M{"short": "content"})
	nodeData := daemonTestNode(t, daemon)
	nodeData["uuid"] = newUUID()
	nodeData["name"] = "content"
	nodeData["location_id"] = location["id"]
	nodeData["daemon_token"], _ = a.seal("secret")
	node := insert("nodes", nodeData)
	nest := insert("nests", M{"uuid": newUUID(), "name": "content", "author": "test"})
	egg := insert("eggs", M{"uuid": newUUID(), "nest_id": nest["id"], "name": "managed", "author": "test"})
	server := insert("servers", M{"uuid": newUUID(), "uuid_short": "mccontent", "identifier": "mccontent", "name": "content", "owner_id": admin, "node_id": node["id"], "nest_id": nest["id"], "egg_id": egg["id"], "image": "test"})
	for name, value := range map[string]string{"MINECRAFT_VERSION": "1.21.1", "MINECRAFT_LOADER": "fabric", "MINECRAFT_LOADER_VERSION": "0.16.9"} {
		insert("egg_variables", M{"egg_id": egg["id"], "name": name, "env_variable": name, "default_value": value})
	}
	member := insert("users", M{"uuid": newUUID(), "username": "content-member", "email": "content-member@example.invalid"})
	sub := insert("subusers", M{"user_id": member["id"], "server_id": server["id"], "permissions": []any{"file.read"}})
	other := insert("users", M{"uuid": newUUID(), "username": "other-content", "email": "other-content@example.invalid"})
	data := mcContentTestJAR(t)
	root := mcContentTestRelease(data, "project", "release", "test.jar")
	cfSum := sha1.Sum(data)
	cfFile := M{"id": 100, "modId": 12, "isAvailable": true, "fileName": "cfmod.jar", "fileLength": len(data), "downloadUrl": "https://edge.forgecdn.net/files/100/cfmod.jar", "hashes": []any{M{"algo": 1, "value": hex.EncodeToString(cfSum[:])}}, "gameVersions": []any{"1.21.1", "Fabric"}, "dependencies": []any{}}
	var tokenOnMetadata bool
	a.HTTP = &http.Client{Transport: mcContentTestTransport(func(r *http.Request) (*http.Response, error) {
		switch r.URL.Host {
		case "api.modrinth.com":
			if r.Header.Get("Authorization") == "private-content-token" {
				tokenOnMetadata = true
			}
			switch r.URL.Path {
			case "/v2/search":
				return mcContentTestResponse(M{"hits": []any{}}), nil
			case "/v2/project/project":
				return mcContentTestResponse(mcContentTestProject("project")), nil
			case "/v2/version/release":
				return mcContentTestResponse(root), nil
			}
		case "api.curseforge.com":
			if r.Header.Get("x-api-key") != "private-content-cf-key" {
				t.Error("global CurseForge key missing")
			}
			if r.URL.Path == "/v1/mods/12" {
				return mcContentTestResponse(M{"data": M{"id": 12, "gameId": 432, "classId": 6, "allowModDistribution": true}}), nil
			}
			if r.URL.Path == "/v1/mods/12/files/100" {
				return mcContentTestResponse(M{"data": cfFile}), nil
			}
		case "cdn.modrinth.com", "edge.forgecdn.net":
			if r.Header.Get("Authorization") != "" || r.Header.Get("x-api-key") != "" {
				t.Error("secret sent to download host")
			}
			body := data
			if corrupt.Load() {
				body = []byte(strings.Repeat("x", len(data)))
			}
			return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(bytes.NewReader(body)), ContentLength: int64(len(body))}, nil
		default:
			return http.DefaultTransport.RoundTrip(r)
		}
		return nil, fmt.Errorf("unexpected request")
	})}
	credentials, _ := a.seal(`{"api_token":"private-content-token"}`)
	insert("integrations", M{"name": "content Modrinth", "provider": "modrinth", "enabled": true, "credentials": credentials})
	cfCredentials, _ := a.seal(`{"api_key":"private-content-cf-key"}`)
	insert("integrations", M{"name": "content CurseForge", "provider": "curseforge", "enabled": true, "credentials": cfCredentials})
	mux := http.NewServeMux()
	a.registerMinecraftContent(mux)
	base := "/api/client/servers/mccontent/minecraft/content"
	payload := M{"provider": "modrinth", "project_id": "project", "version_id": "release"}
	memberID := num(member["id"])
	infraExpect(t, mux, num(other["id"]), "GET", base, nil, 404)
	infraExpect(t, mux, memberID, "POST", base+"/install", payload, 403)
	infraExpect(t, mux, memberID, "DELETE", base+"/file", M{"file": "test.jar"}, 403)
	catalog := infraExpect(t, mux, memberID, "GET", base, nil, 200)
	raw, _ := json.Marshal(catalog)
	if strings.Contains(string(raw), "private-content-token") || !tokenOnMetadata {
		t.Fatal("global credential handling failed")
	}
	if e := a.exec(ctx, "UPDATE subusers SET permissions=$1 WHERE id=$2", []any{"file.read", "file.create", "file.delete"}, sub["id"]); e != nil {
		t.Fatal(e)
	}
	infraExpect(t, mux, memberID, "POST", base+"/install", M{"provider": "curseforge", "project_id": "12", "version_id": "100"}, 422)
	infraExpect(t, mux, memberID, "POST", base+"/install", M{"provider": "curseforge", "project_id": "12", "version_id": "100", "confirm_server_compatibility": "true"}, 422)
	running.Store(true)
	infraExpect(t, mux, memberID, "POST", base+"/install", payload, 409)
	if writeCalls.Load() != 0 {
		t.Fatal("running server was changed")
	}
	running.Store(false)
	corrupt.Store(true)
	infraExpect(t, mux, memberID, "POST", base+"/install", payload, 422)
	if writeCalls.Load() != 0 {
		t.Fatal("corrupt download written")
	}
	corrupt.Store(false)
	failRename.Store(true)
	infraExpect(t, mux, memberID, "POST", base+"/install", payload, 409)
	mu.Lock()
	remaining := len(files)
	mu.Unlock()
	if remaining != 0 {
		t.Fatal("staged files leaked after rename failure")
	}
	failRename.Store(false)
	infraExpect(t, mux, memberID, "POST", base+"/install", payload, 201)
	mu.Lock()
	installed := bytes.Equal(files["test.jar"], data)
	remaining = len(files)
	mu.Unlock()
	if !installed || remaining != 1 {
		t.Fatal("verified file not installed or staging leaked")
	}
	catalog = infraExpect(t, mux, memberID, "GET", base, nil, 200)
	listed := asSlice(asMap(catalog["attributes"])["installed"])
	if len(listed) != 1 || str(asMap(listed[0])["file"]) != "test.jar" || str(asMap(listed[0])["modified_at"]) != "2026-10-23T00:00:00Z" {
		t.Fatalf("raw Wings file listing did not expose installed content: %#v", listed)
	}
	normalizedListing.Store(true)
	catalog = infraExpect(t, mux, memberID, "GET", base, nil, 200)
	listed = asSlice(asMap(catalog["attributes"])["installed"])
	if len(listed) != 1 || str(asMap(listed[0])["modified_at"]) != "2026-10-23T00:00:00Z" {
		t.Fatalf("already-normalized listing changed: %#v", listed)
	}
	infraExpect(t, mux, memberID, "POST", base+"/install", payload, 422)
	infraExpect(t, mux, memberID, "DELETE", base+"/file", M{"file": "../test.jar"}, 422)
	running.Store(true)
	infraExpect(t, mux, memberID, "DELETE", base+"/file", M{"file": "test.jar"}, 409)
	running.Store(false)
	infraExpect(t, mux, memberID, "DELETE", base+"/file", M{"file": "test.jar"}, 204)
	infraExpect(t, mux, memberID, "POST", base+"/install", M{"provider": "curseforge", "project_id": "12", "version_id": "100", "confirm_server_compatibility": true}, 201)
	infraExpect(t, mux, memberID, "DELETE", base+"/file", M{"file": "cfmod.jar"}, 204)
	mu.Lock()
	remaining = len(files)
	mu.Unlock()
	if remaining != 0 {
		t.Fatal("remove did not delete file")
	}
}
