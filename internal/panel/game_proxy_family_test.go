package panel

import (
	"encoding/json"
	"os"
	"testing"
)

func TestProxyFamilyStagedDefaults(t *testing.T) {
	data, err := os.ReadFile("../../.local/proxy-games/profiles.json")
	if os.IsNotExist(err) {
		t.Skip("independent proxy stage absent")
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
	if len(profiles) != 6 {
		t.Fatal("expected six exact imported proxy recipes")
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
			if profile.RequiredPorts == 2 {
				entry := gameTemplate{RequiredPorts: 2, PortRules: profile.PortRules}
				primary := M{"ip": "192.0.2.1", "port": 28000}
				extra := []M{{"ip": "192.0.2.1", "port": 28001}}
				for _, rule := range profile.PortRules {
					if !rule.ExcludePrimary {
						t.Fatal("native listener rule must exclude primary")
					}
					env[rule.Environment] = "28001"
				}
				if err := validateTemplatePortRules(entry, env, primary, extra); err != nil {
					t.Fatal(err)
				}
				for _, rule := range profile.PortRules {
					env[rule.Environment] = "28000"
				}
				if validateTemplatePortRules(entry, env, primary, extra) == nil {
					t.Fatal("colliding native listener accepted")
				}
				if validateTemplatePortRules(entry, env, primary, nil) == nil {
					t.Fatal("missing allocated native service port accepted")
				}
			}
		})
	}
}
