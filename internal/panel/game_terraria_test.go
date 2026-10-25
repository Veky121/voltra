package panel

import (
	"os"
	"strings"
	"testing"
)

func TestTerrariaProfileSettings(t *testing.T) {
	var entry gameTemplate
	for _, candidate := range gameTemplates().Entries {
		if candidate.Path == "terraria/vanilla/egg-terraria-vanilla.json" {
			entry = candidate
			break
		}
	}
	if entry.Profile != "terraria-1.4.5.8-v2-exact-release-v1" {
		t.Fatal("reviewed Terraria profile missing")
	}
	summary := templateSummary(entry)
	detail := str(summary["detail"])
	if str(summary["verification"]) != "runtime_failed" || !strings.Contains(detail, "pre-join") || !strings.Contains(detail, "disconnect") || !strings.Contains(detail, "does not establish a fix") || !boolean(summary["available"]) {
		t.Fatal("catalog must distinguish import availability from the observed runtime failure")
	}
	if str(entry.Egg["startup"]) != "exec /bin/bash /home/container/TerrariaServer -config serverconfig.txt -noupnp" {
		t.Fatal("vanilla startup must retain the reviewed publisher launcher environment and directory setup")
	}
	_, variables, err := parseEggDocument(entry.Egg)
	if err != nil {
		t.Fatal(err)
	}
	rules := map[string]string{}
	for _, variable := range variables {
		key := str(variable["env_variable"])
		rules[key] = str(variable["rules"])
		if err := validateEggValue(variable["default_value"], true, rules[key], M{}); err != nil {
			t.Fatalf("%s default: %v", key, err)
		}
	}
	for _, sample := range []struct{ key, value string }{
		{"WORLD_NAME", "../another-world"}, {"WORLD_NAME", "World\nport=1"},
		{"PASSWORD", "secret\nmaxplayers=255"}, {"SERVER_MOTD", "hello\rworld"},
		{"WORLD_SEED", "seed\nworld=/tmp/world"}, {"MAX_PLAYERS", "0"},
		{"MAX_PLAYERS", "256"}, {"MAX_PLAYERS", "1.5"}, {"TERRARIA_VERSION", "1.4.4.9\n"},
	} {
		if err := validateEggValue(sample.value, true, rules[sample.key], M{}); err == nil {
			t.Fatalf("accepted unsafe %s value", sample.key)
		}
	}
	for _, sample := range []struct{ key, value string }{{"WORLD_NAME", "My_World-2"}, {"PASSWORD", "literal'\"$()=value"}, {"SERVER_MOTD", "Welcome, friends!"}, {"MAX_PLAYERS", "255"}, {"TERRARIA_VERSION", "latest"}, {"TERRARIA_VERSION", "1.4.4.9"}, {"TERRARIA_VERSION", "1449"}} {
		if err := validateEggValue(sample.value, true, rules[sample.key], M{}); err != nil {
			t.Fatalf("rejected valid %s: %v", sample.key, err)
		}
	}
	startup := str(entry.Egg["startup"])
	if !strings.Contains(startup, "-noupnp") || strings.Contains(startup, "{{PASSWORD}}") {
		t.Fatal("startup must keep password in configuration and disable router port forwarding")
	}
	assertTerrariaReleaseInstaller(t, entry, "vanilla", "TERRARIA_VERSION", "1.4.5.8", "f513a4ac9789d34af766291ae217c9cd7d9472e13782a0e2b17512f70d7a8334")
}

// The embedded installer must be the actual independently tested release helper,
// while each profile retains its own pinned default, runtime and native controls.
func assertTerrariaReleaseInstaller(t *testing.T, entry gameTemplate, kind, versionKey, defaultVersion, pin string) {
	t.Helper()
	source, err := os.ReadFile("game_library/scripts/terraria-release-install.py")
	if err != nil {
		t.Fatal(err)
	}
	installation := asMap(asMap(entry.Egg["scripts"])["installation"])
	if str(installation["container"]) != "alpine:3.22" || str(installation["entrypoint"]) != "ash" || !strings.Contains(str(installation["script"]), string(source)) || !strings.Contains(string(source), pin) {
		t.Fatal("actual release helper or independently reviewed default checksum missing from profile")
	}
	_, variables, err := parseEggDocument(entry.Egg)
	if err != nil {
		t.Fatal(err)
	}
	counts := map[string]int{}
	for _, variable := range variables {
		key := str(variable["env_variable"])
		counts[key]++
		if key == versionKey && str(variable["default_value"]) != defaultVersion {
			t.Fatal("reviewed default changed")
		}
		if key == "VOLTRA_TERRARIA_KIND" && (str(variable["default_value"]) != kind || boolean(variable["user_editable"]) || boolean(variable["user_viewable"])) {
			t.Fatal("fixed recipe/runtime family became user-selectable")
		}
		if key == "RELEASE_SHA256" {
			for _, invalid := range []string{"abc", strings.Repeat("a", 64) + "\n", strings.Repeat("g", 64)} {
				if validateEggValue(invalid, true, str(variable["rules"]), M{}) == nil {
					t.Fatal("invalid optional SHA256 accepted")
				}
			}
			if validateEggValue(strings.Repeat("a", 64), true, str(variable["rules"]), M{}) != nil {
				t.Fatal("valid independently supplied checksum rejected")
			}
		}
	}
	for _, key := range []string{versionKey, "VOLTRA_TERRARIA_KIND", "RELEASE_SHA256"} {
		if counts[key] != 1 {
			t.Fatalf("missing/duplicated %s control", key)
		}
	}
	if !strings.Contains(strings.Join(entry.SetupSteps, " "), "native runtime verification applies only") {
		t.Fatal("new release selection must not inherit native verification for every version")
	}
}
