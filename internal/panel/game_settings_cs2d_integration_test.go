package panel

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func TestCS2DSettingsAPI(t *testing.T) {
	a, mux, admin, server, fixture := quickSetupMinecraftFixture(t)
	for _, entry := range gameTemplates().Entries {
		if entry.Path != "cs2d/egg-c-s2-d.json" {
			continue
		}
		if _, err := a.update(context.Background(), "eggs", num(server["egg_id"]), M{"startup": entry.Egg["startup"]}); err != nil {
			t.Fatal(err)
		}
		original := "// operator\r\r\nsv_password private-sentinel\r\r\nsv_hostport 29102\r\r\nsv_friendlyfire 0\r\r\nmp_roundtime 5 // retained\r\r\nunknown future\r\r\n"
		fixture.mu.Lock()
		fixture.Files[cs2dSettingsPath], fixture.State = []byte(original), "offline"
		fixture.mu.Unlock()
		endpoint := "/api/client/servers/" + str(server["uuid_short"]) + "/game-settings?file=%2Fcs2d%2Fsys%2Fserver.cfg"
		view := asMap(infraExpect(t, mux, admin, "GET", endpoint, nil, 200)["attributes"])
		encoded, _ := json.Marshal(view)
		if strings.Contains(string(encoded), "private-sentinel") || len(asSlice(view["fields"])) != 2 {
			t.Fatal("unsafe or missing CFG controls")
		}
		infraExpect(t, mux, admin, "PUT", endpoint, M{"revision": view["revision"], "settings": M{"sv_friendlyfire": true, "mp_roundtime": "10"}}, 200)
		fixture.mu.Lock()
		updated := string(fixture.Files[cs2dSettingsPath])
		fixture.mu.Unlock()
		expected := strings.Replace(strings.Replace(original, "sv_friendlyfire 0", "sv_friendlyfire 1", 1), "mp_roundtime 5", "mp_roundtime 10", 1)
		if updated != expected {
			t.Fatal("native executable CFG bytes changed outside selected values")
		}
		return
	}
	t.Fatal("missing CS2D recipe")
}

func TestCS2DSettingsRecipeDispatch(t *testing.T) {
	for _, entry := range gameTemplates().Entries {
		if entry.Path != "cs2d/egg-c-s2-d.json" {
			continue
		}
		egg := M{"uuid": gameTemplateEggUUID(entry)}
		found := false
		for _, file := range gameSettingsDeclaredDocuments(egg) {
			if file == cs2dSettingsPath {
				found = true
			}
		}
		if !found {
			t.Fatal("safe native document not discovered")
		}
		parsed, err := parseDiscoveredGameSettings(egg, cs2dSettingsPath, []byte("sv_password private\nsv_hostport 29102\nsv_friendlyfire 0\nmp_roundtime 5\n"))
		if err != nil || len(parsed.fields) != 2 {
			t.Fatalf("specialized parser not dispatched: %v fields=%d", err, len(parsed.fields))
		}
		if _, err = parsed.patch(map[string]string{"sv_hostport": "1234"}); err == nil {
			t.Fatal("runtime listener editable")
		}
		return
	}
	t.Fatal("missing CS2D recipe")
}
