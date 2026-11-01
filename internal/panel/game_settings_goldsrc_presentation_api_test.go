package panel

import (
	"context"
	"strings"
	"testing"
)

func TestGoldSrcPresentationActualGetter(t *testing.T) {
	a, mux, admin, server, fixture := quickSetupMinecraftFixture(t)
	egg := goldSrcPresentationFixture(t)
	if _, err := a.update(context.Background(), "eggs", num(server["egg_id"]), M{"uuid": egg["uuid"], "startup": egg["startup"], "config_files": M{}}); err != nil {
		t.Fatal(err)
	}
	original := "// operator\r\nmp_roundtime 5\r\nmp_forcecamera 2\r\nmp_friendlyfire 0\r\n"
	fixture.mu.Lock()
	delete(fixture.Files, "/server.properties")
	fixture.Files[goldSrcCS16SettingsPath], fixture.State = []byte(original), "offline"
	fixture.mu.Unlock()
	endpoint := "/api/client/servers/" + str(server["uuid_short"]) + "/game-settings"
	view := asMap(infraExpect(t, mux, admin, "GET", endpoint, nil, 200)["attributes"])
	if view["file"] != goldSrcCS16SettingsPath {
		t.Fatal("Primary gameplay declaration missing")
	}
	round := laneGameSettingsField(view, "mp_roundtime")
	if round["label"] != "Round duration (minutes)" || num(round["min"]) != 1 || num(round["max"]) != 9 || round["type"] != "number" {
		t.Fatal("Measured roundtime presentation missing", round)
	}
	camera := laneGameSettingsField(view, "mp_forcecamera")
	if camera["label"] != "Spectator camera" || camera["type"] != "select" || camera["value"] != "2" || len(asSlice(camera["options"])) != 3 {
		t.Fatal("Native publisher camera options missing", camera)
	}
	if laneGameSettingsField(view, "mp_friendlyfire")["type"] != "boolean" {
		t.Fatal("Shared boolean switch changed")
	}
	for _, value := range []string{"0", "12"} {
		infraExpect(t, mux, admin, "PUT", endpoint, M{"revision": view["revision"], "settings": M{"mp_roundtime": value}}, 422)
	}
	infraExpect(t, mux, admin, "PUT", endpoint, M{"revision": view["revision"], "settings": M{"mp_forcecamera": "3"}}, 422)
	infraExpect(t, mux, admin, "PUT", endpoint, M{"revision": view["revision"], "settings": M{"mp_forcecamera": "1"}}, 200)
	fixture.mu.Lock()
	got := string(fixture.Files[goldSrcCS16SettingsPath])
	fixture.mu.Unlock()
	if got != strings.Replace(original, "mp_forcecamera 2", "mp_forcecamera 1", 1) {
		t.Fatal("Presentation changed validator or operator bytes")
	}
}
