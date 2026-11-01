package panel

import (
	"context"
	"encoding/json"
	"net/url"
	"strings"
	"testing"
)

func laneGameSettingsField(view M, key string) M {
	for _, value := range asSlice(view["fields"]) {
		field := asMap(value)
		if str(field["key"]) == key {
			return field
		}
	}
	return nil
}

func TestBananaSettingsIntegratedAPI(t *testing.T) {
	a, mux, admin, server, f := quickSetupMinecraftFixture(t)
	ctx := context.Background()
	egg := bananaSettingsFixtureEgg(t)
	if _, err := a.update(ctx, "eggs", num(server["egg_id"]), M{"uuid": egg["uuid"], "startup": egg["startup"], "config_files": M{}}); err != nil {
		t.Fatal(err)
	}
	variable, err := a.insert(ctx, "egg_variables", M{"egg_id": server["egg_id"], "name": "Selected server", "env_variable": "SERVER", "default_value": "PterodactylServer", "rules": "required|string", "user_editable": false})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = a.insert(ctx, "server_variables", M{"server_id": server["id"], "variable_id": variable["id"], "variable_value": "Mods"}); err != nil {
		t.Fatal(err)
	}
	selected := "/Servers/Mods/Config.json"
	original := `{"Server":{"Login_Token":"banana-token-sentinel","STEAM_GSLT":"banana-token-sentinel"},"Browser":{"Server_Name":"Before"},"Game":{"Unknown":9007199254740993,"Rotation":["one","one"]}}`
	f.mu.Lock()
	delete(f.Files, "/server.properties")
	f.Files[selected] = []byte(original)
	f.Files["/Servers/PterodactylServer/Config.json"] = []byte(`{"Browser":{"Server_Name":"inactive shadow"}}`)
	f.State = "offline"
	f.mu.Unlock()
	base := "/api/client/servers/" + str(server["uuid_short"]) + "/game-settings?file="
	endpoint := base + url.QueryEscape(selected)
	view := asMap(infraExpect(t, mux, admin, "GET", endpoint, nil, 200)["attributes"])
	encoded, _ := json.Marshal(view)
	if strings.Contains(string(encoded), "banana-token-sentinel") || view["file"] != selected {
		t.Fatal("selected native path or credential masking failed")
	}
	for _, key := range []string{"/Server/Login_Token", "/Server/STEAM_GSLT"} {
		field := laneGameSettingsField(view, key)
		if !boolean(field["secret"]) || field["value"] != nil {
			t.Fatalf("native credential is not masked: %s", key)
		}
	}
	infraExpect(t, mux, admin, "GET", base+url.QueryEscape("/Servers/PterodactylServer/Config.json"), nil, 404)
	f.mu.Lock()
	f.State = "running"
	f.mu.Unlock()
	infraExpect(t, mux, admin, "PUT", endpoint, M{"revision": view["revision"], "settings": M{"/Browser/Server_Name": "After"}}, 409)
	f.mu.Lock()
	f.State = "offline"
	f.Files[selected] = append([]byte(" \n"), []byte(original)...)
	f.mu.Unlock()
	infraExpect(t, mux, admin, "PUT", endpoint, M{"revision": view["revision"], "settings": M{"/Browser/Server_Name": "After"}}, 409)
	view = asMap(infraExpect(t, mux, admin, "GET", endpoint, nil, 200)["attributes"])
	infraExpect(t, mux, admin, "PUT", endpoint, M{"revision": view["revision"], "settings": M{"/Browser/Server_Name": "After"}}, 200)
	f.mu.Lock()
	updated := string(f.Files[selected])
	f.mu.Unlock()
	if !strings.Contains(updated, "9007199254740993") || !strings.Contains(updated, "banana-token-sentinel") {
		t.Fatal("unknown precision or stored credential changed during a name edit")
	}
	reader, err := a.insert(ctx, "users", M{"uuid": newUUID(), "username": "banana-settings-reader", "email": "banana-reader@example.invalid"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = a.insert(ctx, "subusers", M{"user_id": reader["id"], "server_id": server["id"], "permissions": []string{"file.read-content"}}); err != nil {
		t.Fatal(err)
	}
	readOnly := asMap(infraExpect(t, mux, num(reader["id"]), "GET", endpoint, nil, 200)["attributes"])
	infraExpect(t, mux, num(reader["id"]), "PUT", endpoint, M{"revision": readOnly["revision"], "settings": M{"/Browser/Server_Name": "unauthorized"}}, 403)
}

func TestBananaSettingsFolderBoundary(t *testing.T) {
	for _, name := range []string{"PterodactylServer", "Operator_42", "Mods", "-", strings.Repeat("x", 80)} {
		file, err := bananaSettingsPath(name)
		if err != nil || file != "/Servers/"+name+"/Config.json" {
			t.Fatalf("valid folder %q: %q %v", name, file, err)
		}
	}
	for _, name := range []string{"", "..", "../escape", "/absolute", "sub/folder", `sub\folder`, "with space", "dots.name", "{{SERVER}}", "a\x00b", "a\nb", "é", strings.Repeat("x", 81)} {
		if _, err := bananaSettingsPath(name); err == nil {
			t.Fatalf("accepted unsafe folder %q", name)
		}
	}
}

func bananaSettingsFixtureEgg(t *testing.T) M {
	t.Helper()
	for _, entry := range gameTemplates().Entries {
		if entry.Path == bananaSettingsRecipe {
			return M{"uuid": gameTemplateEggUUID(entry), "startup": entry.Egg["startup"]}
		}
	}
	t.Fatal("Banana recipe missing")
	return nil
}

func TestBananaSettingsWrongRecipeDoesNotQuery(t *testing.T) {
	egg := M{"name": "Banana Shooter", "_banana_settings_path": "/Servers/Old/Config.json"}
	if err := (&App{}).prepareBananaSettingsEgg(context.Background(), M{}, egg); err != nil {
		t.Fatal(err)
	}
	if _, exists := egg["_banana_settings_path"]; exists {
		t.Fatal("unrelated display name retained selected-path authority")
	}
}

func TestBananaSettingsSelectedDocumentBoundary(t *testing.T) {
	egg := bananaSettingsFixtureEgg(t)
	for _, selected := range []string{"/Servers/Operator_42/Config.json", "/Servers/Mods/Config.json"} {
		egg["_banana_settings_path"] = selected
		if bananaSelectedSettingsDocument(egg) != selected {
			t.Fatal("validated runtime-selected document was lost")
		}
	}
	for _, selected := range []string{"", "/Config.json", "/Servers/Other/Unknown.json", "/Servers/../Config.json", "/Servers/One/Two/Config.json", "/Servers/{{SERVER}}/Config.json"} {
		egg["_banana_settings_path"] = selected
		if bananaSelectedSettingsDocument(egg) != "" {
			t.Fatalf("unsafe selected document authorized: %q", selected)
		}
	}
	if bananaSelectedSettingsDocument(M{"name": "Banana Shooter", "_banana_settings_path": "/Servers/Operator_42/Config.json"}) != "" {
		t.Fatal("display name gained selected-document authority")
	}
}

func TestBananaSettingsInvalidServerContextFailsClosed(t *testing.T) {
	egg := bananaSettingsFixtureEgg(t)
	egg["_banana_settings_path"] = "/Servers/Stale/Config.json"
	if err := (&App{}).prepareBananaSettingsEgg(context.Background(), M{}, egg); err == nil {
		t.Fatal("missing server context silently selected a default or queried a nil database")
	}
	if bananaSelectedSettingsDocument(egg) != "" {
		t.Fatal("invalid server context retained selected-document authority")
	}
}

func TestBananaSettingsEffectiveFolderPostgres(t *testing.T) {
	a, _, _, server, _ := quickSetupMinecraftFixture(t)
	ctx := context.Background()
	egg := bananaSettingsFixtureEgg(t)
	if _, err := a.update(ctx, "eggs", num(server["egg_id"]), M{"uuid": egg["uuid"], "startup": egg["startup"]}); err != nil {
		t.Fatal(err)
	}
	if err := a.prepareBananaSettingsEgg(ctx, server, egg); err != nil {
		t.Fatal(err)
	}
	if egg["_banana_settings_path"] != "/Servers/PterodactylServer/Config.json" {
		t.Fatal("runtime's missing-variable default was not used")
	}
	variable, err := a.insert(ctx, "egg_variables", M{"egg_id": server["egg_id"], "name": "Server folder", "env_variable": "SERVER", "default_value": "EggDefault", "rules": "required|string", "user_viewable": true, "user_editable": false})
	if err != nil {
		t.Fatal(err)
	}
	if err = a.prepareBananaSettingsEgg(ctx, server, egg); err != nil || egg["_banana_settings_path"] != "/Servers/EggDefault/Config.json" {
		t.Fatalf("egg default: %v %v", err, egg["_banana_settings_path"])
	}
	if _, err = a.insert(ctx, "server_variables", M{"server_id": server["id"], "variable_id": variable["id"], "variable_value": "Actual_Operator"}); err != nil {
		t.Fatal(err)
	}
	if err = a.prepareBananaSettingsEgg(ctx, server, egg); err != nil || egg["_banana_settings_path"] != "/Servers/Actual_Operator/Config.json" {
		t.Fatalf("server override: %v %v", err, egg["_banana_settings_path"])
	}
	for _, invalid := range []string{"", "../escape", "nested/path", strings.Repeat("a", 81)} {
		if err = a.exec(ctx, "UPDATE server_variables SET variable_value=$1 WHERE server_id=$2 AND variable_id=$3", invalid, server["id"], variable["id"]); err != nil {
			t.Fatal(err)
		}
		egg["_banana_settings_path"] = "/Servers/Stale/Config.json"
		if err = a.prepareBananaSettingsEgg(ctx, server, egg); err == nil {
			t.Fatalf("accepted invalid effective folder %q", invalid)
		}
		if _, exists := egg["_banana_settings_path"]; exists {
			t.Fatal("invalid effective variable retained a stale selected file")
		}
	}
	if err = a.exec(ctx, "UPDATE server_variables SET variable_value='Actual_Operator' WHERE server_id=$1 AND variable_id=$2", server["id"], variable["id"]); err != nil {
		t.Fatal(err)
	}
	if _, err = a.insert(ctx, "egg_variables", M{"egg_id": server["egg_id"], "name": "Repeated server folder", "env_variable": "SERVER", "default_value": "Actual_Operator", "rules": "required|string"}); err != nil {
		t.Fatal(err)
	}
	if err = a.prepareBananaSettingsEgg(ctx, server, egg); err == nil {
		t.Fatal("duplicate SERVER rows were silently selected, even with equal values")
	}
	if _, exists := egg["_banana_settings_path"]; exists {
		t.Fatal("ambiguous variable retained selected-path authority")
	}
	row, err := a.one(ctx, "SELECT variable_value FROM server_variables WHERE server_id=$1 AND variable_id=$2", server["id"], variable["id"])
	if err != nil || row["variable_value"] != "Actual_Operator" {
		t.Fatal("preparation changed persisted runtime variables")
	}
	canceled, cancel := context.WithCancel(ctx)
	cancel()
	egg["_banana_settings_path"] = "/Servers/Stale/Config.json"
	if err = a.prepareBananaSettingsEgg(canceled, server, egg); err == nil {
		t.Fatal("failed database read silently selected a default path")
	}
	if _, exists := egg["_banana_settings_path"]; exists {
		t.Fatal("canceled request retained stale path authority")
	}
}
