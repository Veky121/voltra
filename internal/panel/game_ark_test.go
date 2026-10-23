package panel

import (
	"encoding/json"
	"os"
	"testing"
)

func TestArkWineDerivedEnvironment(t *testing.T) {
	for _, value := range []string{"vcrun2019 dotnet6", "", "operator original value"} {
		env := M{"AUTO_UPDATE": "1", "WINETRICKS_RUN": value, "VOLTRA_ARK_WINETRICKS_RUN": "spoofed"}
		egg := M{"features": []any{"voltra_steam_template", "voltra_ark_wine"}}
		if err := templateRuntimeEnvironment(egg, env); err != nil {
			t.Fatal(err)
		}
		if env["WINETRICKS_RUN"] != "" || env["VOLTRA_ARK_WINETRICKS_RUN"] != value || env["AUTO_UPDATE"] != "0" || env["VOLTRA_STEAM_AUTO_UPDATE"] != "1" {
			t.Fatal("ARK image prerequisite setup was not isolated from its original stored field")
		}
	}
	for _, features := range [][]any{{"voltra_steam_template"}, {"voltra_ark_wine"}, nil} {
		env := M{"AUTO_UPDATE": "1", "WINETRICKS_RUN": "vcrun2019 dotnet6"}
		if err := templateRuntimeEnvironment(M{"features": features}, env); err != nil {
			t.Fatal(err)
		}
		if env["WINETRICKS_RUN"] != "vcrun2019 dotnet6" || env["VOLTRA_ARK_WINETRICKS_RUN"] != nil {
			t.Fatal("unrelated recipe changed")
		}
	}
	private := M{"AUTO_UPDATE": "1", "WINETRICKS_RUN": "mono"}
	if err := templateRuntimeEnvironment(M{"features": []any{"voltra_steam_template", "voltra_private_wine"}}, private); err != nil || private["VOLTRA_WINETRICKS_RUN"] != "mono" || private["VOLTRA_ARK_WINETRICKS_RUN"] != nil {
		t.Fatal("existing private Wine behavior changed", err)
	}
}

func TestArkStagedDefaults(t *testing.T) {
	data, err := os.ReadFile("../../.local/ark-family/profiles.json")
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
		t.Fatal("three exact ARK recipes required")
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
				if str(variable["env_variable"]) == "ARK_ADMIN_PASSWORD" {
					if validation == nil {
						t.Fatal("blank real operator password accepted")
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
			primary := M{"ip": "192.0.2.1", "port": 28000}
			extra := []M{}
			for port := 28001; port < 28000+profile.RequiredPorts; port++ {
				extra = append(extra, M{"ip": "192.0.2.1", "port": port})
			}
			if profile.RequiredPorts == 5 {
				env["QPORT"], env["RCPORT"], env["CUBEPORT"] = "28002", "28003", "28004"
			} else {
				env["RCON_PORT"] = "28002"
				if profile.RequiredPorts == 4 {
					env["QUERY_PORT"] = "28003"
				}
			}
			if err := validateTemplatePortRules(gameTemplate{PortRules: profile.PortRules}, env, primary, extra); err != nil {
				t.Fatal(err)
			}
			if err := validateTemplatePortRules(gameTemplate{PortRules: profile.PortRules}, env, primary, nil); err == nil {
				t.Fatal("missing ARK offsets/listeners accepted")
			}
		})
	}
}
