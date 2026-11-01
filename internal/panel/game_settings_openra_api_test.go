package panel

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func TestOpenRAActualSettingsAPI(t *testing.T) {
	for _, recipe := range []string{openraSettingsRecipe, "openra/openra_dune2000/egg-open-r-a--dune2000.json", "openra/openra_tiberian_dawn/egg-open-r-a--tiberian-dawn.json"} {
		t.Run(recipe, func(t *testing.T) {
			a, mux, admin, server, fixture := quickSetupMinecraftFixture(t)
			egg := batchSettingsRecipeFixture(t, recipe)
			if _, err := a.update(context.Background(), "eggs", num(server["egg_id"]), egg); err != nil {
				t.Fatal(err)
			}
			if _, err := a.update(context.Background(), "servers", num(server["id"]), M{"startup": egg["startup"]}); err != nil {
				t.Fatal(err)
			}
			original := "\ufeff# operator\r\nServer:\r\n\tEnableVoteKick: false # retained\r\n\tFloodLimitInterval: 2500\r\n\tPassword: fixture-private-pass\r\n\tListenPort: 29100\r\n\tUnknown:\r\n\t\tToken: fixture-private-nested\r\n"
			fixture.mu.Lock()
			delete(fixture.Files, "/server.properties")
			fixture.Files[openraSettingsPath], fixture.State = []byte(original), "offline"
			fixture.mu.Unlock()
			route := "/api/client/servers/" + str(server["uuid_short"]) + "/game-settings"
			view := asMap(infraExpect(t, mux, admin, "GET", route, nil, 200)["attributes"])
			if view["file"] != openraSettingsPath || laneGameSettingsField(view, "Server.EnableVoteKick")["type"] != "boolean" || laneGameSettingsField(view, "Server.FloodLimitInterval")["type"] != "number" {
				t.Fatal("Exact MiniYaml document/dispatch missing", view)
			}
			encoded, _ := json.Marshal(view)
			if strings.Contains(string(encoded), "fixture-private-") {
				t.Fatal("Opaque credential leaked")
			}
			infraExpect(t, mux, admin, "GET", route+"?file=/Other/settings.yaml", nil, 404)
			for key, value := range (M{"Server.Password": "changed", "Server.ListenPort": "29101", "Server.EnableVoteKick": "True\nServer: injected", "Server.FloodLimitInterval": "2147483648"}) {
				infraExpect(t, mux, admin, "PUT", route, M{"revision": view["revision"], "settings": M{key: value}}, 422)
			}
			infraExpect(t, mux, admin, "PUT", route, M{"revision": view["revision"], "settings": M{"Server.EnableVoteKick": true, "Server.FloodLimitInterval": "3000"}}, 200)
			fixture.mu.Lock()
			after := string(fixture.Files[openraSettingsPath])
			fixture.mu.Unlock()
			want := strings.Replace(strings.Replace(original, "false # retained", "True # retained", 1), "2500", "3000", 1)
			if after != want {
				t.Fatal("Opaque/comment/line-ending bytes changed", after)
			}
			infraExpect(t, mux, admin, "PUT", route, M{"revision": view["revision"], "settings": M{"Server.EnableVoteKick": false}}, 409)
			fixture.mu.Lock()
			fixture.Files[openraSettingsPath] = []byte("Server:\n\tEnableVoteKick: True\n\tEnableVoteKick: False\n")
			fixture.mu.Unlock()
			infraExpect(t, mux, admin, "GET", route, nil, 422)
		})
	}
}

func TestOpenRAAndETLegacyExactFormatScope(t *testing.T) {
	for _, test := range []struct{ recipe, file, format string }{{openraSettingsRecipe, openraSettingsPath, "openra"}, {"openra/openra_dune2000/egg-open-r-a--dune2000.json", openraSettingsPath, "openra"}, {"openra/openra_tiberian_dawn/egg-open-r-a--tiberian-dawn.json", openraSettingsPath, "openra"}, {etlegacySettingsRecipe, etlegacySettingsPath, "source"}} {
		egg := batchSettingsRecipeFixture(t, test.recipe)
		if gameSettingsDiscoveryFormat(egg, test.file) != test.format {
			t.Fatal("Exact format missing", test.recipe)
		}
		other := batchSettingsRecipeFixture(t, "counter_strike/counter_strike_source/egg-counter--strike--source.json")
		if gameSettingsDiscoveryFormat(other, test.file) == test.format {
			t.Fatal("Format escaped recipe identity", test.recipe)
		}
		if openraSettingsStartup(egg) != "" {
			egg["startup"] = "exec OpenRA.Server"
			if gameSettingsDiscoveryFormat(egg, test.file) != "" || len(gameSettingsDeclaredDocuments(egg)) != 0 {
				t.Fatal("Old launcher exposed MiniYaml")
			}
			if _, err := parseGameSettingsForEgg(egg, test.file, []byte("Server:\n\tEnableVoteKick: True\n")); err == nil {
				t.Fatal("Old launcher reached generic YAML")
			}
		}
		if test.recipe == etlegacySettingsRecipe {
			egg["startup"] = "exec .voltra/quake_family_runtime.py etlegacy"
			if gameSettingsDiscoveryFormat(egg, test.file) != "" || len(gameSettingsDeclaredDocuments(egg)) != 0 {
				t.Fatal("Old ET launcher exposed authority document")
			}
			if _, err := parseGameSettingsForEgg(egg, test.file, []byte("set g_friendlyfire 1\n")); err == nil {
				t.Fatal("Old ET launcher reached generic INI")
			}
		}
	}
}

func TestOpenRAAndETLegacyOldLauncherActualAPI(t *testing.T) {
	for _, test := range []struct{ recipe, file string }{{openraSettingsRecipe, openraSettingsPath}, {"openra/openra_dune2000/egg-open-r-a--dune2000.json", openraSettingsPath}, {"openra/openra_tiberian_dawn/egg-open-r-a--tiberian-dawn.json", openraSettingsPath}, {etlegacySettingsRecipe, etlegacySettingsPath}} {
		t.Run(test.recipe, func(t *testing.T) {
			a, mux, admin, server, fixture := quickSetupMinecraftFixture(t)
			egg := batchSettingsRecipeFixture(t, test.recipe)
			egg["startup"] = "exec legacy-unreviewed-launcher"
			if _, err := a.update(context.Background(), "eggs", num(server["egg_id"]), egg); err != nil {
				t.Fatal(err)
			}
			fixture.mu.Lock()
			delete(fixture.Files, "/server.properties")
			fixture.Files[test.file] = []byte("private opaque file")
			fixture.State = "offline"
			fixture.mu.Unlock()
			route := "/api/client/servers/" + str(server["uuid_short"]) + "/game-settings?file=" + test.file
			infraExpect(t, mux, admin, "GET", route, nil, 404)
		})
	}
}
