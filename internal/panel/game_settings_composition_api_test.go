package panel

import (
	"bytes"
	"context"
	"encoding/json"
	"testing"
)

func TestNativeSettingsCompositionAPI(t *testing.T) {
	for _, recipe := range []string{sonsSettingsRecipe, resoniteSettingsRecipe} {
		t.Run(recipe, func(t *testing.T) {
			a, mux, admin, server, fixture := quickSetupMinecraftFixture(t)
			egg := batchSettingsRecipeFixture(t, recipe)
			ctx := context.Background()
			if _, err := a.update(ctx, "eggs", num(server["egg_id"]), egg); err != nil {
				t.Fatal(err)
			}
			if _, err := a.update(ctx, "servers", num(server["id"]), M{"startup": egg["startup"]}); err != nil {
				t.Fatal(err)
			}
			file, _ := reviewedNewSettings(egg)
			source := `{"ServerName":"operator","Password":"root-private","unknown":123456789012345678901234567890,"GameSettings":{"Gameplay.TreeRegrowth":true,"token":"nested-private"}}`
			change := M{"/ServerName": "a longer server name", "/GameSettings/Gameplay.TreeRegrowth": false}
			key, group := "/GameSettings/Gameplay.TreeRegrowth", "Gameplay"
			invalidKey := "/GameSettings/unsupported"
			if recipe == resoniteSettingsRecipe {
				source = `{"comment":"operator","loginPassword":"root-private","unknown":123456789012345678901234567890,"startWorlds":[null,{"sessionName":"same","accessLevel":"Private","saveOnExit":false,"token":"nested-private"}]}`
				change = M{"/comment": "a longer comment", "/startWorlds/1/sessionName": "a longer session name", "/startWorlds/1/saveOnExit": true}
				key, group = "/startWorlds/1/saveOnExit", "Startup world 2"
				invalidKey = "/startWorlds/99/saveOnExit"
			}
			input := append([]byte{0xef, 0xbb, 0xbf}, []byte(source)...)
			fixture.mu.Lock()
			delete(fixture.Files, "/server.properties")
			fixture.Files[file] = input
			fixture.State = "offline"
			fixture.mu.Unlock()
			route := "/api/client/servers/" + str(server["uuid_short"]) + "/game-settings?file=" + file
			view := asMap(infraExpect(t, mux, admin, "GET", route, nil, 200)["attributes"])
			encoded, _ := json.Marshal(view)
			if bytes.Contains(encoded, []byte("root-private")) || bytes.Contains(encoded, []byte("nested-private")) {
				t.Fatal("secret exposed")
			}
			found := false
			for _, raw := range asSlice(view["fields"]) {
				field := asMap(raw)
				if field["key"] == key {
					found = true
					if field["type"] != "boolean" || field["group"] != group {
						t.Fatal("presentation", field)
					}
				}
			}
			if !found {
				t.Fatal("nested field unavailable")
			}
			infraExpect(t, mux, admin, "PUT", route, M{"revision": view["revision"], "settings": change}, 200)
			fixture.mu.Lock()
			after := append([]byte(nil), fixture.Files[file]...)
			fixture.mu.Unlock()
			parsed, err := parseGameSettingsForEgg(egg, file, after)
			if err != nil {
				t.Fatal(err)
			}
			values := map[string]string{}
			for _, field := range parsed.fields {
				values[field.key] = field.value
			}
			expected := "false"
			if recipe == resoniteSettingsRecipe {
				expected = "true"
			}
			if values[key] != expected {
				t.Fatal("nested change not persisted")
			}
			for _, opaque := range []string{`"unknown":123456789012345678901234567890`, `"token":"nested-private"`} {
				if !bytes.Contains(after, []byte(opaque)) {
					t.Fatal("opaque bytes changed")
				}
			}
			infraExpect(t, mux, admin, "PUT", route, M{"revision": view["revision"], "settings": change}, 409)
			fresh := asMap(infraExpect(t, mux, admin, "GET", route, nil, 200)["attributes"])
			infraExpect(t, mux, admin, "PUT", route, M{"revision": fresh["revision"], "settings": M{invalidKey: true}}, 422)
			fixture.mu.Lock()
			same := bytes.Equal(after, fixture.Files[file])
			fixture.mu.Unlock()
			if !same {
				t.Fatal("rejected patch mutated native bytes")
			}
		})
	}
}
