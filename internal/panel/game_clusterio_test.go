package panel

import (
	"context"
	"os"
	"strings"
	"testing"
)

func TestClusterioReviewedSettings(t *testing.T) {
	var entry gameTemplate
	for _, candidate := range gameTemplates().Entries {
		if candidate.Path == "factorio/clusterio/egg-clusterio.json" {
			entry = candidate
			break
		}
	}
	if entry.Profile != "clusterio-2.0.2-v1" {
		t.Fatal("reviewed Clusterio missing")
	}
	egg, variables, err := parseEggDocument(entry.Egg)
	if err != nil {
		t.Fatal(err)
	}
	a, _, _ := infraTestApp(t)
	ctx := context.Background()
	imported, err := a.ensureGameTemplateEgg(ctx, entry, egg, variables)
	if err != nil {
		t.Fatal(err)
	}
	env := M{}
	for _, variable := range variables {
		env[str(variable["env_variable"])] = variable["default_value"]
	}
	if _, err := a.validateEggEnvironment(ctx, num(imported["id"]), env, false); err != nil {
		t.Fatal(err)
	}
	env["ADMIN_STRING"] = ""
	if _, err := a.validateEggEnvironment(ctx, num(imported["id"]), env, false); err == nil {
		t.Fatal("controller accepted missing administrator")
	}
	env["SERVER_MODE"] = "host"
	if _, err := a.validateEggEnvironment(ctx, num(imported["id"]), env, false); err == nil {
		t.Fatal("host accepted missing controller access")
	}
	env["CONTROLLER_URL"] = "http://192.168.1.10:23560/"
	env["CONTROLLER_TOKEN"] = "fixture-host-token"
	if _, err := a.validateEggEnvironment(ctx, num(imported["id"]), env, false); err != nil {
		t.Fatal(err)
	}
	script := str(asMap(asMap(entry.Egg["scripts"])["installation"])["script"])
	for _, name := range []string{"clusterio-start.mjs", "clusterio-setup.mjs", "clusterio-controller.mjs"} {
		source, err := os.ReadFile("game_library/scripts/" + name)
		if err != nil || !strings.Contains(script, string(source)) {
			t.Fatalf("installer helper out of sync: %s", name)
		}
	}
	if strings.Contains(str(entry.Egg["startup"]), "{{CONTROLLER_TOKEN}}") {
		t.Fatal("host token is exposed in startup arguments")
	}
}

func TestServerConfigAllocatedPortEnvironment(t *testing.T) {
	f := operationsFixtureNew(t)
	ctx := context.Background()
	primary, err := f.a.one(ctx, "SELECT * FROM allocations WHERE id=$1", f.server["allocation_id"])
	if err != nil {
		t.Fatal(err)
	}
	if _, err = f.a.insert(ctx, "allocations", M{"node_id": f.server["node_id"], "server_id": f.server["id"], "ip": primary["ip"], "port": num(primary["port"]) + 1}); err != nil {
		t.Fatal(err)
	}
	if _, err = f.a.insert(ctx, "allocations", M{"node_id": f.server["node_id"], "server_id": f.server["id"], "ip": "192.0.2.99", "port": 29999}); err != nil {
		t.Fatal(err)
	}
	if _, err = f.a.insert(ctx, "egg_variables", M{"egg_id": f.server["egg_id"], "name": "Spoofed ports", "env_variable": "VOLTRA_ALLOCATED_PORTS", "default_value": "9999", "rules": "nullable|string", "user_viewable": true, "user_editable": true}); err != nil {
		t.Fatal(err)
	}
	config, err := f.a.serverConfig(ctx, f.server)
	if err != nil {
		t.Fatal(err)
	}
	ports := str(asMap(config["environment"])["VOLTRA_ALLOCATED_PORTS"])
	want := str(primary["port"]) + "," + str(num(primary["port"])+1)
	if ports != want {
		t.Fatalf("wanted assigned ports %s, got %s", want, ports)
	}
}
