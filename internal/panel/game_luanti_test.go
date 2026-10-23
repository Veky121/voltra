package panel

import (
	"context"
	"os"
	"strings"
	"testing"
)

func TestLuantiReviewedSettings(t *testing.T) {
	var entry gameTemplate
	for _, candidate := range gameTemplates().Entries {
		if candidate.Path == "minetest/egg-minetest.json" {
			entry = candidate
			break
		}
	}
	if entry.Profile != "luanti-5.17.0-v1" || len(entry.Platforms) != 1 || entry.Platforms[0] != "linux/amd64" {
		t.Fatal("reviewed Luanti platform/profile missing")
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
	for _, variable := range variables {
		env[str(variable["env_variable"])] = variable["default_value"]
	}
	if _, err = a.validateEggEnvironment(ctx, num(imported["id"]), env, false); err != nil {
		t.Fatal("defaults:", err)
	}
	env["SERVER_NAME"] = `World, $literal "quoted" 世界`
	env["SERVER_PASSWORD"] = `12345#$literal=kept`
	if _, err = a.validateEggEnvironment(ctx, num(imported["id"]), env, false); err != nil {
		t.Fatal("literal settings:", err)
	}
	for _, spec := range []struct{ field, value string }{
		{"SERVER_NAME", "injected\nserver_announce = true"}, {"SERVER_PASSWORD", `"""`},
		{"SERVER_PASSWORD", "{"}, {"SERVER_PASSWORD", " secret"}, {"SERVER_PASSWORD", "secret "},
		{"WORLD_NAME", "../old"}, {"DEFAULT_GAME", "/tmp/escape"},
		{"SERVER_MAX_USERS", "0"}, {"SERVER_ANNOUNCE", "1"}, {"COMMUNITY_GAME_RELEASE", "-1"},
		{"COMMUNITY_GAME_AUTOR", "bad/author"}, {"SERVER_ADMIN_NAME", "bad admin"},
		{"COMMUNITY_GAME_AUTOR", ""}, {"COMMUNITY_GAME_NAME", ""},
	} {
		invalid := M{}
		for key, value := range env {
			invalid[key] = value
		}
		invalid[spec.field] = spec.value
		if _, err = a.validateEggEnvironment(ctx, num(imported["id"]), invalid, false); err == nil {
			t.Fatalf("invalid %s accepted", spec.field)
		}
	}
	env["COMMUNITY_DOWNLOAD"] = "0"
	env["COMMUNITY_GAME_NAME"] = ""
	env["COMMUNITY_GAME_AUTOR"] = ""
	if _, err = a.validateEggEnvironment(ctx, num(imported["id"]), env, false); err != nil {
		t.Fatal("manual upload mode:", err)
	}
	script := str(asMap(asMap(entry.Egg["scripts"])["installation"])["script"])
	for _, name := range []string{"luanti-runtime.py", "luanti-game-install.py", "luanti-admin.lua", "luanti-plain-console.cpp.inc", "luanti-patch-console.py"} {
		source, err := os.ReadFile("game_library/scripts/" + name)
		if err != nil || !strings.Contains(script, string(source)) {
			t.Fatal("installer helper mismatch:", name, err)
		}
	}
	if str(entry.Egg["startup"]) != "exec python3 .voltra/luanti-runtime.py" || str(asMap(entry.Egg["config"])["files"]) != "{}" {
		t.Fatal("native settings must not be interpolated into shell arguments or parser templates")
	}
	if !strings.Contains(script, "libjsoncpp.so.25") || !strings.Contains(script, "JsonCpp-copyright") {
		t.Fatal("runtime JSON library and its license must accompany the engine")
	}
}
