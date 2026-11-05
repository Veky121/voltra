package panel

import (
	"context"
	"strings"
	"testing"
)

func hl2dmFixtureHelpers(t *testing.T, fixture *steamGamesWings) {
	t.Helper()
	for name, body := range wave46CanonicalHelpers(t, hl2dmSettingsRecipe) {
		fixture.Files["/"+strings.TrimPrefix(name, "/")] = body
	}
}

func hl2dmFixtureAllocation(t *testing.T, a *App, server M) {
	t.Helper()
	ctx := context.Background()
	allocation, err := a.insert(ctx, "allocations", M{"node_id": server["node_id"], "server_id": server["id"], "ip": "127.0.0.1", "port": 29371})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = a.update(ctx, "servers", num(server["id"]), M{"allocation_id": allocation["id"]}); err != nil {
		t.Fatal(err)
	}
	server["allocation_id"] = allocation["id"]
}

func TestHL2DMInstalledHelperAuthority(t *testing.T) {
	for _, mode := range []string{"modified", "missing"} {
		t.Run(mode, func(t *testing.T) {
			a, mux, admin, server, fixture := quickSetupMinecraftFixture(t)
			ctx := context.Background()
			egg := batchSettingsRecipeFixture(t, hl2dmSettingsRecipe)
			egg["java_config"] = M{}
			if _, err := a.update(ctx, "eggs", num(server["egg_id"]), egg); err != nil {
				t.Fatal(err)
			}
			if _, err := a.update(ctx, "servers", num(server["id"]), M{"startup": egg["startup"]}); err != nil {
				t.Fatal(err)
			}
			hl2dmFixtureAllocation(t, a, server)
			fixture.mu.Lock()
			delete(fixture.Files, "/server.properties")
			hl2dmFixtureHelpers(t, fixture)
			fixture.Files[hl2dmSettingsPath] = []byte("mp_teamplay 0\n")
			fixture.State = "offline"
			fixture.mu.Unlock()
			route := "/api/client/servers/" + str(server["uuid_short"]) + "/game-settings?file=" + hl2dmSettingsPath
			view := asMap(infraExpect(t, mux, admin, "GET", route, nil, 200)["attributes"])
			fixture.mu.Lock()
			if mode == "missing" {
				delete(fixture.Files, "/.voltra/hl2dm_runtime.py")
			} else {
				fixture.Files["/.voltra/hl2dm_runtime.py"] = []byte("# custom launcher ignores gameplay config\n")
			}
			writes := fixture.Writes
			fixture.mu.Unlock()
			infraExpect(t, mux, admin, "GET", route, nil, 404)
			infraExpect(t, mux, admin, "PUT", route, M{"revision": view["revision"], "settings": M{"mp_teamplay": true}}, 404)
			fixture.mu.Lock()
			defer fixture.mu.Unlock()
			if fixture.Writes != writes || string(fixture.Files[hl2dmSettingsPath]) != "mp_teamplay 0\n" {
				t.Fatal("unsupported helper changed gameplay config")
			}
		})
	}
}
