package panel

import (
	"os"
	"strings"
	"testing"
)

func TestAmongUsReviewedDefaults(t *testing.T) {
	for _, recipe := range []string{
		"among_us/bettercrewlink_server/egg-better-crewlink-server.json",
		"among_us/impostor_server/egg-among-us--impostor-server.json",
	} {
		t.Run(recipe, func(t *testing.T) {
			var entry gameTemplate
			for _, candidate := range gameTemplates().Entries {
				if candidate.Path == recipe {
					entry = candidate
				}
			}
			if entry.Profile == "" {
				t.Fatal("reviewed profile missing")
			}
			egg, variables, err := parseEggDocument(entry.Egg)
			if err != nil {
				t.Fatal(err)
			}
			env := M{}
			for _, variable := range variables {
				env[str(variable["env_variable"])] = variable["default_value"]
			}
			for _, variable := range variables {
				if err := validateEggValue(variable["default_value"], true, str(variable["rules"]), env); err != nil {
					t.Fatalf("default %s rejected: %v", variable["env_variable"], err)
				}
			}
			if strings.Contains(recipe, "bettercrewlink") {
				for _, variable := range variables {
					if str(variable["env_variable"]) == "BRANCH" {
						for _, valid := range []string{"master", "feature/test", "v1.0-rc1"} {
							if err := validateEggValue(valid, true, str(variable["rules"]), env); err != nil {
								t.Fatal("original branch selection rejected:", valid, err)
							}
						}
					}
				}
			}
			for _, name := range []string{"among-us-install.py", "among-us-runtime.py", "native-release.py", "native-config.py", "bundle-debian-python.py"} {
				source, err := os.ReadFile("game_library/scripts/" + name)
				if err != nil || !strings.Contains(str(egg["script_install"]), string(source)) {
					t.Fatal("missing or stale embedded source:", name, err)
				}
			}
			if str(egg["config_stop"]) != "^SIGINT" {
				t.Fatal("native stop signal missing")
			}
		})
	}
}
