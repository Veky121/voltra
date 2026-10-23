package panel

import (
	"encoding/json"
	"os"
	"testing"
)

func TestGTANextStagedDefaults(t *testing.T) {
	data, err := os.ReadFile("../../.local/gta-next/profiles.json")
	if os.IsNotExist(err) {
		t.Skip("independent GTA staging artifact is not present")
	}
	if err != nil {
		t.Fatal(err)
	}
	var profiles map[string]struct {
		Egg M `json:"egg"`
	}
	if err := json.Unmarshal(data, &profiles); err != nil {
		t.Fatal(err)
	}
	if len(profiles) != 7 {
		t.Fatalf("expected six assigned GTA recipes and exact RedM, got %d", len(profiles))
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
				if (str(variable["env_variable"]) == "FIVEM_LICENSE" || str(variable["env_variable"]) == "CFX_LICENSE") && str(variable["default_value"]) == "" {
					if validateEggValue("", true, str(variable["rules"]), env) == nil {
						t.Fatal("operator Cfx license must remain required; do not invent a fixture key")
					}
					continue
				}
				if err := validateEggValue(variable["default_value"], true, str(variable["rules"]), env); err != nil {
					t.Fatal(variable["env_variable"], err)
				}
			}
		})
	}
}
