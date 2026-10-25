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
		{"factorio/factorio/egg-factorio.json", "factorio-version-choice-v2"},
		{"factorio/factorio-modupdate/egg-factorio-modupdate.json", "factorio-modupdate-version-choice-v2"},
		{"factorio/factorio/egg-factorio-a-r-m64.json", "factorio-arm64-version-choice-v2"},
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
	source, err := os.ReadFile("game_library/scripts/factorio-install.py")
	if err != nil {
		t.Fatal(err)
	}
	script := str(asMap(asMap(entry.Egg["scripts"])["installation"])["script"])
	if !strings.Contains(script, string(source)) || !strings.Contains(script, "Voltra-Factorio-Installer/1.0") || !strings.Contains(script, "c4efc11529f74d37c96933e291e0db73fd9f5aa4738913d9301b24680b3e947f") {
		t.Fatal("version-choice installer must embed exact audited source and retain reviewed archive pin")
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
	if env["FACTORIO_VERSION"] != "2.0.77" {
		t.Fatal("reviewed default version changed")
	}
	for _, version := range []string{"2.0.77", "2.1.23", "0.17.79", "latest", "stable", "experimental"} {
		env["FACTORIO_VERSION"] = version
		if _, err := a.validateEggEnvironment(context.Background(), num(imported["id"]), env, false); err != nil {
			t.Fatalf("valid version syntax %q: %v", version, err)
		}
	}
	for _, version := range []string{"arbitrary", "2.0.77\n", "2.0", "02.0.77", "STABLE", "2.0.77;id"} {
		env["FACTORIO_VERSION"] = version
		if _, err := a.validateEggEnvironment(context.Background(), num(imported["id"]), env, false); err == nil {
			t.Fatalf("invalid version syntax accepted: %q", version)
		}
	}
	env["FACTORIO_VERSION"] = "2.0.77"
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
