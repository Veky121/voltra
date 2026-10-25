package panel

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"testing"
	"time"
)

type managedNativeLeaseRecord struct {
	Kind    string `json:"kind"`
	LeaseID string `json:"lease_id"`
	Owner   string `json:"owner"`
	Game    string `json:"game"`
	Status  string `json:"status"`
	Ports   []int  `json:"ports"`
	Memory  int64  `json:"memory_mib"`
	Disk    int64  `json:"disk_mib"`
}

func managedNativeReadLease(file, leaseID, game string) (managedNativeLeaseRecord, error) {
	var queue struct {
		Claims []managedNativeLeaseRecord `json:"claims"`
	}
	data, err := os.ReadFile(file)
	if err != nil {
		return managedNativeLeaseRecord{}, err
	}
	if err = json.Unmarshal(data, &queue); err != nil {
		return managedNativeLeaseRecord{}, err
	}
	path, memory, disk, ports := "", int64(0), int64(0), 0
	switch game {
	case "7days":
		path = "7_days_to_die/egg-7-days-to-die.json"
		memory = 9216
		disk = 33280
		ports = 4
	case "palworld-native":
		path = "palworld/egg-palworld.json"
		memory = 9216
		disk = 32768
		ports = 1
	case "palworld-proton":
		path = "palworld/egg-palworld-proton.json"
		memory = 9216
		disk = 32768
		ports = 1
	case "satisfactory":
		path = "satisfactory/egg-satisfactory.json"
		memory = 13312
		disk = 20992
		ports = 2
	default:
		return managedNativeLeaseRecord{}, errors.New("Unsupported native game")
	}
	var selected managedNativeLeaseRecord
	count, totalMemory, totalDisk := 0, int64(0), int64(20480)
	used := map[int]bool{}
	for _, row := range queue.Claims {
		if row.Status != "active" {
			continue
		}
		count++
		totalMemory += row.Memory
		totalDisk += row.Disk
		if row.Memory < 1 || row.Disk < 1 || (len(row.Ports) == 0 && row.Kind != "utility") {
			return selected, errors.New("Malformed active native lease")
		}
		for _, port := range row.Ports {
			reviewedAvorion := port == 27003 && row.Owner == "local_linux_node" && row.Game == "avorion/egg-avorion.json"
			if ((port < 28000 || port > 28999) && !reviewedAvorion) || used[port] {
				return selected, errors.New("Invalid or overlapping native ports")
			}
			used[port] = true
		}
		if row.LeaseID == leaseID && row.Owner == "managed_steam_bridge" && row.Game == path {
			selected = row
		}
	}
	if count > 7 || totalMemory > 20480 || totalDisk > 131072 || selected.LeaseID == "" || selected.Memory < memory || selected.Disk < disk || len(selected.Ports) < ports {
		return selected, errors.New("Native lease does not admit this fixture")
	}
	for _, port := range selected.Ports {
		if port < 28010 || port > 28999 {
			return selected, errors.New("Owned managed ports must remain in reviewed28010+ range")
		}
	}
	if game == "7days" {
		for index, port := range selected.Ports {
			if port != selected.Ports[0]+index {
				return selected, errors.New("7Days native ports must be consecutive")
			}
		}
	}
	return selected, nil
}

// Test binaries only. A tagged acceptance test installs this callback; ordinary
// tests leave it nil and no production code can enable a fixture through it.
var managedNativeFixturePrepared func(*testing.T, *App, M, string)

func managedNativeCommand(ctx context.Context, name string, args ...string) *exec.Cmd {
	command := exec.CommandContext(ctx, name, args...)
	managedNativeHideWindow(command)
	return command
}

func TestSteamCatalogNativeDirectLeaseReads(t *testing.T) {
	file := filepath.Join(t.TempDir(), "queue.json")
	row := managedNativeLeaseRecord{LeaseID: "owned", Owner: "managed_steam_bridge", Game: "7_days_to_die/egg-7-days-to-die.json", Status: "active", Memory: 9216, Disk: 33280, Ports: []int{28010, 28011, 28012, 28013}}
	write := func(rows []managedNativeLeaseRecord) {
		data, _ := json.Marshal(M{"claims": rows})
		if err := os.WriteFile(file, data, 0600); err != nil {
			t.Fatal(err)
		}
	}
	write([]managedNativeLeaseRecord{row})
	for range 10 {
		if _, err := managedNativeReadLease(file, "owned", "7days"); err != nil {
			t.Fatal("Direct queue read rejected valid native lease")
		}
	}
	row.Status = "released"
	write([]managedNativeLeaseRecord{row})
	if _, err := managedNativeReadLease(file, "owned", "7days"); err == nil {
		t.Fatal("Direct reader accepted stale lease")
	}
	row.Status = "active"
	other := row
	other.Owner = "other"
	other.LeaseID = "other"
	other.Memory = 12288
	other.Ports = []int{28020}
	write([]managedNativeLeaseRecord{row, other})
	if _, err := managedNativeReadLease(file, "owned", "7days"); err == nil {
		t.Fatal("Direct reader permitted RAM overbooking")
	}
	other.Memory = 512
	other.Ports = []int{28000}
	write([]managedNativeLeaseRecord{row, other})
	if _, err := managedNativeReadLease(file, "owned", "7days"); err != nil {
		t.Fatal("Another worker's valid common28000 port blocked admission")
	}
	other.Ports = []int{27003}
	other.Owner = "local_linux_node"
	other.Game = "avorion/egg-avorion.json"
	write([]managedNativeLeaseRecord{row, other})
	if _, err := managedNativeReadLease(file, "owned", "7days"); err != nil {
		t.Fatal("Reviewed Avorion port exception blocked admission")
	}
	other.Owner = "other"
	write([]managedNativeLeaseRecord{row, other})
	if _, err := managedNativeReadLease(file, "owned", "7days"); err == nil {
		t.Fatal("Unreviewed port exception was accepted")
	}
	other.Ports = []int{28011}
	write([]managedNativeLeaseRecord{row, other})
	if _, err := managedNativeReadLease(file, "owned", "7days"); err == nil {
		t.Fatal("Direct reader permitted another worker's port")
	}
}

func TestSteamCatalogNativeProtonUtilityLeaseGuards(t *testing.T) {
	file := filepath.Join(t.TempDir(), "queue.json")
	owned := managedNativeLeaseRecord{LeaseID: "proton", Owner: "managed_steam_bridge", Game: "palworld/egg-palworld-proton.json", Status: "active", Memory: 9216, Disk: 32768, Ports: []int{28010}}
	utility := managedNativeLeaseRecord{Kind: "utility", LeaseID: "other", Owner: "other", Game: "utility/fixture", Status: "active", Memory: 1024, Disk: 4096}
	write := func(other managedNativeLeaseRecord) {
		data, _ := json.Marshal(M{"claims": []managedNativeLeaseRecord{owned, other}})
		if err := os.WriteFile(file, data, 0600); err != nil {
			t.Fatal(err)
		}
	}
	write(utility)
	if _, err := managedNativeReadLease(file, "proton", "palworld-proton"); err != nil {
		t.Fatal("Valid zero-port utility blocked shared pool", err)
	}
	for _, change := range []func(*managedNativeLeaseRecord){
		func(row *managedNativeLeaseRecord) { row.Kind = "" },
		func(row *managedNativeLeaseRecord) { row.Kind = "unknown" },
		func(row *managedNativeLeaseRecord) { row.Memory = 0 },
		func(row *managedNativeLeaseRecord) { row.Memory = 12288 },
		func(row *managedNativeLeaseRecord) { row.Disk = 90000 },
		func(row *managedNativeLeaseRecord) { row.Ports = []int{28010} },
	} {
		bad := utility
		change(&bad)
		write(bad)
		if _, err := managedNativeReadLease(file, "proton", "palworld-proton"); err == nil {
			t.Fatal("Malformed/overlapping/overbudget mixed lease admitted")
		}
	}
}

// This opt-in harness hosts the actual source Panel against infraTestApp's
// disposable schema. Native control containers are separate from node202's
// running services, but consume a current weighted lease on that same host.
// No game is implicitly created: the driver exercises the real public APIs.
func TestSteamCatalogNativeAcceptanceHarness(t *testing.T) {
	game, leaseID := os.Getenv("VOLTRA_MANAGED_NATIVE_GAME"), os.Getenv("VOLTRA_MANAGED_NATIVE_LEASE")
	if game == "" || leaseID == "" {
		t.Skip("explicit managed native game and active weighted lease required")
	}
	root, err := filepath.Abs("../..")
	if err != nil {
		t.Fatal(err)
	}
	var batch struct {
		Node int64  `json:"node"`
		Root string `json:"root"`
	}
	batchData, err := os.ReadFile(filepath.Join(root, ".local", "batch-node", "private.json"))
	if err != nil || json.Unmarshal(batchData, &batch) != nil || batch.Node < 1 || batch.Root != "/var/lib/voltra-batch-20261023" {
		t.Fatal("Current batch node receipt unavailable")
	}
	queuePath := filepath.Join(root, ".local", "game-batch", "queue.json")
	lease, err := managedNativeReadLease(queuePath, leaseID, game)
	if err != nil {
		t.Fatal("Current shared native lease admission failed:", err)
	}
	if _, ok := steamGameSpecFor(game); !ok || len(steamCatalogFields(game)) == 0 {
		t.Fatal("Unsupported managed native game")
	}
	listener, err := net.Listen("tcp", "127.0.0.1:18098")
	if err != nil {
		t.Fatal("Isolated Panel port is not free")
	}
	defer listener.Close()
	a, _, admin := infraTestApp(t)
	a.Config.PublicURL = "http://127.0.0.1:18098"
	a.Config.DevUserID = admin
	a.HTTP = &http.Client{Timeout: 45 * time.Second}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	run := newUUID()
	nativeRoot := "/var/lib/voltra-batch-20261023/managed-bridge/" + run
	directory := filepath.Join(root, ".local", "managed-steam-native", run)
	if err = os.MkdirAll(filepath.Join(directory, "private"), 0700); err != nil {
		t.Fatal(err)
	}
	write := func(name string, value any) {
		t.Helper()
		data, e := json.MarshalIndent(value, "", "  ")
		if e != nil {
			t.Fatal(e)
		}
		if e = os.WriteFile(filepath.Join(directory, name), append(data, '\n'), 0600); e != nil {
			t.Fatal(e)
		}
	}
	location, err := a.insert(ctx, "locations", M{"short": "MANAGED-NATIVE", "long": "Isolated managed Steam native acceptance"})
	if err != nil {
		t.Fatal(err)
	}
	daemonToken, connectorToken := randomToken(32), randomToken(32)
	sealed, err := a.seal(daemonToken)
	if err != nil {
		t.Fatal(err)
	}
	node, err := a.insert(ctx, "nodes", M{"id": batch.Node, "uuid": newUUID(), "name": "Managed native fixture node", "location_id": location["id"], "fqdn": "127.0.0.1", "scheme": "http", "public": true, "memory": lease.Memory, "disk": lease.Disk, "memory_overallocate": 0, "disk_overallocate": 0, "daemon_listen": 18191, "daemon_sftp": 12131, "daemon_base": nativeRoot + "/volumes", "daemon_token_id": randomToken(8), "daemon_token": sealed, "connection_mode": "outbound", "upload_size": 4096, "allowed_origins": []string{a.Config.PublicURL}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = a.insert(ctx, "node_connectors", M{"node_id": node["id"], "token_hash": pairingHash(connectorToken)}); err != nil {
		t.Fatal(err)
	}
	for _, port := range lease.Ports {
		if _, err = a.insert(ctx, "allocations", M{"node_id": batch.Node, "ip": "127.0.0.1", "port": port}); err != nil {
			t.Fatal(err)
		}
	}
	wings, err := a.nodeConfiguration(ctx, node)
	if err != nil {
		t.Fatal(err)
	}
	wings["remote"] = "http://host.docker.internal:18098"
	wings["api"] = M{"host": "0.0.0.0", "port": 18191, "upload_limit": 4096, "ssl": M{"enabled": false}}
	wings["system"] = M{"root_directory": nativeRoot, "data": nativeRoot + "/volumes", "log_directory": nativeRoot + "/logs", "backup_directory": nativeRoot + "/backups", "archive_directory": nativeRoot + "/archives", "tmp_directory": nativeRoot + "/tmp", "sftp": M{"bind_address": "0.0.0.0", "bind_port": 12131}, "user": M{"uid": 1000, "gid": 1000, "username": "container"}}
	wings["docker"] = M{"network": M{"name": "voltra-batch-20261023", "network_mode": "voltra-batch-20261023", "interface": "127.0.0.1", "interfaces": M{"v4": M{"subnet": "172.30.90.0/24", "gateway": "172.30.90.1"}, "v6": M{"subnet": "fdba:17c8:6c90::/64", "gateway": "fdba:17c8:6c90::1"}}}}
	write("private/wings.json", wings)
	write("private/node.json", M{"panel_url": a.Config.PublicURL, "token": connectorToken, "wings_address": "127.0.0.1:18191", "node_uuid": node["uuid"]})
	wingsName, connectorName := "voltra-managed-wings-"+run, "voltra-managed-node-"+run
	receipt := M{"run_id": run, "phase": "prepared", "game": game, "lease_id": leaseID, "node": batch.Node, "node_uuid": node["uuid"], "root": nativeRoot, "volume_root": nativeRoot + "/volumes", "panel_url": a.Config.PublicURL, "panel_port": 18098, "daemon_port": 18191, "sftp_port": 12131, "directory": directory, "wings_container": wingsName, "connector_container": connectorName, "ports": lease.Ports, "memory_mib": lease.Memory, "disk_mib": lease.Disk, "scope": "New isolated fixture schema and control processes only; original Panel/node202 untouched"}
	fixtureSchema, err := a.query(ctx, "SELECT current_schema() AS name")
	if err != nil || len(fixtureSchema) != 1 || !regexp.MustCompile(`^infra_[a-f0-9]{32}$`).MatchString(str(fixtureSchema[0]["name"])) {
		t.Fatal("Owned random fixture schema identity unavailable")
	}
	receipt["fixture_schema"] = fixtureSchema[0]["name"]
	if managedNativeFixturePrepared != nil {
		managedNativeFixturePrepared(t, a, receipt, queuePath)
	}
	write("receipt.json", receipt)
	current := filepath.Join(root, ".local", "managed-steam-native", "current.json")
	if _, err = os.Stat(current); err == nil {
		t.Fatal("Existing managed native handle must be inspected before starting another")
	} else if !os.IsNotExist(err) {
		t.Fatal(err)
	}
	data, _ := json.Marshal(receipt)
	if err = os.WriteFile(current, data, 0600); err != nil {
		t.Fatal(err)
	}
	server := &http.Server{Handler: a.Handler(), ReadHeaderTimeout: 10 * time.Second}
	go func() { _ = server.Serve(listener) }()
	go a.RunSteamJobs(ctx)
	// Docker cleanup uses only UUIDs read from this fixture schema and the two
	// generated process names. It runs before infraTestApp drops its schema.
	t.Cleanup(func() {
		cancel()
		cleanup, stop := context.WithTimeout(context.Background(), 90*time.Second)
		defer stop()
		servers, _ := a.query(cleanup, "SELECT uuid FROM servers WHERE node_id=$1", batch.Node)
		for _, gameServer := range servers {
			id := str(gameServer["uuid"])
			_ = managedNativeCommand(cleanup, "docker", "rm", "-f", id, id+"_installer").Run()
		}
		jobs, _ := a.query(cleanup, "SELECT id FROM steam_jobs")
		for _, job := range jobs {
			for _, operation := range []string{"check", "install", "update", "verify"} {
				_ = managedNativeCommand(cleanup, "docker", "rm", "-f", "voltra-steam-"+str(job["id"])+"-"+operation).Run()
			}
		}
		_ = managedNativeCommand(cleanup, "docker", "rm", "-f", connectorName, wingsName).Run()
		_ = server.Shutdown(cleanup)
		receipt["phase"] = "stopped"
		write("receipt.json", receipt)
		// Keep the receipt and private configuration for explicit audited cleanup;
		// no recursive deletion of host data is hidden in the test framework.
		_ = os.Rename(current, filepath.Join(directory, "closed-handle.json"))
	})
	t.Logf("Isolated managed source Panel prepared; receipt %s", filepath.Join(directory, "receipt.json"))
	deadline := time.NewTimer(3 * time.Hour)
	defer deadline.Stop()
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-deadline.C:
			t.Fatal("Native harness reached bounded deadline")
		case <-ticker.C:
			if _, err = os.Stat(filepath.Join(directory, "stop")); err == nil {
				return
			}
			// A released/reassigned lease stops the isolated controller immediately.
			if _, err = managedNativeReadLease(queuePath, leaseID, game); err != nil {
				t.Fatal("Native lease no longer admits this isolated harness")
			}
		}
	}
}
