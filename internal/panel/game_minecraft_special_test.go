package panel

import (
	"encoding/json"
	"os"
	"testing"
)

func TestMinecraftSpecialStagedDefaults(t *testing.T) {
	data, err := os.ReadFile("../../.local/minecraft-special/profiles.json")
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
	if len(profiles) != 4 {
		t.Fatal("four exact recipes required")
	}
	for path, p := range profiles {
		t.Run(path, func(t *testing.T) {
			_, variables, err := parseEggDocument(p.Egg)
			if err != nil {
				t.Fatal(err)
			}
			env := M{}
			for _, v := range variables {
				env[str(v["env_variable"])] = v["default_value"]
			}
			for _, v := range variables {
				if str(v["env_variable"]) == "ADMIN_PASS" {
					if validateEggValue(v["default_value"], true, str(v["rules"]), env) == nil {
						t.Fatal("operator password must be explicitly required")
					}
					continue
				}
				if err := validateEggValue(v["default_value"], true, str(v["rules"]), env); err != nil {
					t.Fatal(v["env_variable"], err)
				}
			}
			primary := M{"ip": "192.0.2.1", "port": 28000}
			extra := []M{}
			for i, r := range p.PortRules {
				env[r.Environment] = []string{"28001", "28002"}[i]
				extra = append(extra, M{"ip": "192.0.2.1", "port": 28001 + i})
			}
			if err := validateTemplatePortRules(gameTemplate{PortRules: p.PortRules}, env, primary, extra); err != nil {
				t.Fatal(err)
			}
			if _, ok := env["WEBRTC_PORT"]; ok {
				env["WEBRTC_PORT"] = env["BEDROCK_PORT"]
				v := variables[0]
				for _, candidate := range variables {
					if str(candidate["env_variable"]) == "WEBRTC_PORT" {
						v = candidate
					}
				}
				if validateEggValue(env["WEBRTC_PORT"], true, str(v["rules"]), env) == nil {
					t.Fatal("two auxiliary listeners accepted same port")
				}
			}
		})
	}
}
