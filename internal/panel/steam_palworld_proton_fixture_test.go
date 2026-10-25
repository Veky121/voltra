//go:build voltra_palworld_proton_acceptance

package panel

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"sync/atomic"
	"testing"
)

var managedProtonFixtureActive atomic.Bool

// This guard owns only an isolated harness. It never changes production specs.
func activateManagedProtonFixture(ctx context.Context, a *App, receipt M, queue string) (func(), error) {
	if a == nil || a.DB == nil || managedProtonFixtureActive.Load() || str(receipt["game"]) != "palworld-proton" || a.Config.PublicURL != "http://127.0.0.1:18098" {
		return nil, errors.New("Exact inactive isolated Proton test fixture required")
	}
	run := str(receipt["run_id"])
	if !regexp.MustCompile(`^[a-f0-9-]{36}$`).MatchString(run) || str(receipt["root"]) != "/var/lib/voltra-batch-20261023/managed-bridge/"+run {
		return nil, errors.New("Owned Proton fixture namespace required")
	}
	if _, err := managedNativeReadLease(queue, str(receipt["lease_id"]), "palworld-proton"); err != nil {
		return nil, err
	}
	rows, err := a.query(ctx, "SELECT current_schema() AS name")
	if err != nil || len(rows) != 1 || !regexp.MustCompile(`^infra_[a-f0-9]{32}$`).MatchString(str(rows[0]["name"])) || str(rows[0]["name"]) != str(receipt["fixture_schema"]) {
		return nil, errors.New("Exact random fixture schema identity required")
	}
	nodes, err := a.query(ctx, "SELECT uuid,daemon_base FROM nodes WHERE id=$1 AND uuid=$2", receipt["node"], receipt["node_uuid"])
	if err != nil || len(nodes) != 1 || str(nodes[0]["daemon_base"]) != str(receipt["root"])+"/volumes" {
		return nil, errors.New("Exact owned fixture node identity required")
	}
	if !managedProtonFixtureActive.CompareAndSwap(false, true) {
		return nil, errors.New("Another Proton fixture is active")
	}
	return func() { managedProtonFixtureActive.Store(false) }, nil
}

// No parallel execution, environment availability override or automatic game creation.
func TestSteamCatalogProtonNativeAcceptanceHarness(t *testing.T) {
	if os.Getenv("VOLTRA_MANAGED_NATIVE_GAME") != "palworld-proton" || os.Getenv("VOLTRA_MANAGED_NATIVE_LEASE") == "" {
		t.Skip("Explicit Proton fixture lease required")
	}
	if managedNativeFixturePrepared != nil {
		t.Fatal("Another native fixture callback is active")
	}
	managedNativeFixturePrepared = func(t *testing.T, a *App, receipt M, queue string) {
		release, err := activateManagedProtonFixture(context.Background(), a, receipt, queue)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(release)
		receipt["acceptance_build_tag"] = "voltra_palworld_proton_acceptance"
		receipt["production_spec_unchanged"] = true
	}
	t.Cleanup(func() { managedNativeFixturePrepared = nil })
	TestSteamCatalogNativeAcceptanceHarness(t)
}

func TestSteamCatalogProtonFixtureOwnershipAndRestore(t *testing.T) {
	if managedProtonFixtureActive.Load() {
		t.Fatal("Harness already active")
	}
	a, _, _ := infraTestApp(t)
	a.Config.PublicURL = "http://127.0.0.1:18098"
	ctx := context.Background()
	location, err := a.insert(ctx, "locations", M{"short": "PROTON-TEST", "long": "Owned fixture"})
	if err != nil {
		t.Fatal(err)
	}
	run := newUUID()
	root := "/var/lib/voltra-batch-20261023/managed-bridge/" + run
	node, err := a.insert(ctx, "nodes", M{"id": 249, "uuid": newUUID(), "name": "Own fixture", "fqdn": "127.0.0.1", "location_id": location["id"], "daemon_base": root + "/volumes", "daemon_token_id": "fixture", "daemon_token": "fixture"})
	if err != nil {
		t.Fatal(err)
	}
	schemas, err := a.query(ctx, "SELECT current_schema() AS name")
	if err != nil {
		t.Fatal(err)
	}
	queue := filepath.Join(t.TempDir(), "queue.json")
	lease := managedNativeLeaseRecord{LeaseID: newUUID(), Owner: "managed_steam_bridge", Game: "palworld/egg-palworld-proton.json", Status: "active", Memory: 9216, Disk: 32768, Ports: []int{28010}}
	data, _ := json.Marshal(M{"claims": []managedNativeLeaseRecord{lease}})
	if err = os.WriteFile(queue, data, 0600); err != nil {
		t.Fatal(err)
	}
	receipt := M{"game": "palworld-proton", "lease_id": lease.LeaseID, "run_id": run, "root": root, "fixture_schema": schemas[0]["name"], "node": node["id"], "node_uuid": node["uuid"]}
	original, _ := steamGameSpecFor("palworld-proton")
	legacy, _ := steamGameSpecFor("palworld")
	for _, key := range []string{"game", "lease_id", "root", "fixture_schema", "node_uuid"} {
		invalid := M{}
		for k, v := range receipt {
			invalid[k] = v
		}
		invalid[key] = "invalid"
		if _, err := activateManagedProtonFixture(ctx, a, invalid, queue); err == nil {
			t.Fatal("Invalid ownership accepted:", key)
		}
		if managedProtonFixtureActive.Load() {
			t.Fatal("Rejected ownership activated harness")
		}
	}
	release, err := activateManagedProtonFixture(ctx, a, receipt, queue)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(release)
	if !managedProtonFixtureActive.Load() {
		t.Fatal("Owned harness guard not acquired")
	}
	current, _ := steamGameSpecFor("palworld-proton")
	comparableCurrent, comparableOriginal := current, original
	comparableCurrent.Prepare, comparableOriginal.Prepare = nil, nil
	if !reflect.DeepEqual(comparableCurrent, comparableOriginal) || reflect.ValueOf(current.Prepare).Pointer() != reflect.ValueOf(original.Prepare).Pointer() {
		t.Fatal("Fixture changed production spec")
	}
	if _, err = activateManagedProtonFixture(ctx, a, receipt, queue); err == nil {
		t.Fatal("Nested activation accepted")
	}
	release()
	current, _ = steamGameSpecFor("palworld-proton")
	currentLegacy, _ := steamGameSpecFor("palworld")
	// Cleanup releases only the guard and leaves both production runtimes intact.
	if managedProtonFixtureActive.Load() || current.UnavailableReason != original.UnavailableReason || current.AfterSetup != original.AfterSetup || currentLegacy.Players != legacy.Players || currentLegacy.Startup != legacy.Startup {
		t.Fatal("Fixture cleanup changed production/legacy controls")
	}
}
