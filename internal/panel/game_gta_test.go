package panel

import (
	"os"
	"strings"
	"testing"
)

func TestGTAReviewedDefaults(t *testing.T) {
	for _, recipe := range []string{"gta/openmp/egg-open-m-p.json", "gta/mtasa/egg-multi-theft-auto.json"} {
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
					t.Fatal(variable["env_variable"], err)
				}
			}
			for _, name := range []string{"gta-install.py", "gta-runtime.py", "native-release.py", "native-config.py", "native-console.py", "steam-template.py"} {
				source, err := os.ReadFile("game_library/scripts/" + name)
				if err != nil || !strings.Contains(str(egg["script_install"]), string(source)) {
					t.Fatal("missing or stale source", name, err)
				}
			}
			if str(egg["config_stop"]) != "^SIGINT" {
				t.Fatal("native stop wrapper missing")
			}
			if strings.Contains(recipe, "mtasa") {
				if entry.RequiredPorts != 2 || len(entry.PortRules) != 1 {
					t.Fatal("MTA sparse ASE layout missing")
				}
				primary := M{"ip": "192.0.2.1", "port": 22003}
				extra := []M{{"ip": "192.0.2.1", "port": 22005}, {"ip": "192.0.2.1", "port": 22126}}
				if validateTemplatePortRules(entry, M{"ASE_ENABLED": "1"}, primary, extra) != nil {
					t.Fatal("valid ASE+HTTP layout rejected")
				}
				if validateTemplatePortRules(entry, M{"ASE_ENABLED": "1"}, primary, extra[:1]) == nil {
					t.Fatal("missing ASE offset accepted")
				}
			}
		})
	}
}
