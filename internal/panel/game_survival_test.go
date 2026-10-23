package panel

import (
	"context"
	"os"
	"strings"
	"testing"
)

func TestSurvivalReviewedSettings(t *testing.T) {
	for _, spec := range []struct {
		path, profile, app string
		ports              int
		consecutive        bool
		sources            []string
	}{
		{"rust/rust_autowipe/egg-rust-autowipe.json", "rust-native-v1", "258550", 4, false, []string{"rust-runtime.py", "rust-install.py"}},
		{"rust/rust_staging/egg-rust-staging.json", "rust-native-v1", "258550", 4, false, []string{"rust-runtime.py", "rust-install.py"}},
		{"core_keeper/egg-core-keeper.json", "core-keeper-native-v1", "1963720", 2, true, []string{"core-keeper-runtime.py"}},
	} {
		t.Run(spec.path, func(t *testing.T) {
			var entry gameTemplate
			for _, candidate := range gameTemplates().Entries {
				if candidate.Path == spec.path {
					entry = candidate
				}
			}
			if entry.Profile != spec.profile || entry.RequiredPorts != spec.ports || entry.ConsecutivePorts != spec.consecutive {
				t.Fatal("reviewed native profile or allocated port requirements missing")
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
			if env["SRCDS_APPID"] != spec.app {
				t.Fatal("publisher app changed")
			}
			if strings.Contains(spec.path, "rust_staging") && env["SRCDS_BETAID"] != "staging" {
				t.Fatal("original staging branch missing")
			}
			if spec.app == "258550" && str(asMap(entry.Egg["config"])["stop"]) != "^SIGINT" {
				t.Fatal("Rust Stop must use the explicit signal supported by the running panel")
			}
			if _, err := a.validateEggEnvironment(context.Background(), num(imported["id"]), env, false); err != nil {
				t.Fatal("default native settings rejected:", err)
			}
			invalidValues := [][2]string{{"SRCDS_APPID", "1"}, {"MAX_PLAYERS", "0"}}
			if spec.app == "258550" {
				invalidValues = append(invalidValues, [2]string{"SERVER_ID", "../other"}, [2]string{"WORLD_SIZE", "999"}, [2]string{"HOSTNAME", "bad\nquit"}, [2]string{"FRAMEWORK", "unknown"}, [2]string{"RCON_PASS", "short"})
			} else {
				invalidValues = append(invalidValues, [2]string{"WORLD_INDEX", "30"}, [2]string{"GAME_ID", "contains000000000"}, [2]string{"WORLD_MODE", "unknown"}, [2]string{"SERVER_PASSWORD", strings.Repeat("a", 29)})
			}
			for _, invalid := range invalidValues {
				values := M{}
				for key, value := range env {
					values[key] = value
				}
				values[invalid[0]] = invalid[1]
				if _, err := a.validateEggEnvironment(context.Background(), num(imported["id"]), values, false); err == nil {
					t.Fatal("invalid native setting accepted:", invalid[0])
				}
			}
			script := str(asMap(asMap(entry.Egg["scripts"])["installation"])["script"])
			for _, source := range append(spec.sources, "steam-template.py", "bundle-debian-python.py") {
				content, err := os.ReadFile("game_library/scripts/" + source)
				if err != nil || !strings.Contains(script, string(content)) {
					t.Fatal("embedded native source mismatch:", source, err)
				}
			}
			primary := M{"ip": "192.0.2.1", "port": 28020}
			var additional []M
			for port := 28021; port < 28020+spec.ports; port++ {
				additional = append(additional, M{"ip": "192.0.2.1", "port": port})
			}
			if err := validateTemplatePortLayout(entry, primary, additional); err != nil {
				t.Fatal(err)
			}
			if err := validateTemplatePortLayout(entry, primary, additional[:len(additional)-1]); err == nil {
				t.Fatal("missing native port accepted")
			}
			if spec.consecutive {
				if err := validateTemplatePortLayout(entry, primary, []M{{"ip": "192.0.2.1", "port": 28022}}); err == nil {
					t.Fatal("nonconsecutive Core Keeper query allocation accepted")
				}
			}
		})
	}
}
