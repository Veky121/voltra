package panel

import (
	"encoding/json"
	"os"
	"testing"
)

func TestArmaStagedDefaults(t *testing.T) {
	data, err := os.ReadFile("../../.local/arma-games/profiles.json")
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
	if err = json.Unmarshal(data, &profiles); err != nil {
		t.Fatal(err)
	}
	if len(profiles) != 2 {
		t.Fatal("two exact Arma recipes required")
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
				if err := validateEggValue(variable["default_value"], true, str(variable["rules"]), env); err != nil {
					t.Fatal(variable["env_variable"], err)
				}
			}
			if err := templateRuntimeEnvironment(profile.Egg, env); err != nil {
				t.Fatal(err)
			}
			if str(env["AUTO_UPDATE"]) != "0" {
				t.Fatal("unreviewed image updater enabled")
			}
			primary := M{"ip": "192.0.2.1", "port": 28000}
			extra := []M{}
			if profile.RequiredPorts == 5 {
				for port := 28001; port <= 28004; port++ {
					extra = append(extra, M{"ip": "192.0.2.1", "port": port})
				}
				if err := validateTemplatePortRules(gameTemplate{PortRules: profile.PortRules}, env, primary, extra[:3]); err == nil {
					t.Fatal("missing BattlEye offset accepted")
				}
			} else {
				env["A2S_PORT"], env["RCON_PORT"] = "28001", "28002"
				extra = []M{{"ip": "192.0.2.1", "port": 28001}, {"ip": "192.0.2.1", "port": 28002}}
			}
			if err := validateTemplatePortRules(gameTemplate{PortRules: profile.PortRules}, env, primary, extra); err != nil {
				t.Fatal(err)
			}
			if profile.RequiredPorts == 1 {
				env["A2S_PORT"] = "28000"
				if err := validateTemplatePortRules(gameTemplate{PortRules: profile.PortRules}, env, primary, extra); err == nil {
					t.Fatal("query reused primary")
				}
			}
		})
	}
}
