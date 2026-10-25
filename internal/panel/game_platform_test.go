package panel

import (
	"context"
	"net/http"
	"strings"
	"testing"
)

func TestGameTemplatePlatformNormalization(t *testing.T) {
	entry := gameTemplate{Platforms: []string{"linux/arm64"}}
	for _, spec := range []struct {
		name      string
		system    M
		want      string
		supported bool
	}{
		{"stock v2", M{"system": M{"os_type": "linux", "architecture": "arm64"}}, "linux/arm64", true},
		{"uname alias", M{"os": "Linux", "architecture": "aarch64"}, "linux/arm64", true},
		{"x64", M{"system": M{"os_type": "linux", "architecture": "x86_64"}}, "linux/amd64", false},
		{"other OS", M{"os": "windows", "architecture": "arm64"}, "windows/arm64", false},
		{"unknown", M{}, "unknown", false},
	} {
		t.Run(spec.name, func(t *testing.T) {
			got := gameTemplateNodePlatform(spec.system)
			if got != spec.want || gameTemplateSupportsPlatform(entry, got) != spec.supported {
				t.Fatalf("unexpected platform %s", got)
			}
		})
	}
	if !gameTemplateSupportsPlatform(gameTemplate{}, "unknown") {
		t.Fatal("unconstrained recipes changed behavior")
	}
}

func TestARM64FactorioPlatformGate(t *testing.T) {
	a, _, admin, node, wings := steamGamesFixture(t)
	mux := http.NewServeMux()
	a.registerGameTemplates(mux)
	var entry gameTemplate
	for _, candidate := range gameTemplates().Entries {
		if candidate.Path == "factorio/factorio/egg-factorio-a-r-m64.json" {
			entry = candidate
			break
		}
	}
	if entry.Profile != "factorio-arm64-version-choice-v2" || entry.Verification == "runtime_verified" {
		t.Fatal("ARM64 profile missing or incorrectly inherited x64 verification")
	}
	endpoint := "/api/client/game-library/templates/" + entry.ID
	options := asMap(infraExpect(t, mux, admin, "GET", endpoint, nil, 200)["attributes"])
	if len(asSlice(options["nodes"])) != 0 {
		t.Fatal("x64 node offered for ARM64 recipe")
	}
	_, variables, err := parseEggDocument(entry.Egg)
	if err != nil {
		t.Fatal(err)
	}
	env := M{}
	for _, v := range variables {
		env[str(v["env_variable"])] = v["default_value"]
	}
	var allocation int64
	if err = a.DB.QueryRow(context.Background(), "SELECT id FROM allocations WHERE node_id=$1 ORDER BY id LIMIT 1", node["id"]).Scan(&allocation); err != nil {
		t.Fatal(err)
	}
	image := ""
	for _, v := range asMap(entry.Egg["docker_images"]) {
		image = str(v)
		break
	}
	input := M{"name": "ARM fixture", "request_id": newUUID(), "memory": 2048, "disk": 8192, "image": image, "allocation_id": allocation, "allocation_additional": []any{}, "environment": env}
	infraExpect(t, mux, admin, "POST", endpoint+"/install", input, 422)
	var assigned, servers, eggs int
	if err = a.DB.QueryRow(context.Background(), "SELECT (SELECT count(*) FROM allocations WHERE server_id IS NOT NULL),(SELECT count(*) FROM servers),(SELECT count(*) FROM eggs)").Scan(&assigned, &servers, &eggs); err != nil {
		t.Fatal(err)
	}
	if assigned != 0 || servers != 0 || eggs != 0 || wings.Creates != 0 {
		t.Fatal("rejected platform allocated resources or imported an egg")
	}
	wings.mu.Lock()
	wings.Architecture = "aarch64"
	wings.mu.Unlock()
	options = asMap(infraExpect(t, mux, admin, "GET", endpoint, nil, 200)["attributes"])
	if len(asSlice(options["nodes"])) != 1 {
		t.Fatal("ARM64 node not offered")
	}
	infraExpect(t, mux, admin, "POST", endpoint+"/install", input, 201)
	if wings.Creates != 1 {
		t.Fatal("matching platform did not provision exactly one server")
	}
	script := str(asMap(asMap(entry.Egg["scripts"])["installation"])["script"])
	if !strings.Contains(script, "exec box64 ./bin/x64/factorio") || !strings.Contains(script, "jq-linux-arm64") || strings.Contains(script, "jq-linux-amd64") {
		t.Fatal("ARM64 execution or native jq architecture incorrect")
	}
	if !strings.Contains(script, "--architecture box64") || !strings.Contains(script, "command -v box64") || !strings.Contains(script, "requires a Linux ARM64 node") {
		t.Fatal("ARM64 must retain explicit x64 payload via Box64 and node prerequisites")
	}
}
