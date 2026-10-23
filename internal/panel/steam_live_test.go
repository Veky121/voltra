package panel

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// Opt-in acceptance against real Steam, Docker, stock Wings and the node agent.
// It owns a random database schema and uniquely named containers/data directory.
// Build tools/runtime/Dockerfile.steam-node-test and Linux node artifacts first.
func TestSteamLiveEasySetup(t *testing.T) {
	if os.Getenv("STEAM_LIVE_ACCEPTANCE") != "true" {
		t.Skip("set STEAM_LIVE_ACCEPTANCE=true to download and boot both real game servers")
	}
	a, _, user := infraTestApp(t)
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Minute)
	defer cancel()
	a.Config.PublicURL = "http://127.0.0.1:8091"
	a.Config.DevUserID = user
	listener, err := net.Listen("tcp", "127.0.0.1:8091")
	if err != nil {
		t.Fatal(err)
	}
	panel := httptest.NewUnstartedServer(a.Handler())
	panel.Listener.Close()
	panel.Listener = listener
	panel.Start()
	defer panel.Close()
	liveAPI := func(t *testing.T, method, path string, input M, want int) M {
		t.Helper()
		var data []byte
		if input != nil {
			data, _ = json.Marshal(input)
		}
		request, e := http.NewRequestWithContext(ctx, method, panel.URL+path, bytes.NewReader(data))
		if e != nil {
			t.Fatal(e)
		}
		request.Header.Set("Content-Type", "application/json")
		response, e := http.DefaultClient.Do(request)
		if e != nil {
			t.Fatal(e)
		}
		defer response.Body.Close()
		var result M
		if e = json.NewDecoder(response.Body).Decode(&result); e != nil {
			t.Fatal(e)
		}
		if response.StatusCode != want {
			t.Fatalf("%s %s status=%d want=%d response=%v", method, path, response.StatusCode, want, result)
		}
		return result
	}
	suffix := strings.ReplaceAll(newUUID(), "-", "")[:10]
	wingsName, nodeName := "voltra-steam-wings-"+suffix, "voltra-steam-node-"+suffix
	dataRoot := "/var/lib/voltra-steam-test-" + suffix
	network := "voltra_steam_" + suffix
	tmp := t.TempDir()
	project, err := filepath.Abs("../..")
	if err != nil {
		t.Fatal(err)
	}
	command := func(args ...string) (string, error) {
		cmd := exec.CommandContext(ctx, "docker", args...)
		out, e := cmd.CombinedOutput()
		if e != nil {
			return "", fmt.Errorf("Docker %s failed: %s", args[0], string(out))
		}
		return strings.TrimSpace(string(out)), nil
	}
	must := func(args ...string) string {
		t.Helper()
		out, e := command(args...)
		if e != nil {
			if logs, logErr := command("logs", "--tail", "20", wingsName); logErr == nil {
				t.Log("Isolated Wings diagnostic:", logs)
			}
			t.Fatal(e)
		}
		return out
	}
	var servers []string
	defer func() {
		// Cleanup has its own deadline even if the test's download context expired.
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), time.Minute)
		defer cleanupCancel()
		cleanup := func(args ...string) { _ = exec.CommandContext(cleanupCtx, "docker", args...).Run() }
		for _, id := range servers {
			cleanup("rm", "-f", id)
			cleanup("rm", "-f", id+"_installer")
		}
		cleanup("rm", "-f", nodeName)
		cleanup("rm", "-f", wingsName)
		cleanup("network", "rm", network)
		// The random root is exclusively created by this test. No existing volume is mounted.
		cleanup("run", "--rm", "-v", dataRoot+":/fixture", "alpine:3.23", "sh", "-c", "find /fixture -mindepth 1 -maxdepth 1 -exec rm -rf {} +")
	}()
	mux := http.NewServeMux()
	a.registerNodePairing(mux)
	enrollment := pairSession(t, mux, user, 1)
	request := pairNodeRequest(t, mux, enrollment)
	status, approval := pairingRequest(t, mux, user, "POST", "/api/admin/node-requests/"+str(request["id"])+"/approve", "", M{"memory": 32768, "disk": 100000, "name": "Isolated Steam acceptance"})
	if status != 200 {
		t.Fatalf("approve %d: %v", status, approval)
	}
	_, paired := pairingRequest(t, mux, 0, "GET", "/api/remote/enroll/"+str(request["id"]), str(request["request_token"]), nil)
	nodeID := num(paired["node_id"])
	if err = a.exec(ctx, "UPDATE nodes SET daemon_base=$2,memory=32768,disk=100000 WHERE id=$1", nodeID, dataRoot+"/volumes"); err != nil {
		t.Fatal(err)
	}
	config := asMap(paired["configuration"])
	config["remote"] = "http://host.docker.internal:8091"
	config["api"] = M{"host": "0.0.0.0", "port": 8080, "ssl": M{"enabled": false}}
	system := asMap(config["system"])
	system["root_directory"] = dataRoot
	system["data"] = dataRoot + "/volumes"
	system["log_directory"] = dataRoot + "/logs"
	system["backup_directory"] = dataRoot + "/backups"
	system["archive_directory"] = dataRoot + "/archives"
	system["tmp_directory"] = dataRoot + "/tmp"
	system["sftp"] = M{"bind_address": "127.0.0.1", "bind_port": 2022}
	system["user"] = M{"uid": 988, "gid": 988}
	config["system"] = system
	config["docker"] = M{"network": M{"name": network, "network_mode": network, "interface": "172.30.99.1", "interfaces": M{"v4": M{"subnet": "172.30.99.0/24", "gateway": "172.30.99.1"}, "v6": M{"subnet": "fdba:17c8:6cf1::/64", "gateway": "fdba:17c8:6cf1::1"}}}}
	config["allowed_origins"] = []string{a.Config.PublicURL}
	writePrivate := func(name string, value any) string {
		t.Helper()
		path := filepath.Join(tmp, name)
		data, e := json.Marshal(value)
		if e != nil {
			t.Fatal(e)
		}
		if e = os.WriteFile(path, data, 0600); e != nil {
			t.Fatal(e)
		}
		return path
	}
	wingsConfig := writePrivate("wings.json", config)
	nodeConfig := writePrivate("node.json", M{"panel_url": a.Config.PublicURL, "token": paired["connector_token"], "wings_address": "127.0.0.1:8080"})
	must("network", "create", "--subnet", "172.30.99.0/24", "--gateway", "172.30.99.1", "--opt", "com.docker.network.bridge.name=vst"+suffix, network)
	must("run", "-d", "--name", wingsName, "-v", "/var/run/docker.sock:/var/run/docker.sock", "-v", "/run/wings:/run/wings", "-v", dataRoot+":"+dataRoot, "-v", wingsConfig+":/etc/pterodactyl/config.yml:ro", "pteroclone-wings:local")
	must("run", "-d", "--name", nodeName, "--network", "container:"+wingsName, "-v", "/var/run/docker.sock:/var/run/docker.sock", "-v", dataRoot+":"+dataRoot, "-v", wingsConfig+":/input/wings.json:ro", "-v", nodeConfig+":/input/node.json:ro", "-v", filepath.Join(project, "artifacts/node/voltra-node-linux-amd64")+":/voltra-node:ro", "voltra-steam-node-test:local", "-c", "mkdir -p /etc/voltra; cp /input/wings.json /etc/voltra/wings.yml; cp /input/node.json /etc/voltra/node.json; chmod 600 /etc/voltra/wings.yml /etc/voltra/node.json; socat TCP-LISTEN:8091,bind=127.0.0.1,reuseaddr,fork TCP:host.docker.internal:8091 & exec /voltra-node run --config /etc/voltra/node.json")
	defer a.connectors().close()
	deadline := time.Now().Add(time.Minute)
	for !a.steamNodeAvailable(ctx, nodeID) {
		if time.Now().After(deadline) {
			t.Fatal("node did not advertise Steam capability")
		}
		time.Sleep(time.Second)
	}
	node, err := a.node(ctx, nodeID)
	if err != nil {
		t.Fatal(err)
	}
	for {
		e := a.steamNativeNode(ctx, node)
		if e == nil {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("Wings readiness: %v", e)
		}
		time.Sleep(time.Second)
	}
	if err = a.exec(ctx, "INSERT INTO allocations(node_id,ip,port) VALUES($1,'0.0.0.0',27970),($1,'0.0.0.0',27971),($1,'0.0.0.0',27972)", nodeID); err != nil {
		t.Fatal(err)
	}
	for _, game := range []string{"satisfactory", "palworld"} {
		t.Run(game, func(t *testing.T) {
			input := M{"request_id": newUUID(), "name": "Acceptance " + game, "node_id": nodeID, "memory": 16384, "max_players": 4}
			result := liveAPI(t, "POST", "/api/client/game-library/steam/"+game+"/install", input, 201)
			identifier := str(asMap(result["attributes"])["identifier"])
			server, e := a.one(ctx, "SELECT * FROM servers WHERE uuid_short=$1", identifier)
			if e != nil {
				t.Fatal(e)
			}
			uuid := str(server["uuid"])
			servers = append(servers, uuid)
			t.Log("Downloading and installing", game)
			if !a.processSteamJob(ctx) {
				t.Fatal("installation job was not queued")
			}
			job, e := a.one(ctx, "SELECT * FROM steam_jobs WHERE server_id=$1 ORDER BY created_at DESC LIMIT 1", server["id"])
			if e != nil {
				t.Fatal(e)
			}
			if str(job["status"]) != "completed" {
				artifactDir:=filepath.Join(project,".local","steam-live-diagnostics");_=os.MkdirAll(artifactDir,0700)
				_,_=command("cp",nodeName+":/var/lib/voltra/steam-jobs/"+str(job["id"])+"-install.log",filepath.Join(artifactDir,game+".steam.log"))
				t.Fatalf("install status=%s stage=%s detail=%s", str(job["status"]), str(job["stage"]), str(job["detail"]))
			}
			// Require a sustained running process, not only Wings accepting the start request.
			startupDeadline := time.Now().Add(3 * time.Minute)
			for {
				state, e := a.steamServerState(ctx, server)
				if e == nil && state == "running" {
					break
				}
				if time.Now().After(startupDeadline) {
					t.Fatalf("game did not reach running: %s %v", state, e)
				}
				time.Sleep(2 * time.Second)
			}
			time.Sleep(20 * time.Second)
			state, e := a.steamServerState(ctx, server)
			if e != nil || state != "running" {
				t.Fatalf("game exited after startup: %s %v", state, e)
			}
			quick := liveAPI(t, "GET", "/api/client/servers/"+identifier+"/quick-setup", nil, 200)
			t.Logf("%s running; Quick setup fields=%d folders=%d", game, len(asSlice(asMap(quick["attributes"])["fields"])), len(asSlice(asMap(quick["attributes"])["folders"])))
			response, e := a.daemonServer(ctx, server, "POST", "/power", M{"action": "stop"})
			if e != nil {
				t.Fatal(e)
			}
			response.Body.Close()
			for i := 0; i < 60; i++ {
				state, _ = a.steamServerState(ctx, server)
				if state == "offline" {
					break
				}
				time.Sleep(time.Second)
			}
			if state != "offline" {
				t.Fatal("game did not stop gracefully")
			}
		})
	}
}
