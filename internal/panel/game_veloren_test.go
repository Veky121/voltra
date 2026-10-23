package panel

import (
	"context"
	"os"
	"strings"
	"testing"
)

func TestVelorenReviewedSettings(t *testing.T) {
	var entry gameTemplate
	for _, candidate := range gameTemplates().Entries {
		if candidate.Path == "veloren/egg-veloren.json" {
			entry = candidate
			break
		}
	}
	if entry.Profile != "veloren-weekly-c5024ebf-v1" || len(entry.Platforms) != 2 {
		t.Fatal("Veloren profile or native platforms missing")
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
	env["SERVER_NAME"] = `Server, $literal "quoted" 世界`
	if _, err = a.validateEggEnvironment(ctx, num(imported["id"]), env, false); err != nil {
		t.Fatal(err)
	}
	for _, spec := range []struct{ field, value string }{{"VERSION", "unknown"}, {"MAX_PLAYERS", "0"}, {"MAX_PLAYERS", "65536"}, {"AUTH_MODE", "disabled"}, {"METRICS_PORT", "-1"}, {"QUERY_PORT", "65536"}, {"SERVER_NAME", "bad\nname"}, {"MANAGE_NETWORK", "true"}} {
		invalid := M{}
		for key, value := range env {
			invalid[key] = value
		}
		invalid[spec.field] = spec.value
		if _, err = a.validateEggEnvironment(ctx, num(imported["id"]), invalid, false); err == nil {
			t.Fatalf("invalid %s accepted", spec.field)
		}
	}
	for _, version := range []string{"weekly", "nightly"} {
		env["VERSION"] = version
		if _, err = a.validateEggEnvironment(ctx, num(imported["id"]), env, false); err != nil {
			t.Fatal("upstream channel must remain selectable:", version, err)
		}
	}
	script := str(asMap(asMap(entry.Egg["scripts"])["installation"])["script"])
	for _, name := range []string{"veloren-runtime.py", "veloren-install.py", "veloren-builds.json"} {
		source, err := os.ReadFile("game_library/scripts/" + name)
		if err != nil || !strings.Contains(script, string(source)) {
			t.Fatal("installer source mismatch:", name, err)
		}
	}
	if str(entry.Egg["startup"]) != "exec python3 .voltra/veloren-runtime.py" || str(asMap(entry.Egg["config"])["files"]) != "{}" || !strings.Contains(script, "cargo vendor --locked") {
		t.Fatal("native configuration helper, fixed startup or dependency source retention missing")
	}
}
