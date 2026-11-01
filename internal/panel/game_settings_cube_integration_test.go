package panel

import (
	"context"
	"net/url"
	"strings"
	"testing"
)

func TestCubeSettingsAPI(t *testing.T) {
	for _, test := range []struct{ recipe, file, original, key, value, old, new string }{
		{"cubeengine/assaultcube/egg-assault-cube.json", assaultCubeSettingsPath, "// operator\r\n-Iconfig/retained\r\n-l1\r\n-kA45\r\n-kB20\r\n", "afk-limit", "60", "-kA45", "-kA60"},
		{"cubeengine/cube2/egg-cube2--sauerbraten.json", sauerCubeSettingsPath, "// operator\r\npublicserver 0\r\nrestrictpausegame 1\r\nrestrictgamespeed 1\r\n", "public-server-mode", "1", "publicserver 0", "publicserver 1"},
	} {
		t.Run(test.recipe, func(t *testing.T) {
			a, mux, admin, server, fixture := quickSetupMinecraftFixture(t)
			var startup any
			for _, entry := range gameTemplates().Entries {
				if entry.Path == test.recipe {
					startup = entry.Egg["startup"]
				}
			}
			if startup == nil {
				t.Fatal("missing recipe")
			}
			if _, err := a.update(context.Background(), "eggs", num(server["egg_id"]), M{"startup": startup, "config_files": M{}}); err != nil {
				t.Fatal(err)
			}
			fixture.mu.Lock()
			fixture.Files[test.file], fixture.State = []byte(test.original), "offline"
			fixture.mu.Unlock()
			endpoint := "/api/client/servers/" + str(server["uuid_short"]) + "/game-settings?file=" + url.QueryEscape(test.file)
			view := asMap(infraExpect(t, mux, admin, "GET", endpoint, nil, 200)["attributes"])
			if len(asSlice(view["fields"])) != 3 {
				t.Fatal("missing specialized controls")
			}
			for _, value := range asSlice(view["fields"]) {
				field := asMap(value)
				if field["label"] == field["key"] {
					t.Fatal("native setting label not applied")
				}
			}
			infraExpect(t, mux, admin, "PUT", endpoint, M{"revision": view["revision"], "settings": M{test.key: test.value}}, 200)
			fixture.mu.Lock()
			updated := string(fixture.Files[test.file])
			fixture.mu.Unlock()
			if updated != strings.Replace(test.original, test.old, test.new, 1) {
				t.Fatal("unrelated executable configuration bytes changed")
			}
		})
	}
}
