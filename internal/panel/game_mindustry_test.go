package panel

import (
	"context"
	"os"
	"strings"
	"testing"
)

func TestMindustryReviewedSettings(t *testing.T) {
	var entry gameTemplate
	for _, candidate := range gameTemplates().Entries {
		if candidate.Path == "mindustry/egg-mindustry.json" {
			entry = candidate
			break
		}
	}
	if entry.Profile != "mindustry-v160.7-v1" {
		t.Fatal("reviewed Mindustry missing")
	}
	egg, variables, err := parseEggDocument(entry.Egg)
	if err != nil {
		t.Fatal(err)
	}
	a, _, _ := infraTestApp(t)
	ctx := context.Background()
	imported, err := a.ensureGameTemplateEgg(ctx, entry, egg, variables)
	if err != nil {
		t.Fatal(err)
	}
	env := M{}
	for _, v := range variables {
		env[str(v["env_variable"])] = v["default_value"]
	}
	env["SERVER_NAME"] = "Factory, $(literal) \"quoted\" 世界"
	env["MAX_PLAYERS"] = "0"
	if _, err = a.validateEggEnvironment(ctx, num(imported["id"]), env, false); err != nil {
		t.Fatal(err)
	}
	for _, spec := range []struct {
		field string
		value any
	}{{"VERSION", "v1"}, {"SAVE_NAME", "../old"}, {"GAMEMODE", "unknown"}, {"MAX_PLAYERS", "-1"}, {"AUTOSAVE_SECONDS", "29"}, {"AUTO_PAUSE", "true"}} {
		invalid := M{}
		for k, v := range env {
			invalid[k] = v
		}
		invalid[spec.field] = spec.value
		if _, err = a.validateEggEnvironment(ctx, num(imported["id"]), invalid, false); err == nil {
			t.Fatalf("invalid %s accepted", spec.field)
		}
	}
	source, err := os.ReadFile("game_library/scripts/VoltraMindustry.java")
	if err != nil {
		t.Fatal(err)
	}
	script := str(asMap(asMap(entry.Egg["scripts"])["installation"])["script"])
	if !strings.Contains(script, string(source)) {
		t.Fatal("Mindustry launcher source differs from installer")
	}
	license, err := os.ReadFile("game_library/scripts/Mindustry-LICENSE")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(script, string(license)) || !strings.Contains(script, ".voltra/Mindustry-LICENSE") {
		t.Fatal("Mindustry launcher license must be installed with its source")
	}
	if strings.Contains(str(entry.Egg["startup"]), "{{SERVER_NAME}}") || strings.Contains(str(entry.Egg["startup"]), "{{MAPNAME}}") {
		t.Fatal("settings must not be interpolated as server commands")
	}
}
