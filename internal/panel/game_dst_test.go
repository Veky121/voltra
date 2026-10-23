package panel

import (
	"context"
	"os"
	"strings"
	"testing"
)

func TestDSTReviewedSettings(t *testing.T) {
	var entry gameTemplate
	for _, candidate := range gameTemplates().Entries {
		if candidate.Path == "dont_starve/egg-don-t-starve-together.json" {
			entry = candidate
		}
	}
	if entry.Profile != "dst-native-v1" || entry.RequiredPorts != 6 {
		t.Fatal("dual-shard requirements missing")
	}
	a, _, _, _, _ := steamGamesFixture(t)
	egg, variables, err := parseEggDocument(entry.Egg)
	if err != nil {
		t.Fatal(err)
	}
	imported, err := a.ensureGameTemplateEgg(context.Background(), entry, egg, variables)
	if err != nil {
		t.Fatal(err)
	}
	env := M{}
	for _, variable := range variables {
		env[str(variable["env_variable"])] = variable["default_value"]
	}
	if env["SRCDS_APPID"] != "343050" || env["AUTO_UPDATE"] != "0" || env["CLUSTER_ID"] != "server" || env["MASTER_WORLDGEN"] == "" || env["CAVES_WORLDGEN"] == "" {
		t.Fatal("original defaults missing")
	}
	if _, err = a.validateEggEnvironment(context.Background(), num(imported["id"]), env, false); err == nil {
		t.Fatal("online cluster without token accepted")
	}
	env["ONLINE_MODE"] = "0"
	if _, err = a.validateEggEnvironment(context.Background(), num(imported["id"]), env, false); err != nil {
		t.Fatal("offline configuration rejected:", err)
	}
	for _, spec := range []struct{ key, value string }{{"CLUSTER_ID", "../world"}, {"CLUSTER_NAME", "bad\n[SHARD]"}, {"SRCDS_APPID", "343051"}, {"MAX_PLAYERS", "32"}, {"AUTO_UPDATE", "true"}, {"CLUSTER_PASSWORD", "bad\nvalue"}} {
		invalid := M{}
		for key, value := range env {
			invalid[key] = value
		}
		invalid[spec.key] = spec.value
		if _, err := a.validateEggEnvironment(context.Background(), num(imported["id"]), invalid, false); err == nil {
			t.Fatal("invalid setting accepted:", spec.key)
		}
	}
	script := str(asMap(asMap(entry.Egg["scripts"])["installation"])["script"])
	for _, name := range []string{"native-config.py", "native-shards.py", "dst-config.py", "dst-install.py", "dst-runtime.py", "dst-worldgen-master.lua", "dst-worldgen-caves.lua"} {
		content, err := os.ReadFile("game_library/scripts/" + name)
		if err != nil || !strings.Contains(script, string(content)) {
			t.Fatal("installer source mismatch", name, err)
		}
	}
	primary := M{"ip": "192.0.2.1", "port": 23560}
	additional := []M{}
	for port := 23561; port <= 23565; port++ {
		additional = append(additional, M{"ip": "192.0.2.1", "port": port})
	}
	if err := validateTemplatePortLayout(entry, primary, additional); err != nil {
		t.Fatal(err)
	}
	if err := validateTemplatePortLayout(entry, primary, additional[:4]); err == nil {
		t.Fatal("missing shard port accepted")
	}
	if len(entry.PortRules) != 1 {
		t.Fatal("offline LAN requirements missing")
	}
	if err := validateTemplatePortRules(entry, M{"ONLINE_MODE": "0"}, primary, additional); err == nil {
		t.Fatal("out-of-range offline gameplay ports accepted")
	}
	if err := validateTemplatePortRules(entry, M{"ONLINE_MODE": "1"}, primary, additional); err != nil {
		t.Fatal("online mode incorrectly limited:", err)
	}
	lanPrimary := M{"ip": "192.0.2.1", "port": 10998}
	lanAdditional := append([]M{{"ip": "192.0.2.1", "port": 10999}}, additional[:4]...)
	if err := validateTemplatePortRules(entry, M{"ONLINE_MODE": "0"}, lanPrimary, lanAdditional); err != nil {
		t.Fatal(err)
	}
	if err := validateTemplatePortRules(entry, M{"ONLINE_MODE": "0"}, lanPrimary, additional); err == nil {
		t.Fatal("missing cave LAN port accepted")
	}
}
