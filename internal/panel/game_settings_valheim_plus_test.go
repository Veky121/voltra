package panel

import (
	"archive/tar"
	"bytes"
	"context"
	"io"
	"os"
	"strings"
	"testing"
)

func TestValheimPlusAPI(t *testing.T) {
	rawBytes, err := os.ReadFile("../../artifacts/game-parity-20261029/wave382-valheim-plus-settings/native-valheim-plus.cfg")
	if err != nil {
		t.Fatal(err)
	}
	raw := "\ufeff" + strings.ReplaceAll(string(rawBytes), "\n", "\r\n") + "\r\n[Unknown]\r\nPrecision = 12345678901234567890.123456789\r\n"

	a, mux, admin, server, f := wave95Fixture(t)
	ctx := context.Background()
	var entry gameTemplate
	for _, e := range gameTemplates().Entries {
		if e.Path == valheimPlusSettingsRecipe {
			entry = e
		}
	}
	startup := str(entry.Egg["startup"])
	allocation, err := a.insert(ctx, "allocations", M{"node_id": server["node_id"], "server_id": server["id"], "ip": "127.0.0.1", "port": func() int {
		if valheimPlusSettingsRecipe == starboundAuthorityRecipe {
			return 21025
		}
		return 29371
	}()})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = a.update(ctx, "servers", num(server["id"]), M{"allocation_id": allocation["id"]}); err != nil {
		t.Fatal(err)
	}
	if _, err := a.update(ctx, "eggs", num(server["egg_id"]), M{"uuid": gameTemplateEggUUID(entry), "startup": startup, "config_files": M{}, "java_config": M{}}); err != nil {
		t.Fatal(err)
	}
	if _, err := a.update(ctx, "servers", num(server["id"]), M{"startup": startup}); err != nil {
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
		f.Files["/"+name] = []byte(expected + "\n")
	}
	f.Files[valheimPlusSettingsPath] = []byte(raw)
	tarFile, err := os.Open("../../artifacts/game-parity-20261029/wave375-valheim-plus-followup/full-payload.tar")
	if err != nil {
		t.Fatal(err)
	}
	defer tarFile.Close()
	tr := tar.NewReader(tarFile)
	for {
		h, e := tr.Next()
		if e != nil {
			t.Fatal("pinned plugin missing", e)
		}
		if h.Name == "payload/BepInEx/plugins/ValheimPlus.dll" {
			b, e := io.ReadAll(tr)
			if e != nil {
				t.Fatal(e)
			}
			f.Files[valheimPlusPluginPath] = b
			break
		}
	}

	// Replace only this isolated fixture egg's variables with canonical declarations.
	if err := a.exec(ctx, "DELETE FROM egg_variables WHERE egg_id=$1", server["egg_id"]); err != nil {
		t.Fatal(err)
	}
	for _, raw := range asSlice(entry.Egg["variables"]) {
		v := asMap(raw)
		if _, err := a.insert(ctx, "egg_variables", M{"egg_id": server["egg_id"], "name": v["name"], "env_variable": v["env_variable"], "default_value": func() any {
			if str(v["env_variable"]) == "INSTALL_MODE" {
				return "operator_files"
			}
			if str(v["env_variable"]) == "SERVER_PORT" {
				return "29371"
			}
			if str(v["env_variable"]) == "VOLTRA_STEAM_AUTO_UPDATE" {
				return "0"
			}
			return v["default_value"]
		}(), "user_viewable": true, "user_editable": true, "rules": "nullable"}); err != nil {
			t.Fatal(err)
		}
	}

	endpoint := "/api/client/servers/" + str(server["uuid_short"]) + "/game-settings"
	f.State = "offline"
	view := asMap(infraExpect(t, mux, admin, "GET", endpoint, nil, 200)["attributes"])
	if str(view["file"]) != valheimPlusSettingsPath || len(asSlice(view["fields"])) != 7 {
		t.Fatal("wrong default document or fields", view)
	}
	infraExpect(t, mux, admin, "GET", endpoint+"?file="+valheimPlusSettingsPath, nil, 200)
	infraExpect(t, mux, admin, "GET", endpoint+"?file=/doorstop_config.ini", nil, 404)
	for _, value := range []string{"false", "true"} {
		infraExpect(t, mux, admin, "PUT", endpoint, M{"revision": view["revision"], "settings": M{"Server/enabled": value == "true"}}, 200)
		expected := strings.Replace(raw, "[Server]\r\n\r\n## Change false to true to enable this section.\r\n# Setting type: Boolean\r\n# Default value: true\r\nenabled = true", "[Server]\r\n\r\n## Change false to true to enable this section.\r\n# Setting type: Boolean\r\n# Default value: true\r\nenabled = "+value, 1)
		if !bytes.Equal(f.Files[valheimPlusSettingsPath], []byte(expected)) {
			t.Fatal("bytes outside boolean changed")
		}
		view = asMap(infraExpect(t, mux, admin, "GET", endpoint, nil, 200)["attributes"])

	}
	for _, value := range []string{"1", "32"} {
		infraExpect(t, mux, admin, "PUT", endpoint, M{"revision": view["revision"], "settings": M{"Server/maxPlayers": value}}, 200)
		if !bytes.Equal(f.Files[valheimPlusSettingsPath], []byte(strings.Replace(raw, "maxPlayers = 10", "maxPlayers = "+value, 1))) {
			t.Fatal("numeric edit changed unrelated bytes")
		}
		view = asMap(infraExpect(t, mux, admin, "GET", endpoint, nil, 200)["attributes"])
	}
	for _, value := range []string{"0", "33"} {
		infraExpect(t, mux, admin, "PUT", endpoint, M{"revision": view["revision"], "settings": M{"Server/maxPlayers": value}}, 422)
	}
	input := M{"revision": view["revision"], "settings": M{"Server/enabled": false}}
	before := f.Writes
	infraExpect(t, mux, admin, "PUT", endpoint, M{"revision": "stale", "settings": M{"Server/enabled": false}}, 409)
	f.State = "running"
	infraExpect(t, mux, admin, "PUT", endpoint, input, 409)
	f.State = "offline"
	infraExpect(t, mux, admin, "PUT", endpoint, M{"revision": view["revision"], "settings": M{"Preloader/TargetAssembly": "evil"}}, 422)
	if _, err := a.update(ctx, "servers", num(server["id"]), M{"startup": "wrong"}); err != nil {
		t.Fatal(err)
	}
	infraExpect(t, mux, admin, "PUT", endpoint, input, 404)
	if _, err := a.update(ctx, "servers", num(server["id"]), M{"startup": startup}); err != nil {
		t.Fatal(err)
	}
	for name, body := range f.Files {
		if strings.HasPrefix(name, "/.voltra/") {
			f.Files[name] = append(bytes.Clone(body), '\n')
			infraExpect(t, mux, admin, "PUT", endpoint, input, 404)
			f.Files[name] = body
			break
		}
	}
	plugin := f.Files[valheimPlusPluginPath]
	f.Files[valheimPlusPluginPath] = []byte("wrong plugin")
	infraExpect(t, mux, admin, "PUT", endpoint, input, 404)
	f.Files[valheimPlusPluginPath] = plugin
	delete(f.Files, valheimPlusSettingsPath)
	infraExpect(t, mux, admin, "GET", endpoint+"?file="+valheimPlusSettingsPath, nil, 404)
	if f.Writes != before {
		t.Fatal("rejection wrote files")
	}
	if a.DB.Stat().AcquiredConns() != 0 {
		t.Fatal("acquired connections remain")
	}
	t.Log("zero acquired connections; isolated fixture cleanup registered")
}

func TestValheimPlusDuplicates(t *testing.T) {
	for _, raw := range []string{"[Server]\nmaxPlayers = 10\nmaxPlayers = 11\n", "[Server]\nenabled = true\nEnabled = false\n"} {
		if _, err := parseValheimPlusSettings([]byte(raw)); err == nil {
			t.Fatal("ambiguous setting accepted")
		}
	}
}
