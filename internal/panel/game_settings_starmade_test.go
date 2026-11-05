package panel

import (
	"bytes"
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func TestStarmadePublisherSchemaPreservation(t *testing.T) {
	source := []byte("// operator\r\nMAX_CLIENTS = 006 // slots\r\nCOLLISION_DAMAGE = false\r\nSKIN_ALLOW_UPLOAD = true\r\nUSE_WHITELIST = false\r\nSUPER_ADMIN_PASSWORD = opaque-private\r\nUNKNOWN = 0.12345678901234567890123456789\r\n")
	parsed, e := parseStarmadeSettings(source)
	if e != nil || len(parsed.fields) != 4 {
		t.Fatal(e)
	}
	noop, e := parsed.patch(map[string]string{"MAX_CLIENTS": "6"})
	if e != nil || !bytes.Equal(noop, source) {
		t.Fatal("semantic no-op changed original bytes")
	}
	next, e := parsed.patch(map[string]string{"MAX_CLIENTS": "7", "COLLISION_DAMAGE": "true"})
	if e != nil {
		t.Fatal(e)
	}
	expected := bytes.Replace(source, []byte("006 // slots"), []byte("7 // slots"), 1)
	expected = bytes.Replace(expected, []byte("COLLISION_DAMAGE = false"), []byte("COLLISION_DAMAGE = true"), 1)
	if !bytes.Equal(next, expected) {
		t.Fatal("unrelated bytes changed")
	}
	for _, changes := range []map[string]string{{"MAX_CLIENTS": "1025"}, {"MAX_CLIENTS": "0"}, {"MAX_CLIENTS": "7.5"}, {"SKIN_ALLOW_UPLOAD": "TRUE"}, {"SUPER_ADMIN_PASSWORD": "changed"}, {"SERVER_PORT": "1"}} {
		if _, e := parsed.patch(changes); e == nil {
			t.Fatal("unsafe write accepted")
		}
	}
	for _, source := range []string{"MAX_CLIENTS=7\n\nCOLLISION_DAMAGE=true\n", "MAX_CLIENTS=7\nUNKNOWN=x\rMAX_CLIENTS=9\n", "MAX_CLIENTS=7\ninvalid line\n", "MAX_CLIENTS=7\nMAX_CLIENTS=8\n", "COLLISION_DAMAGE=TRUE\n", "\ufeffMAX_CLIENTS=7\n"} {
		if _, e := parseStarmadeSettings([]byte(source)); e == nil {
			t.Fatal("unsupported native read admitted")
		}
	}
	for _, source := range []string{"MAX_CLIENTS=0\n", "MAX_CLIENTS=1025\n"} {
		p, e := parseStarmadeSettings([]byte(source))
		if e != nil {
			t.Fatal(e)
		}
		if p.fields[0].value != "1" && p.fields[0].value != "1024" {
			t.Fatal("native clamp not represented")
		}
	}
	if _, e := parseStarmadeSettings([]byte{0xff}); e == nil {
		t.Fatal("invalid UTF8 accepted")
	}
}

func TestStarmadeCanonicalAuthority(t *testing.T) {
	egg := batchSettingsRecipeFixture(t, starmadeSettingsRecipe)
	files := wave46CanonicalHelpers(t, starmadeSettingsRecipe)
	files["server.cfg"] = []byte("MAX_CLIENTS=7\n")
	in := settingsAuthorityInput{Startup: str(egg["startup"]), Env: map[string]string{}, Files: files}
	if _, e := starmadeSettingsAuthority(starmadeSettingsRecipe, str(egg["startup"]), in); e != nil {
		t.Fatal(e)
	}
	for _, key := range []string{"JAVA_TOOL_OPTIONS", "JDK_JAVA_OPTIONS", "_JAVA_OPTIONS", "HOME", "VOLTRA_SERVER_ROOT"} {
		in.Env[key] = "redirect"
		if _, e := starmadeSettingsAuthority(starmadeSettingsRecipe, in.Startup, in); e == nil {
			t.Fatal("redirection admitted", key)
		}
		delete(in.Env, key)
	}
	in.Env["VOLTRA_SERVER_ROOT"] = "/home/container"
	if _, e := starmadeSettingsAuthority(starmadeSettingsRecipe, in.Startup, in); e != nil {
		t.Fatal(e)
	}
	delete(in.Env, "VOLTRA_SERVER_ROOT")
	in.Env["SERVER_JARFILE"] = "custom.jar"
	if _, e := starmadeSettingsAuthority(starmadeSettingsRecipe, in.Startup, in); e == nil {
		t.Fatal("custom jar admitted")
	}
	delete(in.Env, "SERVER_JARFILE")
	old := files[".voltra/java_games_runtime.py"]
	files[".voltra/java_games_runtime.py"] = []byte("changed")
	if _, e := starmadeSettingsAuthority(starmadeSettingsRecipe, in.Startup, in); e == nil {
		t.Fatal("helper changed")
	}
	files[".voltra/java_games_runtime.py"] = old
	in.Startup += " extra"
	if _, e := starmadeSettingsAuthority(starmadeSettingsRecipe, str(egg["startup"]), in); e == nil {
		t.Fatal("startup changed")
	}
}

func TestStarmadeSettingsAPI(t *testing.T) {
	a, mux, admin, s, f := quickSetupMinecraftFixture(t)
	ctx := context.Background()
	hl2dmFixtureAllocation(t, a, s)
	egg := batchSettingsRecipeFixture(t, starmadeSettingsRecipe)
	egg["java_config"] = M{}
	if _, e := a.update(ctx, "eggs", num(s["egg_id"]), egg); e != nil {
		t.Fatal(e)
	}
	if _, e := a.update(ctx, "servers", num(s["id"]), M{"startup": egg["startup"]}); e != nil {
		t.Fatal(e)
	}
	data := []byte("// operator\r\nMAX_CLIENTS = 6 // keep\r\nCOLLISION_DAMAGE = false\r\nSKIN_ALLOW_UPLOAD = true\r\nUSE_WHITELIST = false\r\nSUPER_ADMIN_PASSWORD = opaque-private\r\nUNKNOWN = untouched\r\n")
	f.mu.Lock()
	delete(f.Files, "/server.properties")
	f.Files[starmadeSettingsPath] = data
	f.State = "offline"
	for n, b := range wave46CanonicalHelpers(t, starmadeSettingsRecipe) {
		f.Files["/"+strings.TrimPrefix(n, "/")] = b
	}
	f.mu.Unlock()
	base := "/api/client/servers/" + str(s["uuid_short"]) + "/game-settings"
	route := base + "?file=" + starmadeSettingsPath
	view := asMap(infraExpect(t, mux, admin, "GET", base, nil, 200)["attributes"])
	if str(view["file"]) != starmadeSettingsPath || len(asSlice(view["fields"])) != 4 {
		t.Fatal("native document not selected")
	}
	b, _ := json.Marshal(view)
	if bytes.Contains(b, []byte("opaque-private")) {
		t.Fatal("secret exposed")
	}
	infraExpect(t, mux, admin, "PUT", route, M{"revision": view["revision"], "settings": M{"MAX_CLIENTS": "7", "COLLISION_DAMAGE": true}}, 200)
	expected := bytes.Replace(data, []byte("MAX_CLIENTS = 6"), []byte("MAX_CLIENTS = 7"), 1)
	expected = bytes.Replace(expected, []byte("COLLISION_DAMAGE = false"), []byte("COLLISION_DAMAGE = true"), 1)
	check := func() {
		t.Helper()
		f.mu.Lock()
		defer f.mu.Unlock()
		if !bytes.Equal(f.Files[starmadeSettingsPath], expected) {
			t.Fatal("unexpected file mutation")
		}
	}
	check()
	next := asMap(infraExpect(t, mux, admin, "GET", route, nil, 200)["attributes"])
	infraExpect(t, mux, admin, "PUT", route, M{"revision": view["revision"], "settings": M{"MAX_CLIENTS": "8"}}, 409)
	infraExpect(t, mux, admin, "PUT", route, M{"revision": next["revision"], "settings": M{"SUPER_ADMIN_PASSWORD": "x"}}, 422)
	infraExpect(t, mux, admin, "PUT", route, M{"revision": next["revision"], "settings": M{"MAX_CLIENTS": "1025"}}, 422)
	reader, e := a.insert(ctx, "users", M{"uuid": newUUID(), "username": "starmade-reader", "email": "starmade-reader@example.invalid"})
	if e != nil {
		t.Fatal(e)
	}
	if _, e = a.insert(ctx, "subusers", M{"user_id": reader["id"], "server_id": s["id"], "permissions": []string{"file.read-content"}}); e != nil {
		t.Fatal(e)
	}
	infraExpect(t, mux, num(reader["id"]), "PUT", route, M{"revision": next["revision"], "settings": M{"MAX_CLIENTS": "8"}}, 403)
	f.mu.Lock()
	f.State = "running"
	f.mu.Unlock()
	infraExpect(t, mux, admin, "PUT", route, M{"revision": next["revision"], "settings": M{"MAX_CLIENTS": "8"}}, 409)
	f.mu.Lock()
	f.State = "offline"
	f.Files["/.voltra/java_games_runtime.py"] = []byte("revoked")
	f.mu.Unlock()
	infraExpect(t, mux, admin, "GET", route, nil, 404)
	check()
	if a.DB.Stat().AcquiredConns() != 0 {
		t.Fatal("fixture connection leaked")
	}
}
