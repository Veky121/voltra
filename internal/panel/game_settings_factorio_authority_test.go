package panel

import (
	"context"
	"testing"
)

func TestFactorioInactiveStartupRefusesDiscovery(t *testing.T) {
	a, mux, admin, server, fixture := quickSetupMinecraftFixture(t)
	egg := batchSettingsRecipeFixture(t, factorioNativeRecipe)
	if _, err := a.update(context.Background(), "eggs", num(server["egg_id"]), egg); err != nil {
		t.Fatal(err)
	}
	fixture.mu.Lock()
	fixture.Files["/data/server-settings.json"] = []byte(`{"name":"Inactive document","visibility":{"public":false}}`)
	fixture.State = "offline"
	before := fixture.Writes
	fixture.mu.Unlock()
	path := "/api/client/servers/" + str(server["uuid_short"]) + "/game-settings?file=/data/server-settings.json"
	infraExpect(t, mux, admin, "GET", path, nil, 404)
	fixture.mu.Lock()
	defer fixture.mu.Unlock()
	if fixture.Writes != before {
		t.Fatal("inactive discovery changed native bytes")
	}
}
