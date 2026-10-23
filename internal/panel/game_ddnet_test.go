package panel

import (
	"context"
	"os"
	"strings"
	"testing"
)

func TestDDNetReviewedSettings(t *testing.T) {
	var entry gameTemplate
	for _, candidate := range gameTemplates().Entries {
		if candidate.Path == "ddnet/egg-d-d-net.json" {
			entry = candidate
		}
	}
	if entry.Profile != "ddnet-20.1.1-native-v1" || len(entry.Platforms) != 1 || entry.Platforms[0] != "linux/amd64" {
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
	if env["RELEASE_VERSION"] != "20.1.1" || env["SERVER_MAP"] != "Sunny Side Up" {
		t.Fatal("pinned defaults changed")
	}
	env["SERVER_NAME"] = `DDNet, literal "; shutdown; " $safe`
	for _, maximum := range []string{"1", "64", "128"} {
		env["MAX_PLAYERS"] = maximum
		if _, err = a.validateEggEnvironment(ctx, num(imported["id"]), env, false); err != nil {
			t.Fatal("native setup should not need Steam credentials:", err)
		}
	}
	for _, spec := range []struct{ key, value string }{{"MAX_PLAYERS", "129"}, {"MAX_PLAYERS", "0"}, {"SERVER_NAME", "bad\nname"}, {"RELEASE_VERSION", "../escape"}, {"AUTO_UPDATE", "true"}, {"SIXUP", "2"}, {"SERVER_PASS", strings.Repeat("x", 256)}} {
		invalid := M{}
		for k, v := range env {
			invalid[k] = v
		}
		invalid[spec.key] = spec.value
		if _, err = a.validateEggEnvironment(ctx, num(imported["id"]), invalid, false); err == nil {
			t.Fatalf("invalid %s accepted", spec.key)
		}
	}
	for _, key := range []string{"AUTO_UPDATE", "SRCDS_APPID", "STEAM_USER", "STEAM_PASS", "SERVER_NAME", "SERVER_PASS", "SERVER_MAP", "PUBLIC_SERVER", "MAX_PLAYERS"} {
		if _, ok := env[key]; !ok {
			t.Fatal("original field removed:", key)
		}
	}
	script := str(asMap(asMap(entry.Egg["scripts"])["installation"])["script"])
	for _, name := range []string{"native-release.py", "ddnet-install.py", "ddnet-runtime.py"} {
		source, err := os.ReadFile("game_library/scripts/" + name)
		if err != nil || !strings.Contains(script, string(source)) {
			t.Fatal("installed source mismatch:", name, err)
		}
	}
	config := asMap(entry.Egg["config"])
	if str(config["stop"]) != "shutdown" || str(config["files"]) != "{}" || !strings.Contains(str(config["startup"]), "Voltra DDNet console ready") {
		t.Fatal("native console lifecycle missing")
	}
}
