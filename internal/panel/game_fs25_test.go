package panel

import (
	"context"
	"net/http"
	"strings"
	"testing"
)

func TestFS25ReviewedTemplate(t *testing.T) {
	entry := farmingSimulatorTemplate()
	egg, vars, err := parseEggDocument(entry.Egg)
	if err != nil {
		t.Fatal(err)
	}
	if len(vars) != 20 || entry.RequiredPorts != 2 || entry.Verification == "runtime_verified" {
		t.Fatal("invalid FS25 metadata")
	}
	for _, variable := range vars {
		if !boolean(variable["user_viewable"]) {
			t.Fatal("setting unavailable after installation", variable["env_variable"])
		}
	}
	for _, image := range asMap(egg["docker_images"]) {
		if !strings.Contains(str(image), "@sha256:") {
			t.Fatal("mutable image")
		}
	}
	environment, err := templateEnvironment(vars, M{})
	if err != nil {
		t.Fatal(err)
	}
	environment, err = normalizeTemplatePortEnvironment(entry, environment, M{"port": int64(10823)}, []M{{"port": int64(7999)}})
	if err != nil || environment["WEB_PORT"] != "7999" {
		t.Fatalf("web port: %v %v", environment["WEB_PORT"], err)
	}
	if err = validateTemplatePortRules(entry, environment, M{"port": int64(10823)}, []M{{"port": int64(7999)}}); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"GAME_SERIAL", "DLC_PRODUCT_KEY", "WEB_PASSWORD"} {
		if !startupSecretName(name) {
			t.Fatal("unmasked secret", name)
		}
	}
}

func TestFS25SavedLicenseAndSecretOverrides(t *testing.T) {
	a, _, admin, node, wings := steamGamesFixture(t)
	ctx := context.Background()
	entry := farmingSimulatorTemplate()
	mux := http.NewServeMux()
	a.registerGameTemplates(mux)
	endpoint := "/api/client/game-library/templates/" + entry.ID
	options := asMap(infraExpect(t, mux, admin, "GET", endpoint, nil, 200)["attributes"])
	eggID := num(options["egg_id"])
	if eggID == 0 || boolean(options["saved_license"]) {
		t.Fatal("licence metadata incorrect")
	}
	sealed, err := a.seal(`{"license_key":"FS25-FAKE-TEST-KEY"}`)
	if err != nil {
		t.Fatal(err)
	}
	_, err = a.insert(ctx, "integrations", M{"name": "FS25 fixture", "provider": "game_license", "egg_id": eggID, "enabled": true, "bindings": M{"license_key": []any{"GAME_SERIAL"}}, "credentials": sealed})
	if err != nil {
		t.Fatal(err)
	}
	options = asMap(infraExpect(t, mux, admin, "GET", endpoint, nil, 200)["attributes"])
	if !boolean(options["saved_license"]) {
		t.Fatal("saved licence missing")
	}
	_, vars, _ := parseEggDocument(entry.Egg)
	env, _ := templateEnvironment(vars, M{"WEB_PASSWORD": "fixture-password-only"})
	image := ""
	for _, raw := range asMap(entry.Egg["docker_images"]) {
		image = str(raw)
	}
	input := M{"name": "FS25 fixture", "request_id": newUUID(), "memory": 6144, "disk": 102400, "image": image, "node_id": node["id"], "automatic_ports": true, "environment": env}
	result := asMap(infraExpect(t, mux, admin, "POST", endpoint+"/install", input, 201)["attributes"])
	if str(result["identifier"]) == "" || wings.Creates != 1 {
		t.Fatal("missing provisioned server")
	}
	server, err := a.one(ctx, "SELECT * FROM servers WHERE uuid_short=$1", result["identifier"])
	if err != nil {
		t.Fatal(err)
	}
	secrets, err := a.serverIntegrationSecrets(ctx, num(server["id"]))
	if err != nil {
		t.Fatal(err)
	}
	found := map[string]string{}
	for _, secret := range secrets {
		plain, e := a.unseal(str(secret["value"]))
		if e != nil {
			t.Fatal(e)
		}
		found[str(secret["env_variable"])] = plain
	}
	if found["GAME_SERIAL"] != "FS25-FAKE-TEST-KEY" || found["WEB_PASSWORD"] != "fixture-password-only" {
		t.Fatal("encrypted snapshot not preserved")
	}
	rows, err := a.query(ctx, "SELECT sv.variable_value FROM server_variables sv WHERE server_id=$1", server["id"])
	if err != nil {
		t.Fatal(err)
	}
	for _, row := range rows {
		if strings.Contains(str(row["variable_value"]), "FAKE-TEST") || strings.Contains(str(row["variable_value"]), "fixture-password") {
			t.Fatal("plaintext credential")
		}
	}
}
