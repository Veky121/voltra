package panel

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func TestDDNetOriginalSettingsDiscoveryAPI(t *testing.T) {
	a, mux, admin, server, fixture := quickSetupMinecraftFixture(t)
	var egg M
	for _, entry := range gameTemplates().Entries {
		if entry.Path == "ddnet/egg-d-d-net.json" {
			egg = M{"uuid": gameTemplateEggUUID(entry), "startup": entry.Egg["startup"]}
		}
	}
	if egg == nil {
		t.Fatal("missing original DDNet recipe")
	}
	egg["config_files"] = M{}
	if _, err := a.update(context.Background(), "eggs", num(server["egg_id"]), egg); err != nil {
		t.Fatal(err)
	}
	if _, err := a.update(context.Background(), "servers", num(server["id"]), M{"startup": egg["startup"]}); err != nil {
		t.Fatal(err)
	}
	fixture.mu.Lock()
	delete(fixture.Files, "/server.properties")
	fixture.Files[ddnetSettingsPath], fixture.State = []byte(ddnetOriginalSeed), "offline"
	fixture.mu.Unlock()
	endpoint := "/api/client/servers/" + str(server["uuid_short"]) + "/game-settings"
	view := asMap(infraExpect(t, mux, admin, "GET", endpoint, nil, 200)["attributes"])
	if view["file"] != ddnetSettingsPath || len(asSlice(view["fields"])) != 6 {
		t.Fatal("root command document not discovered or specialized parser missing")
	}
	encoded, _ := json.Marshal(view)
	if strings.Contains(string(encoded), "private-player") || strings.Contains(string(encoded), "private-rcon") {
		t.Fatal("credentials exposed")
	}
	infraExpect(t, mux, admin, "PUT", endpoint, M{"file": ddnetSettingsPath, "revision": view["revision"], "settings": M{"sv_name": "Updated", "sv_register": true}}, 200)
	fixture.mu.Lock()
	updated := string(fixture.Files[ddnetSettingsPath])
	fixture.mu.Unlock()
	expected := strings.Replace(strings.Replace(ddnetOriginalSeed, `"Original"`, `"Updated"`, 1), "sv_register 0", `sv_register "1"`, 1)
	if updated != expected {
		t.Fatal("base exec, secrets or unrelated bytes changed")
	}
}
