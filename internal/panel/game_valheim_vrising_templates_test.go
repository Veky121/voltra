package panel

import (
	"context"
	"encoding/json"
	"os"
	"strings"
	"testing"
)

func TestTemplatePrivateWineOwnership(t *testing.T) {
	egg := M{"features": []any{"voltra_steam_template", "voltra_private_wine"}}
	env := M{"AUTO_UPDATE": "1", "WINETRICKS_RUN": "mono", "VOLTRA_WINETRICKS_RUN": "spoofed"}
	if err := templateRuntimeEnvironment(egg, env); err != nil {
		t.Fatal(err)
	}
	if env["WINETRICKS_RUN"] != "" || env["VOLTRA_WINETRICKS_RUN"] != "mono" || env["AUTO_UPDATE"] != "0" || env["VOLTRA_STEAM_AUTO_UPDATE"] != "1" {
		t.Fatal("private prefix ownership did not replace only derived daemon settings")
	}
	for _, value := range []string{"", "mono;touch", "--self-update"} {
		if templateRuntimeEnvironment(egg, M{"AUTO_UPDATE": "1", "WINETRICKS_RUN": value}) == nil {
			t.Fatal("unsupported private runtime instruction accepted")
		}
	}
	ordinary := M{"AUTO_UPDATE": "1", "WINETRICKS_RUN": "mono"}
	if err := templateRuntimeEnvironment(M{"features": []any{"voltra_steam_template"}}, ordinary); err != nil || ordinary["WINETRICKS_RUN"] != "mono" || ordinary["VOLTRA_WINETRICKS_RUN"] != nil {
		t.Fatal("ordinary image runtime controls changed", err)
	}
}

func TestPrivateWineDerivedEnvironmentPreservesStoredControl(t *testing.T) {
	a, _, admin, node, _ := steamGamesFixture(t)
	ctx := context.Background()
	var entry gameTemplate
	for _, candidate := range gameTemplates().Entries {
		if candidate.Path == "v_rising/v_rising_bepinex/egg-v-rising-bep-in-ex.json" {
			entry = candidate
		}
	}
	// Keep the fixture independent of catalog merge timing and do not mutate
	// the shared catalog's in-memory document. Its daemon is an HTTP fixture.
	encoded, _ := json.Marshal(entry.Egg)
	var document M
	if err := json.Unmarshal(encoded, &document); err != nil {
		t.Fatal(err)
	}
	document["features"] = []any{"voltra_steam_template", "voltra_private_wine"}
	egg, variables, err := parseEggDocument(document)
	if err != nil {
		t.Fatal(err)
	}
	imported, err := a.ensureGameTemplateEgg(ctx, entry, egg, variables)
	if err != nil {
		t.Fatal(err)
	}
	environment := M{}
	for _, variable := range variables {
		environment[str(variable["env_variable"])] = variable["default_value"]
	}
	allocations, err := a.query(ctx, "SELECT id FROM allocations WHERE node_id=$1 ORDER BY id", node["id"])
	if err != nil || len(allocations) < 3 {
		t.Fatal("fixture ports absent", err)
	}
	image := ""
	for _, value := range asMap(document["docker_images"]) {
		image = str(value)
	}
	server, err := a.createServer(ctx, M{"name": "Private Wine database fixture", "user": admin, "egg": imported["id"], "node_id": node["id"], "docker_image": image, "startup": document["startup"], "environment": environment, "allocation": M{"default": allocations[0]["id"], "additional": []any{allocations[1]["id"], allocations[2]["id"]}}, "limits": M{"memory": 12288, "disk": 32768, "swap": 0, "io": 500, "cpu": 200}, "feature_limits": M{"databases": 0, "allocations": 2, "backups": 1}, "start_on_completion": false})
	if err != nil {
		t.Fatal(err)
	}
	config, err := a.serverConfig(ctx, server)
	if err != nil {
		t.Fatal(err)
	}
	derived := asMap(config["environment"])
	if derived["WINETRICKS_RUN"] != "" || derived["VOLTRA_WINETRICKS_RUN"] != "mono" {
		t.Fatal("private Wine daemon environment alias missing")
	}
	stored, err := a.one(ctx, "SELECT sv.variable_value FROM server_variables sv JOIN egg_variables ev ON ev.id=sv.variable_id WHERE sv.server_id=$1 AND ev.env_variable='WINETRICKS_RUN'", server["id"])
	if err != nil || stored["variable_value"] != "mono" {
		t.Fatal("original stored API value was changed", err)
	}
}

func TestValheimVRisingTemplateDefaults(t *testing.T) {
	for _, entry := range gameTemplates().Entries {
		if !strings.HasPrefix(entry.Path, "valheim/") && !strings.HasPrefix(entry.Path, "v_rising/") {
			continue
		}
		t.Run(entry.Path, func(t *testing.T) {
			windows := strings.HasPrefix(entry.Path, "v_rising/")
			app, ports, runtime := "896660", 2, "valheim-runtime.py"
			if windows {
				app, ports, runtime = "1829350", 3, "vrising-runtime.py"
			}
			if entry.RequiredPorts != ports || entry.ConsecutivePorts != !windows || str(asMap(entry.Egg["config"])["stop"]) != "^SIGINT" {
				t.Fatal("native signal or required allocation layout missing")
			}
			a, _, _, _, _ := steamGamesFixture(t)
			egg, variables, err := parseEggDocument(entry.Egg)
			if err != nil {
				t.Fatal(err)
			}
			imported, err := a.ensureGameTemplateEgg(context.Background(), entry, egg, variables)
			if err != nil {
				t.Fatal(err)
			}
			env := M{}
			for _, variable := range variables {
				env[str(variable["env_variable"])] = variable["default_value"]
			}
			if env["SRCDS_APPID"] != app {
				t.Fatal("original dedicated app changed")
			}
			if _, err := a.validateEggEnvironment(context.Background(), num(imported["id"]), env, false); err != nil {
				t.Fatal("original default controls invalid:", err)
			}
			script := str(asMap(asMap(entry.Egg["scripts"])["installation"])["script"])
			for _, source := range []string{runtime, "valheim-vrising-install.py", "steam-template.py", "native-config.py", "bundle-debian-python.py"} {
				content, err := os.ReadFile("game_library/scripts/" + source)
				if err != nil || !strings.Contains(script, string(content)) {
					t.Fatal("embedded current native source missing:", source, err)
				}
			}
			primary := M{"ip": "192.0.2.1", "port": 28020}
			additional := []M{{"ip": "192.0.2.1", "port": 28021}}
			if windows {
				additional = append(additional, M{"ip": "192.0.2.1", "port": 28022})
			}
			if err := validateTemplatePortLayout(entry, primary, additional); err != nil {
				t.Fatal(err)
			}
		})
	}
}
