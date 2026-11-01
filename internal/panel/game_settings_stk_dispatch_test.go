package panel

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func TestSTKSettingsFilenameAndDispatch(t *testing.T) {
	for _, name := range []string{"../config.xml", "/config.xml", "a/b.xml", "config.xml/", "{{CONFIG_NAME}}", "config.json", ".xml", ""} {
		if _, err := stkSettingsPath(name); err == nil {
			t.Fatalf("accepted unsafe filename %q", name)
		}
	}
	file, err := stkSettingsPath("My-server.xml")
	if err != nil || file != "/My-server.xml" {
		t.Fatal(file, err)
	}
	for _, entry := range gameTemplates().Entries {
		if entry.Path != "SuperTuxKart/egg-super-tux-kart.json" {
			continue
		}
		egg := M{"uuid": gameTemplateEggUUID(entry), "startup": entry.Egg["startup"], "_stk_settings_path": file}
		if nativeSettingsDocuments(egg)[file] != "xml" {
			t.Fatal("custom document missing")
		}
		p, err := parseGameSettingsForEgg(egg, file, []byte(`<server-config version="6"><chat value="true"/></server-config>`))
		if err != nil || len(p.fields) != 1 {
			t.Fatal("typed dispatch missing", err)
		}
		if _, err = p.patch(map[string]string{"chat": "false"}); err != nil {
			t.Fatal(err)
		}
		if _, exists := nativeSettingsDocuments(egg)["/config.xml"]; exists {
			t.Fatal("wrong default filename exposed")
		}
		return
	}
	t.Fatal("STK recipe missing")
}

func TestSTKSettingsAPIWriteGuards(t *testing.T) {
	a, mux, admin, server, f := quickSetupMinecraftFixture(t)
	ctx := context.Background()
	var startup string
	for _, entry := range gameTemplates().Entries {
		if entry.Path == "SuperTuxKart/egg-super-tux-kart.json" {
			startup = str(entry.Egg["startup"])
		}
	}
	if startup == "" {
		t.Fatal("STK startup missing")
	}
	if _, err := a.update(ctx, "eggs", num(server["egg_id"]), M{"startup": startup}); err != nil {
		t.Fatal(err)
	}
	if _, err := a.insert(ctx, "egg_variables", M{"egg_id": server["egg_id"], "name": "Configuration", "env_variable": "CONFIG_NAME", "default_value": "Custom.xml", "rules": "required|string", "user_viewable": true, "user_editable": true}); err != nil {
		t.Fatal(err)
	}
	original := `<?xml version="1.0"?><!--keep--><server-config version="6"><private-server-password value="private-stk-sentinel"/><chat value="true"/><voting-timeout value="30"/><unknown value="preserve"/></server-config>`
	f.mu.Lock()
	f.Files["/Custom.xml"] = []byte(original)
	f.State = "offline"
	f.mu.Unlock()
	endpoint := "/api/client/servers/" + str(server["uuid_short"]) + "/game-settings?file=%2FCustom.xml"
	view := asMap(infraExpect(t, mux, admin, "GET", endpoint, nil, 200)["attributes"])
	encoded, _ := json.Marshal(view)
	if strings.Contains(string(encoded), "private-stk-sentinel") || len(asSlice(view["fields"])) != 2 {
		t.Fatal("typed fields or secret protection failed")
	}
	infraExpect(t, mux, admin, "PUT", endpoint, M{"revision": view["revision"], "settings": M{"server-port": "1234"}}, 422)
	f.mu.Lock()
	f.State = "running"
	f.mu.Unlock()
	infraExpect(t, mux, admin, "PUT", endpoint, M{"revision": view["revision"], "settings": M{"chat": false}}, 409)
	f.mu.Lock()
	f.State = "offline"
	f.Files["/Custom.xml"] = []byte("<!--external-->" + original)
	f.mu.Unlock()
	infraExpect(t, mux, admin, "PUT", endpoint, M{"revision": view["revision"], "settings": M{"chat": false}}, 409)
	view = asMap(infraExpect(t, mux, admin, "GET", endpoint, nil, 200)["attributes"])
	infraExpect(t, mux, admin, "PUT", endpoint, M{"revision": view["revision"], "settings": M{"chat": false}}, 200)
	f.mu.Lock()
	updated := string(f.Files["/Custom.xml"])
	f.mu.Unlock()
	if updated != strings.Replace("<!--external-->"+original, `<chat value="true"/>`, `<chat value="false"/>`, 1) {
		t.Fatal("unrelated XML bytes changed")
	}
	reader, err := a.insert(ctx, "users", M{"uuid": newUUID(), "username": "stk-settings-reader", "email": "stk-settings-reader@example.invalid"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = a.insert(ctx, "subusers", M{"user_id": reader["id"], "server_id": server["id"], "permissions": []string{"file.read-content"}}); err != nil {
		t.Fatal(err)
	}
	readonly := asMap(infraExpect(t, mux, num(reader["id"]), "GET", endpoint, nil, 200)["attributes"])
	infraExpect(t, mux, num(reader["id"]), "PUT", endpoint, M{"revision": readonly["revision"], "settings": M{"chat": true}}, 403)
	infraExpect(t, mux, admin, "GET", "/api/client/servers/"+str(server["uuid_short"])+"/game-settings?file=%2Fconfig.xml", nil, 404)
}
