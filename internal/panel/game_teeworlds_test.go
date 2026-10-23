package panel

import (
	"context"
	"os"
	"strings"
	"testing"
)

func TestTeeworldsReviewedSettings(t *testing.T) {
	var entry gameTemplate
	for _, candidate := range gameTemplates().Entries {
		if candidate.Path == "teeworlds/egg-teeworlds.json" {
			entry = candidate
		}
	}
	if entry.Profile != "teeworlds-0.7.5-console-v1" || len(entry.Platforms) != 1 || entry.Platforms[0] != "linux/amd64" {
		t.Fatal("profile or platform missing")
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
	env["SERVER_NAME"] = `literal "; shutdown; " $safe`
	env["SERVER_MOTD"] = `Native \n second line`
	if _, err = a.validateEggEnvironment(ctx, num(imported["id"]), env, false); err != nil {
		t.Fatal(err)
	}
	for _, spec := range []struct{ key, value string }{{"MAX_PLAYERS", "0"}, {"MAX_PLAYERS", "65"}, {"SERVER_MAP", "../map"}, {"SERVER_NAME", "bad\nname"}, {"GAME_TYPE", "unknown"}, {"PUBLIC_SERVER", "true"}, {"SERVER_PASSWORD", strings.Repeat("x", 32)}} {
		invalid := M{}
		for k, v := range env {
			invalid[k] = v
		}
		invalid[spec.key] = spec.value
		if _, err = a.validateEggEnvironment(ctx, num(imported["id"]), invalid, false); err == nil {
			t.Fatalf("invalid %s accepted", spec.key)
		}
	}
	script := str(asMap(asMap(entry.Egg["scripts"])["installation"])["script"])
	for _, name := range []string{"teeworlds-install.py", "teeworlds-runtime.py", "teeworlds-console.cpp.inc"} {
		source, err := os.ReadFile("game_library/scripts/" + name)
		if err != nil || !strings.Contains(script, string(source)) {
			t.Fatal("source mismatch:", name, err)
		}
	}
	config := asMap(entry.Egg["config"])
	if str(config["stop"]) != "shutdown" || !strings.Contains(str(config["startup"]), "Voltra native console ready") || str(config["files"]) != "{}" {
		t.Fatal("native private readiness or graceful stop missing")
	}
}
