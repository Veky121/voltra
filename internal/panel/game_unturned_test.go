package panel

import (
	"context"
	"os"
	"strings"
	"testing"
)

func TestUnturnedReviewedSettings(t *testing.T) {
	var entry gameTemplate
	for _, candidate := range gameTemplates().Entries {
		if candidate.Path == "unturned/egg-unturned.json" {
			entry = candidate
		}
	}
	if entry.Profile != "unturned-native-v1" || entry.RequiredPorts != 2 || !entry.ConsecutivePorts {
		t.Fatal("native port requirements missing")
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
	if env["SRCDS_APPID"] != "1110390" || env["AUTO_UPDATE"] != "1" || env["PUBLIC_SERVER"] != "0" || env["LD_LIBRARY_PATH"] != "./Unturned_Headless_Data/Plugins/x86_64/" {
		t.Fatal("original defaults or LAN mode missing")
	}
	if _, err := a.validateEggEnvironment(context.Background(), num(imported["id"]), env, false); err != nil {
		t.Fatal("LAN without token rejected:", err)
	}
	for _, spec := range []struct{ key, value string }{{"PUBLIC_SERVER", "1"}, {"SRV_ID", "../world"}, {"SRCDS_APPID", "304930"}, {"GSLT", "bad token"}, {"SRV_PW", "bad\npassword"}, {"GAME_MAP", "../PEI"}, {"DIFFICULTY", "Impossible"}, {"MAX_PLAYERS", "49"}, {"AUTOSAVE_SECONDS", "-1"}} {
		invalid := M{}
		for key, value := range env {
			invalid[key] = value
		}
		invalid[spec.key] = spec.value
		if _, err := a.validateEggEnvironment(context.Background(), num(imported["id"]), invalid, false); err == nil {
			t.Fatalf("invalid %s accepted", spec.key)
		}
	}
	script := str(asMap(asMap(entry.Egg["scripts"])["installation"])["script"])
	for _, source := range []string{"steam-template.py", "bundle-debian-python.py", "native-console.py", "unturned-runtime.py"} {
		content, err := os.ReadFile("game_library/scripts/" + source)
		if err != nil || !strings.Contains(script, string(content)) {
			t.Fatal("embedded installer source mismatch", source, err)
		}
	}
	if !strings.Contains(script, "Extras/Rocket.Unturned") || !strings.Contains(script, "VOLTRA_GAME_LIBRARY_PATH") {
		t.Fatal("original module or library support missing")
	}
}
