package panel

import (
	"context"
	"net/http"
	"os"
	"strings"
	"testing"
)

func TestProjectZomboidReviewedSettings(t *testing.T) {
	var entry gameTemplate
	for _, candidate := range gameTemplates().Entries {
		if candidate.Path == "project_zomboid/egg-project-zomboid.json" {
			entry = candidate
		}
	}
	if entry.Profile != "project-zomboid-native-v1" || entry.RequiredPorts != 2 || len(entry.Platforms) != 1 || entry.Platforms[0] != "linux/amd64" {
		t.Fatal("reviewed platform or port requirement missing")
	}
	a, _, admin, node, wings := steamGamesFixture(t)
	ctx := context.Background()
	egg, variables, err := parseEggDocument(entry.Egg)
	if err != nil {
		t.Fatal(err)
	}
	imported, err := a.ensureGameTemplateEgg(ctx, entry, egg, variables)
	if err != nil {
		t.Fatal(err)
	}
	env := M{}
	for _, variable := range variables {
		env[str(variable["env_variable"])] = variable["default_value"]
	}
	if env["SERVER_NAME"] != "Pterodactyl" || env["SRCDS_APPID"] != "380870" || env["AUTO_UPDATE"] != "0" {
		t.Fatal("original defaults removed")
	}
	env["PUBLIC_NAME"] = `Zomboid +literal $safe "quoted"`
	env["AUTO_UPDATE"] = "1"
	if _, err = a.validateEggEnvironment(ctx, num(imported["id"]), env, false); err != nil {
		t.Fatal(err)
	}
	for _, spec := range []struct{ key, value string }{{"SERVER_NAME", "../world"}, {"SRCDS_APPID", "111"}, {"STEAM_PORT", "65536"}, {"AUTO_UPDATE", "true"}, {"SRCDS_BETAID", "+quit"}, {"STEAM_PASS", "+quit"}, {"ADMIN_USER", "bad\nuser"}, {"PUBLIC_NAME", "bad\nname"}, {"JAVA_HEAP_MB", "-1"}, {"MAX_PLAYERS", "101"}} {
		invalid := M{}
		for key, value := range env {
			invalid[key] = value
		}
		invalid[spec.key] = spec.value
		if _, err = a.validateEggEnvironment(ctx, num(imported["id"]), invalid, false); err == nil {
			t.Fatalf("invalid %s accepted", spec.key)
		}
	}
	script := str(asMap(asMap(entry.Egg["scripts"])["installation"])["script"])
	for _, name := range []string{"steam-template.py", "bundle-debian-python.py", "project-zomboid-runtime.py"} {
		source, readErr := os.ReadFile("game_library/scripts/" + name)
		if readErr != nil || !strings.Contains(script, string(source)) {
			t.Fatal("installer/source mismatch:", name, readErr)
		}
	}
	allocations, err := a.query(ctx, "SELECT id FROM allocations WHERE node_id=$1 ORDER BY id", node["id"])
	if err != nil || len(allocations) < 2 {
		t.Fatal("fixture ports missing", err)
	}
	mux := http.NewServeMux()
	a.registerGameTemplates(mux)
	image := ""
	for _, value := range asMap(entry.Egg["docker_images"]) {
		image = str(value)
	}
	input := M{"name": "Zomboid fixture", "request_id": newUUID(), "memory": 6144, "disk": 32768, "image": image, "allocation_id": allocations[0]["id"], "environment": env}
	endpoint := "/api/client/game-library/templates/" + entry.ID + "/install"
	infraExpect(t, mux, admin, "POST", endpoint, input, 422)
	if wings.Creates != 0 {
		t.Fatal("missing required port reached Wings")
	}
	if err = a.exec(ctx, "UPDATE allocations SET ip='192.0.2.99' WHERE id=$1", allocations[1]["id"]); err != nil {
		t.Fatal(err)
	}
	input["allocation_additional"] = []any{allocations[1]["id"]}
	infraExpect(t, mux, admin, "POST", endpoint, input, 422)
	if wings.Creates != 0 {
		t.Fatal("ports on different addresses reached Wings")
	}
	primary, _ := a.one(ctx, "SELECT ip FROM allocations WHERE id=$1", allocations[0]["id"])
	if err = a.exec(ctx, "UPDATE allocations SET ip=$1 WHERE id=$2", primary["ip"], allocations[1]["id"]); err != nil {
		t.Fatal(err)
	}
	created := asMap(infraExpect(t, mux, admin, "POST", endpoint, input, 201)["attributes"])
	server, err := a.one(ctx, "SELECT * FROM servers WHERE uuid_short=$1", created["identifier"])
	if err != nil {
		t.Fatal(err)
	}
	config, err := a.serverConfig(ctx, server)
	if err != nil {
		t.Fatal(err)
	}
	configured := asMap(config["environment"])
	if configured["AUTO_UPDATE"] != "0" || configured["VOLTRA_STEAM_AUTO_UPDATE"] != "1" || configured["SRCDS_APPID"] != "380870" || len(strings.Split(str(configured["VOLTRA_ALLOCATED_PORTS"]), ",")) != 2 {
		t.Fatal("native environment did not preserve single-owner updates and actual ports")
	}
}
