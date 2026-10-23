package panel

import (
	"context"
	"os"
	"strings"
	"testing"
)

func TestXonoticReviewedSettings(t *testing.T) {
	var entry gameTemplate
	for _, candidate := range gameTemplates().Entries {
		if candidate.Path == "xonotic/egg-xonotic.json" {
			entry = candidate
		}
	}
	if entry.Profile != "xonotic-native-v1" || len(entry.Platforms) != 1 || entry.Platforms[0] != "linux/amd64" {
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
	if env["VERSION"] != "0.8.6" || env["MAX_PLAYERS"] != "16" || env["UPDATE_CHANNEL"] != "release" {
		t.Fatal("original defaults or stable channel missing")
	}
	env["SERVER_NAME"] = `Xonotic +literal $safe "quote";value`
	if _, err = a.validateEggEnvironment(ctx, num(imported["id"]), env, false); err != nil {
		t.Fatal(err)
	}
	for _, spec := range []struct{ key, value string }{{"GAME_MAP", "../map"}, {"MAX_PLAYERS", "100"}, {"MAX_PLAYERS", "0"}, {"GAME_TYPE", "unknown"}, {"PUBLIC_SERVER", "true"}, {"SERVER_NAME", "bad\nname"}, {"SERVER_NAME", `bad\name`}, {"RCON_PASSWORD", "two passwords"}, {"VERSION", "../package"}, {"UPDATE_CHANNEL", "unknown"}, {"BOT_SKILL", "11"}, {"BOT_JOIN_EMPTY", "true"}, {"MIN_PLAYERS_PER_TEAM", "100"}, {"RCON_PASSWORD", strings.Repeat("x", 128)}} {
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
	for _, name := range []string{"native-release.py", "native-zip-release.py", "xonotic-install.py", "xonotic-runtime.py"} {
		source, err := os.ReadFile("game_library/scripts/" + name)
		if err != nil || !strings.Contains(script, string(source)) {
			t.Fatal("source mismatch:", name, err)
		}
	}
	config := asMap(entry.Egg["config"])
	if str(config["stop"]) != "quit" || str(config["files"]) != "{}" || !strings.Contains(str(config["startup"]), "Xonotic native UDP server ready") {
		t.Fatal("native lifecycle missing")
	}
}
