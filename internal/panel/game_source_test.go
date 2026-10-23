package panel

import (
	"context"
	"os"
	"strings"
	"testing"
)

func TestSourceReviewedSettings(t *testing.T) {
	for _, recipe := range []string{
		"counter_strike/counter_strike_source/egg-counter--strike--source.json", "team_fortress_2/egg-team-fortress-2.json",
		"half_life_2_deathmatch/egg-half--life2--deathmatch.json", "fof/egg-fof.json", "black_mesa/egg-black-mesa.json",
		"nmrih/egg-nmrih.json", "left4dead/egg-left4dead.json", "left4dead_2/egg-left4dead_2.json", "iosoccer/eggs-iosoccer.json",
	} {
		t.Run(recipe, func(t *testing.T) {
			var entry gameTemplate
			for _, candidate := range gameTemplates().Entries {
				if candidate.Path == recipe {
					entry = candidate
				}
			}
			ports := 3
			if strings.HasPrefix(recipe, "left4dead") {
				ports = 1
			}
			if entry.Profile != "source-native-v1" || entry.RequiredPorts != ports {
				t.Fatal("Source profile or port layout missing")
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
			if env["PUBLIC_SERVER"] != "0" {
				t.Fatal("default is not LAN")
			}
			if _, err := a.validateEggEnvironment(context.Background(), num(imported["id"]), env, false); err != nil {
				t.Fatal("default LAN rejected:", err)
			}
			script := str(asMap(asMap(entry.Egg["scripts"])["installation"])["script"])
			for _, source := range []string{"source-runtime.py", "source-install.py", "steam-template.py", "native-console.py", "bundle-debian-python.py"} {
				content, err := os.ReadFile("game_library/scripts/" + source)
				if err != nil || !strings.Contains(script, string(content)) {
					t.Fatal("installer helper mismatch", source, err)
				}
			}
		})
	}
}
