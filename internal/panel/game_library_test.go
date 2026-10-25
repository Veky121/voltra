package panel

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

type gameLibraryTransport func(*http.Request) (*http.Response, error)

func (f gameLibraryTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestGameLibraryMinecraftProvisioning(t *testing.T) {
	a, _, adminID := infraTestApp(t)
	mux := http.NewServeMux()
	a.registerGameLibrary(mux)
	ctx := context.Background()
	insert := func(table string, data M) M {
		t.Helper()
		row, err := a.insert(ctx, table, data)
		if err != nil {
			t.Fatal(err)
		}
		return row
	}
	user := insert("users", M{"uuid": newUUID(), "username": "library-user", "email": "library@example.invalid"})
	catalog := infraExpect(t, mux, num(user["id"]), "GET", "/api/client/game-library", nil, 200)
	if boolean(asMap(catalog["attributes"])["can_install"]) {
		t.Fatal("ordinary user can install")
	}
	var daemonCalls atomic.Int32
	var rejectDaemon atomic.Bool
	daemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer secret" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		if r.URL.Path == "/api/system" && r.Method == "GET" {
			writeJSON(w, 200, M{"os": "linux"})
			return
		}
		if r.URL.Path != "/api/servers" || r.Method != "POST" {
			t.Errorf("unexpected daemon operation %s %s", r.Method, r.URL.Path)
		}
		var body M
		_ = json.NewDecoder(r.Body).Decode(&body)
		if !boolean(body["start_on_completion"]) {
			t.Error("server will not start after installation")
		}
		daemonCalls.Add(1)
		if rejectDaemon.Load() {
			writeJSON(w, 503, M{"error": "fixture offline"})
			return
		}
		w.WriteHeader(202)
	}))
	defer daemon.Close()
	baseTransport := http.DefaultTransport
	var rejectMetadata atomic.Bool
	a.HTTP = &http.Client{Transport: gameLibraryTransport(func(r *http.Request) (*http.Response, error) {
		if r.URL.Host == "piston-meta.mojang.com" {
			status, body := 200, `{"latest":{"release":"26.3"},"versions":[{"id":"26.3","type":"release","url":"https://piston-meta.mojang.com/version.json"},{"id":"snapshot","type":"snapshot","url":"https://piston-meta.mojang.com/snapshot.json"}]}`
			if r.URL.Path == "/version.json" {
				body = `{"id":"26.3","javaVersion":{"majorVersion":25},"downloads":{"server":{"url":"https://piston-data.mojang.com/server.jar","sha1":"1234567890123456789012345678901234567890"}}}`
			}
			if rejectMetadata.Load() {
				status = 503
				body = `{}`
			}
			return &http.Response{StatusCode: status, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header)}, nil
		}
		return baseTransport.RoundTrip(r)
	})}
	location := insert("locations", M{"short": "library"})
	nodeData := daemonTestNode(t, daemon)
	nodeData["uuid"] = newUUID()
	nodeData["name"] = "Library node"
	nodeData["location_id"] = location["id"]
	nodeData["public"] = true
	nodeData["memory"] = 8192
	nodeData["disk"] = 40960
	nodeData["daemon_token"], _ = a.seal("secret")
	node := insert("nodes", nodeData)
	allocation := insert("allocations", M{"node_id": node["id"], "ip": "127.0.0.1", "port": 25568})
	options := asMap(infraExpect(t, mux, adminID, "GET", "/api/client/game-library/minecraft", nil, 200)["attributes"])
	if str(options["latest"]) != "26.3" || len(asSlice(options["versions"])) != 1 || len(asSlice(options["nodes"])) != 1 {
		t.Fatal("invalid release/node options")
	}
	if !boolean(asMap(asSlice(options["nodes"])[0])["setup_available"]) {
		t.Fatal("encrypted node credential prevented setup eligibility")
	}
	memberOptions := asMap(infraExpect(t, mux, num(user["id"]), "GET", "/api/client/game-library/minecraft", nil, 200)["attributes"])
	if len(asSlice(memberOptions["nodes"])) != 0 {
		t.Fatal("nodes disclosed to ordinary member")
	}
	path := "/api/client/game-library/minecraft/install"
	input := M{"name": "Minecraft Survival", "version": "latest", "memory": 2048, "max_players": 20, "game_mode": "survival", "difficulty": "normal", "accept_eula": true, "request_id": newUUID()}
	infraExpect(t, mux, num(user["id"]), "POST", path, input, 403)
	for _, patch := range []M{{"accept_eula": false}, {"memory": 123}, {"max_players": 0}, {"game_mode": "survival|creative"}, {"difficulty": "shell;command"}, {"request_id": ""}, {"node_id": -1}, {"version": "snapshot"}} {
		invalid := M{}
		for k, v := range input {
			invalid[k] = v
		}
		for k, v := range patch {
			invalid[k] = v
		}
		infraExpect(t, mux, adminID, "POST", path, invalid, 422)
	}
	rejectMetadata.Store(true)
	infraExpect(t, mux, adminID, "POST", path, input, 502)
	rejectMetadata.Store(false)
	result := asMap(infraExpect(t, mux, adminID, "POST", path, input, 201)["attributes"])
	server, err := a.one(ctx, "SELECT * FROM servers WHERE uuid_short=$1", result["identifier"])
	if err != nil {
		t.Fatal(err)
	}
	if server["status"] != "installing" || num(server["owner_id"]) != adminID || server["image"] != "ghcr.io/pterodactyl/yolks:java_25" || num(server["allocation_id"]) == num(allocation["id"]) {
		t.Fatal("incorrect Minecraft deployment")
	}
	env, err := a.serverEnvironment(ctx, server)
	if err != nil || env["MINECRAFT_VERSION"] != "26.3" || env["EULA_ACCEPTED"] != "true" || env["MAX_PLAYERS"] != "20" {
		t.Fatal("incorrect Minecraft environment")
	}
	envelope, err := a.remoteEnvelope(ctx, server)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(envelope)
	if !strings.Contains(string(raw), "25565") || !strings.Contains(string(raw), "server.properties") {
		t.Fatal("assigned port not passed to Wings configuration")
	}
	duplicate := asMap(infraExpect(t, mux, adminID, "POST", path, input, 200)["attributes"])
	if duplicate["identifier"] != result["identifier"] || daemonCalls.Load() != 1 {
		t.Fatal("retry created a second server")
	}
	egg, err := a.gameLibraryMinecraftEgg(ctx)
	if err != nil || num(egg["id"]) != num(server["egg_id"]) {
		t.Fatal("managed egg not reused")
	}
	input["request_id"] = newUUID()
	preview := asMap(infraExpect(t, mux, adminID, "POST", "/api/client/game-library/minecraft/ports", M{"node_id": node["id"]}, 200)["attributes"])
	if num(asMap(asSlice(preview["ports"])[0])["port"]) != 25566 {
		t.Fatal("Minecraft fallback preview lost assigned-port conflict")
	}
	if daemonCalls.Load() != 1 {
		t.Fatal("preview called server creation")
	}
	secondAllocation := insert("allocations", M{"node_id": node["id"], "ip": "127.0.0.1", "port": 25569})
	if err = a.exec(ctx, "UPDATE nodes SET memory=1024 WHERE id=$1", node["id"]); err != nil {
		t.Fatal(err)
	}
	infraExpect(t, mux, adminID, "POST", path, input, 422)
	if daemonCalls.Load() != 1 {
		t.Fatal("daemon called without sufficient capacity")
	}
	if err = a.exec(ctx, "UPDATE nodes SET memory=8192 WHERE id=$1", node["id"]); err != nil {
		t.Fatal(err)
	}
	rejectDaemon.Store(true)
	infraExpect(t, mux, adminID, "POST", path, input, 502)
	remaining, err := a.one(ctx, "SELECT count(*) count FROM servers")
	if err != nil || num(remaining["count"]) != 1 {
		t.Fatal("failed deployment left a server record")
	}
	free, err := a.one(ctx, "SELECT server_id FROM allocations WHERE id=$1", secondAllocation["id"])
	if err != nil || free["server_id"] != nil {
		t.Fatal("failed deployment consumed an allocation")
	}
}

func TestGameLibraryOfficialDownloadBoundary(t *testing.T) {
	for _, address := range []string{"http://piston-data.mojang.com/server.jar", "https://evil.example/server.jar", "https://piston-data.mojang.com.evil.example/server.jar", "https://user@piston-data.mojang.com/server.jar", "https://piston-data.mojang.com:8080/server.jar"} {
		if minecraftOfficialURL(address, "piston-data.mojang.com") {
			t.Errorf("accepted %s", address)
		}
	}
	if !minecraftOfficialURL("https://piston-data.mojang.com/server.jar", "piston-data.mojang.com") {
		t.Fatal("official download blocked")
	}
}
