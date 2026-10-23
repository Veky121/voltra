package panel

import (
	"context"
	"os"
	"strings"
	"testing"
)

func TestFactorioUpdaterEmbeddedSource(t *testing.T) {
	source, err := os.ReadFile("game_library/scripts/factorio-update-mods.sh")
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range gameTemplates().Entries {
		if entry.Path == "factorio/factorio-modupdate/egg-factorio-modupdate.json" {
			script := str(asMap(asMap(entry.Egg["scripts"])["installation"])["script"])
			if !strings.Contains(script, string(source)) {
				t.Fatal("installer differs from audited updater; run node tools/runtime/sync-factorio-updater.mjs")
			}
			return
		}
	}
	t.Fatal("ModUpdate recipe missing")
}

func TestFactorioReviewedSettings(t *testing.T) {
	for _, spec := range []struct{ path, profile string }{
		{"factorio/factorio/egg-factorio.json", "factorio-2.0.77-v1"},
		{"factorio/factorio-modupdate/egg-factorio-modupdate.json", "factorio-modupdate-2.0.77-v1"},
		{"factorio/factorio/egg-factorio-a-r-m64.json", "factorio-arm64-2.0.77-v1"},
	} {
		t.Run(spec.path, func(t *testing.T) { testFactorioReviewedSettings(t, spec.path, spec.profile) })
	}
}

func testFactorioReviewedSettings(t *testing.T, path, profile string) {
	var entry gameTemplate
	for _, candidate := range gameTemplates().Entries {
		if candidate.Path == path {
			entry = candidate
			break
		}
	}
	if entry.Profile != profile {
		t.Fatal("reviewed Factorio missing")
	}
	egg, variables, err := parseEggDocument(entry.Egg)
	if err != nil {
		t.Fatal(err)
	}
	a, _, _ := infraTestApp(t)
	imported, err := a.ensureGameTemplateEgg(context.Background(), entry, egg, variables)
	if err != nil {
		t.Fatal(err)
	}
	env := M{}
	for _, v := range variables {
		env[str(v["env_variable"])] = v["default_value"]
	}
	env["GAME_PASSWORD"] = "001234"
	env["SERVER_NAME"] = "Factory $(literal) \"quoted\""
	values, err := a.validateEggEnvironment(context.Background(), num(imported["id"]), env, false)
	if err != nil {
		t.Fatal(err)
	}
	if values["GAME_PASSWORD"] != "001234" {
		t.Fatal("numeric-looking password lost text")
	}
	env["PUBLIC_SERVER"] = "1"
	if _, err := a.validateEggEnvironment(context.Background(), num(imported["id"]), env, false); err == nil {
		t.Fatal("public listing accepted missing credentials")
	}
	env["SERVER_USERNAME"] = "account"
	env["SERVER_TOKEN"] = "testtoken"
	if _, err := a.validateEggEnvironment(context.Background(), num(imported["id"]), env, false); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"../save", "$(touch bad)", "name/other", ""} {
		env["SAVE_NAME"] = name
		if _, err := a.validateEggEnvironment(context.Background(), num(imported["id"]), env, false); err == nil {
			t.Fatal("unsafe save name accepted")
		}
	}
	startup := str(entry.Egg["startup"])
	if strings.Contains(startup, "{{SERVER_TOKEN}}") || strings.Contains(startup, "{{GAME_PASSWORD}}") {
		t.Fatal("secrets must stay out of startup arguments")
	}
}
