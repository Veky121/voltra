package panel

import (
	"encoding/json"
	"os"
	"testing"
)

// Source/default/allocation fixture only; no native game or live Wings claim.
func TestGhostLoveRenownStagedDefaults(t *testing.T) {
	data, err := os.ReadFile("../../.local/ghost-love-renown/profiles.json")
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
	if len(profiles) != 3 {
		t.Fatal("three exact recipes required")
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
				if key == "ADMIN_PASSWORD" || key == "RCON_PASSWORD" {
					if validation == nil {
						t.Fatal("original placeholder must remain unready", key)
					}
					continue
				}
				if validation != nil {
					t.Fatal(key, validation)
				}
				if path == "renown/egg-renown.json" && (key == "QUERY_PORT" || key == "BEACON_PORT" || key == "RCON_PORT") {
					if validateEggValue("0", true, str(variable["rules"]), env) == nil {
						t.Fatal("original invalid0 must not mean disabled", key)
					}
				}
			}
			if err = templateRuntimeEnvironment(profile.Egg, env); err != nil {
				t.Fatal(err)
			}
			primary := M{"ip": "192.0.2.1", "port": 28000}
			extra := []M{}
			for _, port := range []int{28001, 28002, 28003, 27015, 27016, 7787} {
				extra = append(extra, M{"ip": "192.0.2.1", "port": port})
			}
			entry := gameTemplate{RequiredPorts: profile.RequiredPorts, PortRules: profile.PortRules}
			resolved, err := normalizeTemplatePortEnvironment(entry, env, primary, extra)
			if err != nil {
				t.Fatal(err)
			}
			if err = validateTemplatePortRules(entry, resolved, primary, extra); err != nil {
				t.Fatal(err)
			}
			if path == "renown/egg-renown.json" {
				if env["QUERY_PORT"] != "" || resolved["QUERY_PORT"] != "7787" {
					t.Fatal("automatic roles must resolve without mutating raw environment", resolved)
				}
				env["QUERY_PORT"] = "28003"
				resolved, err = normalizeTemplatePortEnvironment(entry, env, primary, extra)
				if err != nil || resolved["QUERY_PORT"] != "28003" {
					t.Fatal("valid explicit query changed", err)
				}
			}
		})
	}
}
