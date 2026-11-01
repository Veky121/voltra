package panel

import (
	"context"
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestDSTInstallerAssignedEnvironment(t *testing.T) {
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
			t.Error("DST fixture schema cleanup not verified")
		}
	})
	f := operationsFixtureNew(t)
	fixtureSchema = f.a.DB.Config().ConnConfig.RuntimeParams["search_path"]
	ctx := context.Background()
	var entry gameTemplate
	for _, candidate := range gameTemplates().Entries {
		if candidate.Path == "dont_starve/egg-don-t-starve-together.json" {
			entry = candidate
		}
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
	if _, err := f.a.update(ctx, "allocations", num(primary["id"]), M{"port": 10998}); err != nil {
		t.Fatal(err)
	}
	for _, port := range []int{10999, 23563, 23565, 23567, 23569} {
		if _, err := f.a.insert(ctx, "allocations", M{"node_id": f.server["node_id"], "server_id": f.server["id"], "ip": primary["ip"], "port": port}); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := f.a.insert(ctx, "allocations", M{"node_id": f.server["node_id"], "server_id": f.server["id"], "ip": "192.0.2.99", "port": 29999}); err != nil {
		t.Fatal(err)
	}
	variable, err := f.a.one(ctx, "SELECT id FROM egg_variables WHERE egg_id=$1 AND env_variable='ONLINE_MODE'", imported["id"])
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.a.insert(ctx, "server_variables", M{"server_id": f.server["id"], "variable_id": variable["id"], "variable_value": "0"}); err != nil {
		t.Fatal(err)
	}
	configuration, err := f.a.serverConfig(ctx, f.server)
	if err != nil {
		t.Fatal(err)
	}
	environment := asMap(configuration["environment"])
	if str(environment["VOLTRA_ALLOCATED_PORTS"]) != "10998,10999,23563,23565,23567,23569" {
		t.Fatal("DST installer environment must contain exactly its six same-address assignments")
	}
	if str(environment["ONLINE_MODE"]) != "0" || str(environment["SRCDS_APPID"]) != "343050" {
		t.Fatal("DST installer lost selected mode or publisher application identity")
	}
	if num(asMap(asMap(configuration["allocations"])["default"])["port"]) != 10998 {
		t.Fatal("Wings primary SERVER_PORT source changed")
	}
	script := str(asMap(asMap(entry.Egg["scripts"])["installation"])["script"])
	validation := strings.Index(script, "dry_run=True")
	bundle := strings.Index(script, "python3 .voltra/bundle_debian_python.py")
	if validation < 0 || bundle < 0 || validation >= bundle {
		t.Fatal("DST installer must validate before publishing its Python bundle")
	}
}
