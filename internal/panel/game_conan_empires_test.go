package panel

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
)

func TestConanEmpiresStagedDefaults(t *testing.T) {
	data, err := os.ReadFile("../../.local/conan-empires/profiles.json")
	if os.IsNotExist(err) {
		t.Skip("scoped stage absent")
	}
	if err != nil {
		t.Fatal(err)
	}
	var profiles map[string]struct {
		Egg           M                  `json:"egg"`
		RequiredPorts int                `json:"required_ports"`
		PortRules     []templatePortRule `json:"port_rules"`
	}
	if err := json.Unmarshal(data, &profiles); err != nil {
		t.Fatal(err)
	}
	if len(profiles) != 3 {
		t.Fatal("three exact Conan/MoE recipes required")
	}
	for path, profile := range profiles {
		t.Run(path, func(t *testing.T) {
			_, variables, err := parseEggDocument(profile.Egg)
			if err != nil {
				t.Fatal(err)
			}
			env := M{}
			for _, variable := range variables {
				env[str(variable["env_variable"])] = variable["default_value"]
			}
			for _, variable := range variables {
				validation := validateEggValue(variable["default_value"], true, str(variable["rules"]), env)
				if str(variable["env_variable"]) == "RCON_PASSWORD" && strings.HasPrefix(path, "myth_") {
					if validation == nil {
						t.Fatal("actual private shutdown key must be operator supplied")
					}
					continue
				}
				if validation != nil {
					t.Fatal(variable["env_variable"], validation)
				}
			}
			if err := templateRuntimeEnvironment(profile.Egg, env); err != nil {
				t.Fatal(err)
			}
			if env["WINETRICKS_RUN"] != nil {
				if env["WINETRICKS_RUN"] != "" || env["VOLTRA_WINETRICKS_RUN"] != "vcrun2022 corefonts" {
					t.Fatal("generic typed Wine ownership did not retain original requested prerequisites")
				}
			}
			primary := M{"ip": "192.0.2.1", "port": 28000}
			extra := []M{}
			if strings.HasPrefix(path, "myth_") {
				env["QUERY_PORT"], env["RCON_PORT"] = "28001", "28002"
				extra = []M{{"ip": "192.0.2.1", "port": 28001}, {"ip": "192.0.2.1", "port": 28002}}
			} else {
				env["QUERY_PORT"], env["RCON_PORT"], env["RCON_ENABLED"] = "28002", "28003", "1"
				for port := 28001; port <= 28003; port++ {
					extra = append(extra, M{"ip": "192.0.2.1", "port": port})
				}
			}
			if err := validateTemplatePortRules(gameTemplate{PortRules: profile.PortRules}, env, primary, extra); err != nil {
				t.Fatal(err)
			}
			if err := validateTemplatePortRules(gameTemplate{PortRules: profile.PortRules}, env, primary, nil); err == nil {
				t.Fatal("missing native listeners accepted")
			}
		})
	}
}
