package panel

import (
	"context"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestGoldSrcWave60InstallerAssignedEnvironment(t *testing.T) {
	for _, recipe := range []string{"hlds_server/vanilla/egg-custom-h-l-d-s-engine-game.json", "hlds_server/rehlds/egg-custom-re-h-l-d-s-engine-game.json"} {
		t.Run(recipe, func(t *testing.T) { goldSrcWave60Environment(t, recipe) })
	}
}
func goldSrcWave60Environment(t *testing.T, recipe string) {
	var fixtureSchema string
	// Register before the fixture, so this read runs after its schema cleanup.
	t.Cleanup(func() {
		if fixtureSchema == "" {
			return
		}
		control, err := pgxpool.New(context.Background(), os.Getenv("TEST_DATABASE_URL"))
		if err != nil {
			t.Error("cannot verify fixture cleanup")
			return
		}
		defer control.Close()
		var exists bool
		if err := control.QueryRow(context.Background(), "SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname=$1)", fixtureSchema).Scan(&exists); err != nil || exists {
			t.Error("GoldSrc fixture schema cleanup not verified")
		}
	})
	f := operationsFixtureNew(t)
	fixtureSchema = f.a.DB.Config().ConnConfig.RuntimeParams["search_path"]
	ctx := context.Background()
	var entry gameTemplate
	for _, candidate := range gameTemplates().Entries {
		if candidate.Path == recipe {
			entry = candidate
		}
	}
	if entry.Path == "" {
		t.Fatal("catalog recipe missing")
	}
	egg, variables, err := parseEggDocument(entry.Egg)
	if err != nil {
		t.Fatal(err)
	}
	imported, err := f.a.ensureGameTemplateEgg(ctx, entry, egg, variables)
	if err != nil {
		t.Fatal(err)
	}
	patch := M{"egg_id": imported["id"], "nest_id": imported["nest_id"], "startup": imported["startup"]}
	if _, err := f.a.update(ctx, "servers", num(f.server["id"]), patch); err != nil {
		t.Fatal(err)
	}
	for key, value := range patch {
		f.server[key] = value
	}
	primary, err := f.a.one(ctx, "SELECT * FROM allocations WHERE id=$1", f.server["allocation_id"])
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.a.update(ctx, "allocations", num(primary["id"]), M{"port": 28100}); err != nil {
		t.Fatal(err)
	}
	for _, port := range []int{28101} {
		if _, err := f.a.insert(ctx, "allocations", M{"node_id": f.server["node_id"], "server_id": f.server["id"], "ip": primary["ip"], "port": port}); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := f.a.insert(ctx, "allocations", M{"node_id": f.server["node_id"], "server_id": f.server["id"], "ip": "192.0.2.99", "port": 29999}); err != nil {
		t.Fatal(err)
	}
	envelope, err := f.a.remoteEnvelope(ctx, f.server)
	configuration := asMap(envelope["settings"])
	if err != nil {
		t.Fatal(err)
	}
	environment := asMap(configuration["environment"])
	if str(environment["VOLTRA_ALLOCATED_PORTS"]) != "28100,28101" {
		t.Fatal("GoldSrc installer environment must contain exactly its two same-address assignments")
	}
	if num(asMap(asMap(configuration["allocations"])["default"])["port"]) != 28100 {
		t.Fatal("Wings primary SERVER_PORT source changed")
	}
	if err := f.a.syncServer(ctx, f.server); err != nil {
		t.Fatal(err)
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(f.calls) == 0 {
		t.Fatal("mock Wings received no configuration")
	}
	t.Log("Executed serverConfig and syncServer against mock Wings; fixture schema cleanup verified after test")
}
