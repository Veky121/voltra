package panel

import (
	"bytes"
	"context"
	"os"
	"strings"
	"testing"
)

func TestBepinexLoggingAPI(t *testing.T) {
	raw := "\ufeff# native comment\r\n[Logging.Disk]\r\nEnabled = true # keep\r\n[Preloader]\r\nTargetAssembly = UnityEngine.CoreModule.dll\r\nPrecision = 12345678901234567890.123456789\r\n"
	a, mux, admin, server, f := wave95Fixture(t)
	ctx := context.Background()
	var entry gameTemplate
	for _, e := range gameTemplates().Entries {
		if e.Path == bepinexLoggingRecipe {
			entry = e
		}
	}
	startup := str(entry.Egg["startup"])
	allocation, err := a.insert(ctx, "allocations", M{"node_id": server["node_id"], "server_id": server["id"], "ip": "127.0.0.1", "port": func() int {
		if bepinexLoggingRecipe == starboundAuthorityRecipe {
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
	f.Files[bepinexLoggingPath] = []byte(raw)
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
	if str(view["file"]) != bepinexLoggingPath || len(asSlice(view["fields"])) != 1 {
		t.Fatal("wrong default document or fields", view)
	}
	infraExpect(t, mux, admin, "GET", endpoint+"?file="+bepinexLoggingPath, nil, 200)
	infraExpect(t, mux, admin, "GET", endpoint+"?file=/doorstop_config.ini", nil, 404)
	for _, value := range []string{"false", "true"} {
		infraExpect(t, mux, admin, "PUT", endpoint, M{"revision": view["revision"], "settings": M{bepinexLoggingKey: value == "true"}}, 200)
		expected := strings.Replace(raw, "Enabled = true", "Enabled = "+value, 1)
		if !bytes.Equal(f.Files[bepinexLoggingPath], []byte(expected)) {
			t.Fatal("bytes outside boolean changed")
		}
		view = asMap(infraExpect(t, mux, admin, "GET", endpoint, nil, 200)["attributes"])
		field := asMap(asSlice(view["fields"])[0])
		if field["value"] != (value == "true") {
			t.Fatal("wrong boolean", field)
		}
	}
	input := M{"revision": view["revision"], "settings": M{bepinexLoggingKey: false}}
	before := f.Writes
	infraExpect(t, mux, admin, "PUT", endpoint, M{"revision": "stale", "settings": M{bepinexLoggingKey: false}}, 409)
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
	delete(f.Files, bepinexLoggingPath)
	infraExpect(t, mux, admin, "GET", endpoint+"?file="+bepinexLoggingPath, nil, 404)
	if f.Writes != before {
		t.Fatal("rejection wrote files")
	}
	if a.DB.Stat().AcquiredConns() != 0 {
		t.Fatal("acquired connections remain")
	}
	t.Log("zero acquired connections; isolated fixture cleanup registered")
}

func TestBepinexLoggingNativeBytes(t *testing.T) {
	raw, err := os.ReadFile("testdata/game-settings/game-parity-20261029/wave380-bepinex-logging-editor/native-BepInEx.cfg")
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := parseBepinexLoggingSettings(raw)
	if err != nil {
		t.Fatal(err)
	}
	original := parsed.fields[0].value
	toggled := "false"
	if original == "false" {
		toggled = "true"
	}
	changed, err := parsed.patch(map[string]string{bepinexLoggingKey: toggled})
	if err != nil {
		t.Fatal(err)
	}
	next, err := parseBepinexLoggingSettings(changed)
	if err != nil {
		t.Fatal(err)
	}
	restored, err := next.patch(map[string]string{bepinexLoggingKey: original})
	if err != nil || !bytes.Equal(raw, restored) {
		t.Fatal("native round trip changed bytes")
	}
	for _, raw := range []string{"[Logging.Disk]\nEnabled = true\nEnabled = false\n", "[Logging.Disk]\nEnabled = perhaps\n", "[Logging.Disk]\nEnabled = true\nenabled = false\n"} {
		if _, err := parseBepinexLoggingSettings([]byte(raw)); err == nil {
			t.Fatal("ambiguous boolean accepted")
		}
	}
}
