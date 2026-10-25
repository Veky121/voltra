package panel

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestTShockReviewedProfile(t *testing.T) {
	var entry gameTemplate
	for _, candidate := range gameTemplates().Entries {
		if candidate.Path == "terraria/tshock/egg-tshock.json" {
			entry = candidate
			break
		}
	}
	if entry.Profile != "tshock-6.2.1-v1-exact-release-v1" {
		t.Fatal("reviewed TShock missing")
	}
	_, variables, err := parseEggDocument(entry.Egg)
	if err != nil {
		t.Fatal(err)
	}
	images := asMap(entry.Egg["docker_images"])
	if len(images) != 1 || str(images[".NET 9"]) != "ghcr.io/ptero-eggs/yolks:dotnet_9" {
		t.Fatal("TShock 6 runtime requires .NET 9")
	}
	rules := map[string]string{}
	for _, variable := range variables {
		key := str(variable["env_variable"])
		rules[key] = str(variable["rules"])
		if err := validateEggValue(variable["default_value"], true, rules[key], M{}); err != nil {
			t.Fatalf("%s default: %v", key, err)
		}
	}
	for _, sample := range []struct{ key, value string }{{"WORLD_NAME", "../world"}, {"WORLD_NAME", "world;echo injected"}, {"SERVER_NAME", "line\nother"}, {"SERVER_PASSWORD", "line\rnext"}, {"MAX_PLAYERS", "256"}, {"MAX_PLAYERS", "0"}, {"WORLD_SIZE", "0"}, {"WORLD_DIFFICULTY", "4"}, {"TSHOCK_VERSION", "v6.1.0\n"}} {
		if err := validateEggValue(sample.value, true, rules[sample.key], M{}); err == nil {
			t.Fatalf("accepted invalid %s", sample.key)
		}
	}
	for _, version := range []string{"latest", "v6.1.0", "6.1.0", "v5.2.4", "5.2.4"} {
		if validateEggValue(version, true, rules["TSHOCK_VERSION"], M{}) != nil {
			t.Fatal("exact release syntax rejected", version)
		}
	}
	assertTerrariaReleaseInstaller(t, entry, "tshock", "TSHOCK_VERSION", "v6.2.1", "deb9189acbdbd2ee0f0a06fffe15358033859a4ba842b22f79a84bda68600105")
	if err := validateEggValue("literal'\"$()=value", true, rules["SERVER_PASSWORD"], M{}); err != nil {
		t.Fatal("password must remain literal data", err)
	}
	var files M
	if err := json.Unmarshal([]byte(str(asMap(entry.Egg["config"])["files"])), &files); err != nil {
		t.Fatal(err)
	}
	settings := asMap(asMap(files["tshock/config.json"])["find"])
	if settings["Settings.ServerPassword"] != "{{server.build.env.SERVER_PASSWORD}}" || settings["Settings.ServerPort"] != "{{server.build.default.port}}" {
		t.Fatal("native settings or assigned port missing")
	}
	startup := str(entry.Egg["startup"])
	installer := str(asMap(asMap(entry.Egg["scripts"])["installation"])["script"])
	if startup != "exec python3 .voltra/tshock_runtime.py" || strings.Contains(startup, "{{SERVER_PASSWORD}}") || !strings.Contains(installer, "'-noupnp'") || !strings.Contains(installer, "DOTNET_ROLL_FORWARD") {
		t.Fatal("keep password in JSON and disable router port forwarding")
	}
}

func TestLegacyTShockKeepsMatchingClientAndRuntime(t *testing.T) {
	var entry gameTemplate
	for _, candidate := range gameTemplates().Entries {
		if candidate.Path == "terraria/tshock/egg-tshock-legacy.json" {
			entry = candidate
			break
		}
	}
	if entry.Profile != "tshock-legacy-4.5.18-v1-exact-release-v1" {
		t.Fatal("reviewed legacy TShock missing")
	}
	_, variables, err := parseEggDocument(entry.Egg)
	if err != nil {
		t.Fatal(err)
	}
	for _, variable := range variables {
		if err := validateEggValue(variable["default_value"], true, str(variable["rules"]), M{}); err != nil {
			t.Fatalf("invalid legacy default: %v", err)
		}
		if str(variable["env_variable"]) == "TSHOCK_VERSION" {
			if str(variable["default_value"]) != "v4.5.18" {
				t.Fatal("legacy version changed")
			}
			for _, version := range []string{"vlatest", "v4.5.18\n", "../release"} {
				if validateEggValue(version, true, str(variable["rules"]), M{}) == nil {
					t.Fatal("legacy recipe accepted unsafe version syntax")
				}
			}
			for _, version := range []string{"v4.5.17", "4.5.18"} {
				if validateEggValue(version, true, str(variable["rules"]), M{}) != nil {
					t.Fatal("legacy exact release syntax rejected")
				}
			}
		}
	}
	assertTerrariaReleaseInstaller(t, entry, "legacy", "TSHOCK_VERSION", "v4.5.18", "9b42687d0aee173c0de041db359679a6437ada67fbc170a37f92a7216f7b726c")
	if str(asMap(entry.Egg["docker_images"])["mono"]) != "ghcr.io/ptero-eggs/yolks:mono_latest" || !strings.HasPrefix(str(entry.Egg["startup"]), "exec mono TerrariaServer.exe ") {
		t.Fatal("legacy executable requires Mono")
	}
	if !strings.Contains(str(entry.Egg["description"]), "1.4.3.6") || len(entry.SetupSteps) == 0 {
		t.Fatal("matching client and setup instructions missing")
	}
}
