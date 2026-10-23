package panel

import (
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
	if entry.Profile != "terraria-1.4.5.8-v2" {
		t.Fatal("reviewed Terraria profile missing")
	}
	summary := templateSummary(entry)
	if str(summary["verification"]) != "runtime_failed" || !strings.Contains(str(summary["detail"]), "disconnects") || !boolean(summary["available"]) {
		t.Fatal("catalog must distinguish import availability from the observed runtime failure")
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
		{"MAX_PLAYERS", "256"}, {"MAX_PLAYERS", "1.5"}, {"TERRARIA_VERSION", "latest"},
	} {
		if err := validateEggValue(sample.value, true, rules[sample.key], M{}); err == nil {
			t.Fatalf("accepted unsafe %s value", sample.key)
		}
	}
	for _, sample := range []struct{ key, value string }{{"WORLD_NAME", "My_World-2"}, {"PASSWORD", "literal'\"$()=value"}, {"SERVER_MOTD", "Welcome, friends!"}, {"MAX_PLAYERS", "255"}} {
		if err := validateEggValue(sample.value, true, rules[sample.key], M{}); err != nil {
			t.Fatalf("rejected valid %s: %v", sample.key, err)
		}
	}
	startup := str(entry.Egg["startup"])
	if !strings.Contains(startup, "-noupnp") || strings.Contains(startup, "{{PASSWORD}}") {
		t.Fatal("startup must keep password in configuration and disable router port forwarding")
	}
}
