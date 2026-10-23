package panel

import (
	"context"
	"os"
	"strings"
	"testing"
)

func TestVintageStoryReviewedSettings(t *testing.T) {
	var entry gameTemplate
	for _, candidate := range gameTemplates().Entries {
		if candidate.Path == "vintage_story/egg-vintage-story.json" {
			entry = candidate
		}
	}
	if entry.Profile != "vintage-story-1.22.7-v1" || len(entry.Platforms) != 1 || entry.Platforms[0] != "linux/amd64" {
		t.Fatal("reviewed profile or platform missing")
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
	if env["RELEASE_VERSION"] != "1.22.7" {
		t.Fatal("default build drifted")
	}
	for _, version := range []string{"1.22.7", "latest", "1.23.0-pre.1"} {
		env["RELEASE_VERSION"] = version
		if _, err = a.validateEggEnvironment(ctx, num(imported["id"]), env, false); err != nil {
			t.Fatal(err)
		}
	}
	for _, invalid := range []struct{ key, value string }{{"MAX_CLIENTS", "0"}, {"MAX_CLIENTS", "257"}, {"RELEASE_VERSION", "../escape"}, {"OPTIONS", "bad\nflag"}} {
		copy := M{}
		for k, v := range env {
			copy[k] = v
		}
		copy[invalid.key] = invalid.value
		if _, err = a.validateEggEnvironment(ctx, num(imported["id"]), copy, false); err == nil {
			t.Fatalf("invalid %s accepted", invalid.key)
		}
	}
	for _, key := range []string{"OPTIONS", "FILES_BRANCH", "RELEASE_VERSION", "MAX_CLIENTS", "SQLITE_TMPDIR"} {
		if _, ok := env[key]; !ok {
			t.Fatal("original control removed:", key)
		}
	}
	script := str(asMap(asMap(entry.Egg["scripts"])["installation"])["script"])
	for _, name := range []string{"vintage-story-install.py", "vintage-story-runtime.py"} {
		source, err := os.ReadFile("game_library/scripts/" + name)
		if err != nil || !strings.Contains(script, string(source)) {
			t.Fatal("installer source mismatch:", name, err)
		}
	}
	if str(entry.Egg["startup"]) != "exec python3 .voltra/vintage-story-runtime.py" || str(asMap(entry.Egg["config"])["stop"]) != "/stop" {
		t.Fatal("native launch or stop missing")
	}
}
