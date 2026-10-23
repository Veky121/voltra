package panel

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestTModLoaderReviewedProfile(t *testing.T) {
	var entry gameTemplate
	for _, candidate := range gameTemplates().Entries {
		if candidate.Path == "terraria/tmodloader/egg-t-modloader.json" {
			entry = candidate
			break
		}
	}
	if entry.Profile != "tmodloader-2026.08.3.0-v1" {
		t.Fatal("reviewed tModLoader missing")
	}
	_, variables, err := parseEggDocument(entry.Egg)
	if err != nil {
		t.Fatal(err)
	}
	rules := map[string]string{}
	for _, v := range variables {
		key := str(v["env_variable"])
		rules[key] = str(v["rules"])
		if err := validateEggValue(v["default_value"], true, rules[key], M{}); err != nil {
			t.Fatalf("%s default: %v", key, err)
		}
	}
	for _, sample := range []struct{ key, value string }{{"VERSION", "latest"}, {"VERSION", "v2026.09.0.0"}, {"WORLD_NAME", "../world"}, {"WORLD_NAME", "world;echo bad"}, {"SERVER_PASSWORD", "pass\nport=1"}, {"MOTD", "line\rnext"}, {"MAX_PLAYERS", "0"}, {"MAX_PLAYERS", "256"}, {"LANGUAGE", "1;echo bad"}} {
		if validateEggValue(sample.value, true, rules[sample.key], M{}) == nil {
			t.Fatalf("accepted invalid %s", sample.key)
		}
	}
	if str(asMap(entry.Egg["docker_images"])[".NET 8"]) != "ghcr.io/ptero-eggs/yolks:dotnet_8" {
		t.Fatal("stable tModLoader requires .NET 8")
	}
	for _, sample := range []struct{ key, value string }{{"SERVER_PASSWORD", strings.Repeat("a", 21)}, {"MOTD", strings.Repeat("a", 41)}, {"WORLD_NAME", strings.Repeat("a", 21)}} {
		if validateEggValue(sample.value, true, rules[sample.key], M{}) == nil {
			t.Fatalf("original %s size limit was lost", sample.key)
		}
	}
	startup := str(entry.Egg["startup"])
	if strings.Contains(startup, "{{SERVER_PASSWORD}}") || strings.Contains(startup, "{{MOTD}}") || !strings.Contains(startup, "-modpath /home/container/mods") || !strings.Contains(startup, "-tmlsavedirectory /home/container/saves") {
		t.Fatal("startup must use literal configuration and persistent mod/save paths")
	}
	var files M
	if err := json.Unmarshal([]byte(str(asMap(entry.Egg["config"])["files"])), &files); err != nil {
		t.Fatal(err)
	}
	settings := asMap(asMap(files["serverconfig.txt"])["find"])
	if settings["password"] != "{{server.build.env.SERVER_PASSWORD}}" || settings["world"] != "/home/container/saves/Worlds/{{server.build.env.WORLD_NAME}}.wld" {
		t.Fatal("native configuration mapping missing")
	}
}
