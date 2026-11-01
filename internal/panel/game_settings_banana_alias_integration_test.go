package panel

import (
	"context"
	"strings"
	"testing"
)

func TestBananaAliasAPIUpdatesExistingPair(t *testing.T) {
	a, mux, admin, server, fixture := quickSetupMinecraftFixture(t)
	egg := bananaSettingsFixtureEgg(t)
	if _, err := a.update(context.Background(), "eggs", num(server["egg_id"]), M{"uuid": egg["uuid"], "startup": egg["startup"], "config_files": M{}}); err != nil {
		t.Fatal(err)
	}
	file := "/Servers/PterodactylServer/Config.json"
	original := "{\r\n  \"Server\": {\"Login_Token\":\"old-secret\", \"STEAM_GSLT\":\"old-secret\"},\r\n  \"Unknown\":9007199254740993\r\n}\r\n"
	fixture.mu.Lock()
	fixture.Files[file], fixture.State = []byte(original), "offline"
	fixture.mu.Unlock()
	endpoint := "/api/client/servers/" + str(server["uuid_short"]) + "/game-settings?file=%2FServers%2FPterodactylServer%2FConfig.json"
	view := asMap(infraExpect(t, mux, admin, "GET", endpoint, nil, 200)["attributes"])
	infraExpect(t, mux, admin, "PUT", endpoint, M{"revision": view["revision"], "settings": M{"/Server/STEAM_GSLT": "new-secret"}}, 200)
	fixture.mu.Lock()
	updated := string(fixture.Files[file])
	fixture.mu.Unlock()
	if updated != strings.ReplaceAll(original, "old-secret", "new-secret") {
		t.Fatal("token aliases diverged or unrelated bytes changed")
	}
	view = asMap(infraExpect(t, mux, admin, "GET", endpoint, nil, 200)["attributes"])
	infraExpect(t, mux, admin, "PUT", endpoint, M{"revision": view["revision"], "settings": M{"/Server/Login_Token": "one", "/Server/STEAM_GSLT": "two"}}, 422)
}
