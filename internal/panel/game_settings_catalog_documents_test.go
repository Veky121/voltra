package panel

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

// Exercise the real catalog, recipe identity, discovery and HTTP redaction
// together. Parser-only tests cannot catch a missing document declaration.
func TestCatalogTypedSettingsAPI(t *testing.T) {
	for _, tc := range []struct {
		name, recipe, file, content, key, kind string
		secret                                 bool
	}{
		{"css", "counter_strike/counter_strike_source/egg-counter--strike--source.json", cssSettingsPath, "mp_autoteambalance 2\nmp_friendlyfire 0\n", "mp_autoteambalance", "number", false},
		{"tshock", "terraria/tshock/egg-tshock.json", "/tshock/config.json", `{"Settings":{"MySqlConnectionString":"fixture-private-connection","EnableTokenEndpointAuthentication":false}}`, "/Settings/EnableTokenEndpointAuthentication", "boolean", false},
		{"openttd", "openttd/egg-open-t-t-d-server.json", "/secrets.cfg", "[network]\nserver_invite_code = fixture-private-invite\nserver_password = fixture-private-password\n", "network/server_invite_code", "readonly", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			a, mux, admin, server, fixture := quickSetupMinecraftFixture(t)
			var egg M
			for _, entry := range gameTemplates().Entries {
				if entry.Path == tc.recipe {
					egg = M{"uuid": gameTemplateEggUUID(entry), "startup": entry.Egg["startup"], "config_files": M{}}
				}
			}
			if egg == nil {
				t.Fatal("missing recipe")
			}
			if _, err := a.update(context.Background(), "eggs", num(server["egg_id"]), egg); err != nil {
				t.Fatal(err)
			}
			if tc.name == "tshock" {
				ctx := context.Background()
				allocation, err := a.insert(ctx, "allocations", M{"node_id": server["node_id"], "server_id": server["id"], "ip": "127.0.0.1", "port": 29371})
				if err != nil {
					t.Fatal(err)
				}
				if _, err = a.update(ctx, "servers", num(server["id"]), M{"allocation_id": allocation["id"], "startup": egg["startup"]}); err != nil {
					t.Fatal(err)
				}
				var entry gameTemplate
				for _, candidate := range gameTemplates().Entries {
					if candidate.Path == tc.recipe {
						entry = candidate
						break
					}
				}
				canonical, _, err := parseEggDocument(entry.Egg)
				if err != nil {
					t.Fatal(err)
				}
				if _, err = a.update(ctx, "eggs", num(server["egg_id"]), M{"config_files": canonical["config_files"], "java_config": M{}}); err != nil {
					t.Fatal(err)
				}
				script := str(asMap(asMap(entry.Egg["scripts"])["installation"])["script"])
				for _, chunk := range strings.Split(script, "cat > ")[1:] {
					head, body, ok := strings.Cut(chunk, "\n")
					if !ok {
						continue
					}
					name, marker, ok := strings.Cut(head, " <<'")
					if !ok || !strings.HasPrefix(name, ".voltra/") {
						continue
					}
					marker = strings.TrimSuffix(marker, "'")
					expected, _, ok := strings.Cut(body, "\n"+marker+"\n")
					if !ok {
						t.Fatal(name)
					}
					fixture.Files["/"+name] = []byte(expected + "\n")
				}
			}
			fixture.mu.Lock()
			delete(fixture.Files, "/server.properties")
			fixture.Files[tc.file], fixture.State = []byte(tc.content), "offline"
			fixture.mu.Unlock()
			route := "/api/client/servers/" + str(server["uuid_short"]) + "/game-settings"
			if tc.name != "css" {
				route += "?file=" + tc.file
			}
			view := asMap(infraExpect(t, mux, admin, "GET", route, nil, 200)["attributes"])
			if view["file"] != tc.file {
				t.Fatal("wrong discovered file", view["file"])
			}
			found := false
			for _, raw := range asSlice(view["fields"]) {
				field := asMap(raw)
				if field["key"] == tc.key {
					found = true
					if field["type"] != tc.kind || boolean(field["secret"]) != tc.secret {
						t.Fatal("wrong public field contract", field)
					}
				}
			}
			if !found {
				t.Fatal("typed field missing")
			}
			encoded, _ := json.Marshal(view)
			if strings.Contains(string(encoded), "fixture-private-") {
				t.Fatal("secret exposed through actual settings GET")
			}
		})
	}
}
