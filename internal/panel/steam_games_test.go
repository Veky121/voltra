package panel

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"path"
	"strings"
	"sync"
	"testing"
	"voltra/internal/steamapi"
)

// A fake Wings fixture, never a game process or a real game volume. All database
// writes use infraTestApp's random PostgreSQL schema and are dropped on cleanup.
type steamGamesWings struct {
	mu                            sync.Mutex
	Files                         map[string][]byte
	Folders                       map[string][]M
	State, Architecture, Platform string
	Creates, Writes               int
	RejectCreate                  bool
	ListFailures, ReadFailures    map[string]int
	MissingParentRequests         int
	FailWriteOnce                 string
}

// Infer the same hierarchy a real filesystem exposes, including root entries
// and implicit parents of fixture files. Explicit entries can model symlinks or
// an advertised but unreadable directory.
func (f *steamGamesWings) directory(folder string) ([]M, bool) {
	explicit, exists := f.Folders[folder]
	entries := append([]M{}, explicit...)
	if folder == "/" {
		exists = true
	}
	prefix := strings.TrimSuffix(folder, "/") + "/"
	add := func(name string, directory bool) {
		for _, entry := range entries {
			if str(entry["name"]) == name {
				return
			}
		}
		entries = append(entries, M{"name": name, "directory": directory, "file": !directory, "symlink": false})
	}
	for name := range f.Files {
		if strings.HasPrefix(name, prefix) {
			rest := strings.TrimPrefix(name, prefix)
			if rest != "" {
				exists = true
				part, _, nested := strings.Cut(rest, "/")
				add(part, nested)
			}
		}
	}
	for name := range f.Folders {
		if strings.HasPrefix(name, prefix) {
			rest := strings.TrimPrefix(name, prefix)
			if rest != "" {
				exists = true
				part, _, _ := strings.Cut(rest, "/")
				add(part, true)
			}
		}
	}
	return entries, exists
}

func (f *steamGamesWings) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if r.Header.Get("Authorization") != "Bearer fixture-daemon-token" {
		http.Error(w, "incorrect daemon authentication", 401)
		return
	}
	if r.URL.Path == "/api/system" {
		if r.URL.Query().Get("v") != "2" {
			http.Error(w, "fixture expects v2 platform response", 422)
			return
		}
		writeJSON(w, 200, M{"version": "fixture", "system": M{"os_type": f.Platform, "architecture": f.Architecture}})
		return
	}
	if r.Method == "POST" && r.URL.Path == "/api/servers" {
		var input M
		_ = json.NewDecoder(r.Body).Decode(&input)
		if boolean(input["start_on_completion"]) {
			http.Error(w, "bootstrap must not start the game", 422)
			return
		}
		f.Creates++
		if f.RejectCreate {
			http.Error(w, "fixture rejected create", 503)
			return
		}
		w.WriteHeader(202)
		return
	}
	if r.Method == "POST" && strings.HasSuffix(r.URL.Path, "/sync") {
		w.WriteHeader(204)
		return
	}
	if strings.HasSuffix(r.URL.Path, "/files/contents") {
		name := r.URL.Query().Get("file")
		if status := f.ReadFailures[name]; status != 0 {
			http.Error(w, "fixture read failure", status)
			return
		}
		if _, exists := f.directory(path.Dir(name)); !exists {
			f.MissingParentRequests++
			http.Error(w, "openat2: no such file or directory", 500)
			return
		}
		data, ok := f.Files[name]
		if !ok {
			http.NotFound(w, r)
			return
		}
		w.Write(data)
		return
	}
	if strings.HasSuffix(r.URL.Path, "/files/write") {
		name := r.URL.Query().Get("file")
		if _, exists := f.directory(path.Dir(name)); !exists {
			f.MissingParentRequests++
			http.Error(w, "openat2: no such file or directory", 500)
			return
		}
		f.Files[name], _ = io.ReadAll(r.Body)
		f.Writes++
		if f.FailWriteOnce == name {
			f.FailWriteOnce = ""
			f.Files[name] = []byte("fixture partially written file")
			http.Error(w, "fixture partial write failure", 500)
			return
		}
		w.WriteHeader(204)
		return
	}
	if strings.HasSuffix(r.URL.Path, "/files/delete") {
		var input struct {
			Root  string   `json:"root"`
			Files []string `json:"files"`
		}
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
			http.Error(w, "fixture invalid delete", 422)
			return
		}
		for _, file := range input.Files {
			delete(f.Files, path.Join(input.Root, file))
		}
		w.WriteHeader(204)
		return
	}
	if strings.HasSuffix(r.URL.Path, "/files/list-directory") {
		folder := r.URL.Query().Get("directory")
		if status := f.ListFailures[folder]; status != 0 {
			http.Error(w, "fixture list failure", status)
			return
		}
		entries, ok := f.directory(folder)
		if !ok {
			f.MissingParentRequests++
			http.Error(w, "openat2: no such file or directory", 500)
			return
		}
		writeJSON(w, 200, entries)
		return
	}
	if strings.HasSuffix(r.URL.Path, "/files/create-directory") {
		var data M
		_ = json.NewDecoder(r.Body).Decode(&data)
		if _, exists := f.directory(str(data["path"])); !exists {
			f.MissingParentRequests++
			http.Error(w, "openat2: no such file or directory", 500)
			return
		}
		f.Folders[path.Join(str(data["path"]), str(data["name"]))] = []M{}
		w.WriteHeader(204)
		return
	}
	if r.Method == "GET" && strings.HasPrefix(r.URL.Path, "/api/servers/") {
		writeJSON(w, 200, M{"state": f.State})
		return
	}
	http.Error(w, "unexpected fixture request", 404)
}

func steamGamesFixture(t *testing.T) (*App, *http.ServeMux, int64, M, *steamGamesWings) {
	t.Helper()
	a, _, admin := infraTestApp(t)
	ctx := context.Background()
	f := &steamGamesWings{Files: map[string][]byte{}, Folders: map[string][]M{}, State: "offline", Architecture: "amd64", Platform: "linux"}
	wings := httptest.NewServer(f)
	t.Cleanup(wings.Close)
	location, err := a.insert(ctx, "locations", M{"short": "steam-fixture"})
	if err != nil {
		t.Fatal(err)
	}
	data := daemonTestNode(t, wings)
	data["uuid"] = newUUID()
	data["name"] = "Fixture Steam node"
	data["location_id"] = location["id"]
	data["public"] = true
	data["memory"] = 131072
	data["disk"] = 262144
	data["daemon_token"], err = a.seal("fixture-daemon-token")
	if err != nil {
		t.Fatal(err)
	}
	node, err := a.insert(ctx, "nodes", data)
	if err != nil {
		t.Fatal(err)
	}
	// Capability gating is synthetic; daemon/file traffic is an HTTP fixture.
	h := a.connectors()
	h.mu.Lock()
	capabilities := map[string]bool{}
	for _, capability := range steamapi.Capabilities() {
		capabilities[capability] = true
	}
	h.controls[num(node["id"])] = &connectorControl{capabilities: capabilities}
	h.mu.Unlock()
	t.Cleanup(func() { h.mu.Lock(); delete(h.controls, num(node["id"])); h.mu.Unlock() })
	for _, port := range []int{7777, 8888, 8211, 8212, 9000, 9001} {
		if _, err = a.insert(ctx, "allocations", M{"node_id": node["id"], "ip": "127.0.0.1", "port": port}); err != nil {
			t.Fatal(err)
		}
	}
	mux := http.NewServeMux()
	a.registerSteamGames(mux)
	a.registerGameQuickSetup(mux)
	return a, mux, admin, node, f
}

func steamGamesInput(game string, node M) M {
	spec, _ := steamGameSpecFor(game)
	password := ""
	if spec.PasswordMinimum > 0 {
		password = "test-pass"
	}
	return M{"server_password": password, "name": spec.Name + " fixture", "node_id": node["id"], "memory": spec.Memory, "max_players": spec.Players, "request_id": newUUID()}
}

func TestSteamGameInputAndLaunchContract(t *testing.T) {
	for _, spec := range steamGameSpecs {
		base := steamGamesInput(spec.ID, M{"id": 1})
		if _, err := steamParseGameInput(spec, base); err != nil {
			t.Fatal(err)
		}
		for _, patch := range []M{{"name": ""}, {"node_id": 0}, {"memory": spec.MinimumMemory - 1}, {"max_players": spec.MaximumPlayers + 1}, {"request_id": "bad"}, {"preset": "shell"}, {"server_password": "injected\nline"}} {
			input := M{}
			for k, v := range base {
				input[k] = v
			}
			for k, v := range patch {
				input[k] = v
			}
			if _, err := steamParseGameInput(spec, input); err == nil {
				t.Errorf("%s accepted %v", spec.ID, patch)
			}
		}
		if steamGameID(M{"uuid": spec.EggUUID}) != spec.ID || steamGameID(M{"name": spec.Name}) != "" {
			t.Fatal("game inference must use managed egg identity")
		}
		startup := steamGameStartup(spec, []M{{"port": 31000}, {"port": 31001}})
		if strings.Contains(startup, "steamcmd") || strings.Contains(startup, "useperfthreads") || strings.Contains(startup, "-players=") {
			t.Fatalf("unexpected launch command %s", startup)
		}
		if spec.ID == "satisfactory" && !strings.Contains(startup, "-ReliablePort=31001 -ExternalReliablePort=31001") {
			t.Fatal("reliable messaging allocation missing")
		}
	}
	if strings.Contains(steamBootstrapScript, "app_update") || !strings.Contains(steamBootstrapScript, "exit 0") {
		t.Fatal("bootstrap must only create the Wings volume")
	}
}

func TestSteamGameProvisioningIdempotencyAndAllocations(t *testing.T) {
	a, mux, admin, node, f := steamGamesFixture(t)
	ctx := context.Background()
	options := asMap(infraExpect(t, mux, admin, "GET", "/api/client/game-library/steam/satisfactory", nil, 200)["attributes"])
	if len(asSlice(options["nodes"])) != 1 || num(options["maximum_players"]) < 4 || num(asMap(options["defaults"])["max_players"]) != 4 {
		t.Fatal("invalid game options")
	}
	user, err := a.insert(ctx, "users", M{"uuid": newUUID(), "username": "steam-user", "email": "steam-user@example.invalid"})
	if err != nil {
		t.Fatal(err)
	}
	memberOptions := asMap(infraExpect(t, mux, num(user["id"]), "GET", "/api/client/game-library/steam/palworld", nil, 200)["attributes"])
	if len(asSlice(memberOptions["nodes"])) != 0 {
		t.Fatal("non-admin received install nodes")
	}
	input := steamGamesInput("satisfactory", node)
	endpoint := "/api/client/game-library/steam/satisfactory/install"
	infraExpect(t, mux, num(user["id"]), "POST", endpoint, input, 403)
	var wg sync.WaitGroup
	codes := make(chan int, 2)
	ids := make(chan string, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			code, result, _ := infraRequest(t, mux, admin, "POST", endpoint, input)
			codes <- code
			ids <- str(asMap(result["attributes"])["identifier"])
		}()
	}
	wg.Wait()
	close(codes)
	close(ids)
	created, reused := 0, 0
	for code := range codes {
		if code == 201 {
			created++
		} else if code == 200 {
			reused++
		} else {
			t.Fatalf("unexpected install status %d", code)
		}
	}
	if created != 1 || reused != 1 {
		t.Fatal("request not idempotent")
	}
	identifier := ""
	for id := range ids {
		if id == "" {
			t.Fatal("missing server identifier")
		}
		if identifier != "" && identifier != id {
			t.Fatal("duplicate server created")
		}
		identifier = id
	}
	server, err := a.one(ctx, "SELECT * FROM servers WHERE uuid_short=$1", identifier)
	if err != nil {
		t.Fatal(err)
	}
	allocs, err := a.query(ctx, "SELECT * FROM allocations WHERE server_id=$1 ORDER BY id", server["id"])
	if err != nil || len(allocs) != 2 {
		t.Fatalf("required allocations not assigned atomically: %v", err)
	}
	if !strings.Contains(str(server["startup"]), fmt.Sprintf("-ReliablePort=%d", num(allocs[1]["port"]))) {
		t.Fatal("launch port does not match auxiliary allocation")
	}
	configuration, err := a.serverConfig(ctx, server)
	env := asMap(configuration["environment"])
	if err != nil || str(env["AUTO_UPDATE"]) != "0" || str(env["VALIDATE"]) != "0" {
		t.Fatal("runtime updater was not disabled")
	}
	job, err := a.one(ctx, "SELECT * FROM steam_jobs WHERE server_id=$1", server["id"])
	if err != nil || str(job["operation"]) != "install" || !boolean(job["start_after"]) {
		t.Fatal("app-owned install was not queued")
	}
	// Simulate a process exit after durable queue commit, before the provision
	// stage write, with that install already completed when the retry arrives.
	if err = a.exec(ctx, "UPDATE steam_game_provisions SET stage='created' WHERE server_id=$1", server["id"]); err != nil {
		t.Fatal(err)
	}
	if err = a.exec(ctx, "UPDATE steam_jobs SET status='completed' WHERE id=$1", job["id"]); err != nil {
		t.Fatal(err)
	}
	infraExpect(t, mux, admin, "POST", endpoint, input, 200)
	count, err := a.one(ctx, "SELECT count(*) n FROM steam_jobs WHERE server_id=$1", server["id"])
	if err != nil || num(count["n"]) != 1 {
		t.Fatal("crash recovery reinstalled an already finished provision")
	}
	input["memory"] = 16384
	infraExpect(t, mux, admin, "POST", endpoint, input, 409)
	f.mu.Lock()
	creates := f.Creates
	f.mu.Unlock()
	if creates != 1 {
		t.Fatal("duplicate bootstrap")
	}
	// A deleted completed request cannot silently create a replacement server.
	input["memory"] = 12288
	if err = a.exec(ctx, "DELETE FROM servers WHERE id=$1", server["id"]); err != nil {
		t.Fatal(err)
	}
	infraExpect(t, mux, admin, "POST", endpoint, input, 409)
}

func TestSteamGameBootstrapRollbackAndRetry(t *testing.T) {
	a, mux, admin, node, f := steamGamesFixture(t)
	ctx := context.Background()
	input := steamGamesInput("palworld", node)
	input["server_password"] = "fixture-secret"
	f.mu.Lock()
	f.RejectCreate = true
	f.mu.Unlock()
	infraExpect(t, mux, admin, "POST", "/api/client/game-library/steam/palworld/install", input, 502)
	counts, err := a.one(ctx, "SELECT (SELECT count(*) FROM servers) servers,(SELECT count(*) FROM allocations WHERE server_id IS NOT NULL) allocations")
	if err != nil || num(counts["servers"]) != 0 || num(counts["allocations"]) != 0 {
		t.Fatal("failed bootstrap leaked server or allocations")
	}
	f.mu.Lock()
	f.RejectCreate = false
	f.mu.Unlock()
	infraExpect(t, mux, admin, "POST", "/api/client/game-library/steam/palworld/install", input, 201)
	provision, err := a.one(ctx, "SELECT * FROM steam_game_provisions WHERE actor_id=$1 AND request_id=$2", admin, input["request_id"])
	if err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(provision["settings"])
	if strings.Contains(string(encoded), "fixture-secret") {
		t.Fatal("password stored as plaintext in preparation settings")
	}
	server, err := a.one(ctx, "SELECT * FROM servers WHERE id=$1", provision["server_id"])
	if err != nil {
		t.Fatal(err)
	}
	f.mu.Lock()
	f.Files["/DefaultPalWorldSettings.ini"] = []byte("; native default\r\n[/Script/Pal.PalGameWorldSettings]\r\nOptionSettings=(ServerName=\"Default\",ServerPlayerMaxNum=32,ServerPassword=\"\",RCONEnabled=True,RESTAPIEnabled=True,ExpRate=1.0,CustomFuture=(A,B))\r\n")
	f.mu.Unlock()
	if err = a.steamGameAfterInstall(ctx, server); err != nil {
		t.Fatal(err)
	}
	f.mu.Lock()
	initial := string(f.Files[palworldSettingsPath])
	writes := f.Writes
	f.mu.Unlock()
	if !strings.Contains(initial, `ServerPassword="fixture-secret"`) || !strings.Contains(initial, "RCONEnabled=False,RESTAPIEnabled=False") || !strings.Contains(initial, "CustomFuture=(A,B)") {
		t.Fatal("native configuration preparation did not apply safe settings")
	}
	if err = a.steamGameAfterInstall(ctx, server); err != nil {
		t.Fatal(err)
	}
	f.mu.Lock()
	afterWrites := f.Writes
	f.mu.Unlock()
	if afterWrites != writes {
		t.Fatal("preparation overwrote an existing configuration")
	}
}

func TestSteamGamePlatformAndCapacityGates(t *testing.T) {
	a, mux, admin, node, f := steamGamesFixture(t)
	input := steamGamesInput("satisfactory", node)
	f.mu.Lock()
	f.Architecture = "arm64"
	f.mu.Unlock()
	infraExpect(t, mux, admin, "POST", "/api/client/game-library/steam/satisfactory/install", input, 422)
	f.mu.Lock()
	f.Architecture = "amd64"
	f.mu.Unlock()
	if err := a.exec(context.Background(), "DELETE FROM allocations WHERE node_id=$1 AND port<>7777", node["id"]); err != nil {
		t.Fatal(err)
	}
	infraExpect(t, mux, admin, "POST", "/api/client/game-library/steam/satisfactory/install", input, 422)
	counts, err := a.one(context.Background(), "SELECT count(*) n FROM servers")
	if err != nil || num(counts["n"]) != 0 {
		t.Fatal("failed gate created a server")
	}
}

func TestSteamGameConcurrentIndependentProvisioningAndAuxiliaryRollback(t *testing.T) {
	a, mux, admin, node, _ := steamGamesFixture(t)
	ctx := context.Background()
	var wg sync.WaitGroup
	codes := make(chan int, 2)
	for i := 0; i < 2; i++ {
		input := steamGamesInput("satisfactory", node)
		wg.Add(1)
		go func(in M) {
			defer wg.Done()
			code, _, _ := infraRequest(t, mux, admin, "POST", "/api/client/game-library/steam/satisfactory/install", in)
			codes <- code
		}(input)
	}
	wg.Wait()
	close(codes)
	for code := range codes {
		if code != 201 {
			t.Fatalf("independent node provisioning failed with %d", code)
		}
	}
	allocs, err := a.query(ctx, "SELECT server_id,count(*) n FROM allocations WHERE server_id IS NOT NULL GROUP BY server_id ORDER BY server_id")
	if err != nil || len(allocs) != 2 || num(allocs[0]["n"]) != 2 || num(allocs[1]["n"]) != 2 {
		t.Fatal("concurrent provisioning shared or lost allocations")
	}
	free, err := a.one(ctx, "SELECT * FROM allocations WHERE server_id IS NULL ORDER BY id LIMIT 1")
	if err != nil {
		t.Fatal(err)
	}
	occupied, err := a.one(ctx, "SELECT * FROM allocations WHERE server_id IS NOT NULL ORDER BY id LIMIT 1")
	if err != nil {
		t.Fatal(err)
	}
	spec, _ := steamGameSpecFor("satisfactory")
	egg, err := a.steamGameEgg(ctx, spec)
	if err != nil {
		t.Fatal(err)
	}
	// An administrator can race the node advisory lock. The shared creator
	// must reject an already claimed auxiliary port and undo its primary claim.
	_, err = a.createServer(ctx, M{"name": "Raced auxiliary fixture", "owner_id": admin, "egg_id": egg["id"], "image": steamLaunchImage, "startup": "./FactoryServer.sh", "node_id": node["id"], "allocation_id": free["id"], "allocation_additional": []any{occupied["id"]}, "memory": 8192, "disk": 20480, "swap": 0, "io": 500, "cpu": 0, "environment": M{"AUTO_UPDATE": "0", "VALIDATE": "0"}})
	if err == nil {
		t.Fatal("already assigned auxiliary allocation accepted")
	}
	counts, err := a.one(ctx, "SELECT (SELECT count(*) FROM servers) servers,(SELECT count(*) FROM allocations WHERE server_id IS NOT NULL) allocations")
	if err != nil || num(counts["servers"]) != 2 || num(counts["allocations"]) != 4 {
		t.Fatal("raced auxiliary allocation left partial server/allocation state")
	}
}
