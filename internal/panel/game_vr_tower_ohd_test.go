package panel

import (
	"encoding/json"
	"os"
	"testing"
)

func TestVRTowerOHDStagedDefaults(t *testing.T) {
	data, err := os.ReadFile("../../.local/vr-tower-ohd/profiles.json")
	if os.IsNotExist(err) {
		t.Skip("scoped stage absent")
	}
	if err != nil {
		t.Fatal(err)
	}
	var profiles map[string]struct {
		Egg       M                  `json:"egg"`
		PortRules []templatePortRule `json:"port_rules"`
	}
	if err := json.Unmarshal(data, &profiles); err != nil {
		t.Fatal(err)
	}
	if len(profiles) != 3 {
		t.Fatal("three exact native Linux recipes required")
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
				key := str(variable["env_variable"])
				validation := validateEggValue(variable["default_value"], true, str(variable["rules"]), env)
				needsInput := key == "STEAM_LOGIN_TOKEN" || key == "STEAM_ADMIN_ID" || key == "API_KEY" || key == "RCON_PASSWORD"
				if needsInput {
					if validation == nil {
						t.Fatal("real operator prerequisite accepted default", key)
					}
					continue
				}
				if validation != nil {
					t.Fatal(key, validation)
				}
			}
			if err := templateRuntimeEnvironment(profile.Egg, env); err != nil {
				t.Fatal(err)
			}
			primary := M{"ip": "192.0.2.1", "port": 28000}
			extra := []M{{"ip": "192.0.2.1", "port": 28001}, {"ip": "192.0.2.1", "port": 28400}, {"ip": "192.0.2.1", "port": 27015}, {"ip": "192.0.2.1", "port": 27005}, {"ip": "192.0.2.1", "port": 7779}, {"ip": "192.0.2.1", "port": 8188}}
			if err := validateTemplatePortRules(gameTemplate{PortRules: profile.PortRules}, env, primary, extra); err != nil {
				t.Fatal(err)
			}
			if err := validateTemplatePortRules(gameTemplate{PortRules: profile.PortRules}, env, primary, nil); err == nil {
				t.Fatal("missing native listener allocations accepted")
			}
		})
	}
}
