package panel

import (
	"strings"
	"testing"
)

func TestConsoleInputCapabilityPreservesCustomLaunchers(t *testing.T) {
	checked := 0
	for _, entry := range gameTemplates().Entries {
		switch entry.Path {
		case "core_keeper/egg-core-keeper.json", "valheim/valheim_vanilla/egg-valheim.json", "valheim/valheim_bepinex/egg-valheim-bep-i-nex.json", "valheim/valheim_plus/egg-valheim-plus-mod.json":
		default:
			continue
		}
		t.Run(entry.Path, func(t *testing.T) {
			egg := M{"uuid": gameTemplateEggUUID(entry), "startup": entry.Egg["startup"]}
			server := M{"startup": entry.Egg["startup"]}
			helper := ".voltra/valheim_runtime.py"
			if entry.Path == "core_keeper/egg-core-keeper.json" {
				helper = ".voltra/core_keeper_runtime.py"
			}
			body := strings.ReplaceAll(string(wave46CanonicalHelpers(t, entry.Path)[helper]), " ", "")
			if !strings.Contains(body, "stdin=subprocess.DEVNULL") {
				t.Fatal("log-only classification no longer matches emitted native launcher")
			}
			if serverConsoleInputSupported(server, egg) {
				t.Fatal("reviewed log-only launcher advertises commands")
			}
			server["startup"] = "exec custom-admin-bridge"
			if !serverConsoleInputSupported(server, egg) {
				t.Fatal("custom server launcher lost commands")
			}
			server["startup"] = entry.Egg["startup"]
			egg["startup"] = "exec custom-admin-bridge"
			if !serverConsoleInputSupported(server, egg) {
				t.Fatal("custom egg launcher lost commands")
			}
		})
		checked++
	}
	if checked != 4 {
		t.Fatalf("reviewed catalog coverage: %d", checked)
	}
	if !serverConsoleInputSupported(M{}, M{"name": "Valheim"}) {
		t.Fatal("unknown egg inferred by name")
	}
}
