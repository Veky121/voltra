package panel

import (
	"bytes"
	"context"
	"os"
	"strings"
	"testing"
)

func TestNecesseNativeSchema(t *testing.T) {
	data := []byte(necesseNativeSchemaFixture)
	p, e := parseNecesseSettings(data)
	if e != nil {
		t.Fatal(e)
	}
	if len(p.fields) != 12 {
		t.Fatalf("fields %d", len(p.fields))
	}
	for _, f := range p.fields {
		if strings.Contains(f.key, "password") {
			t.Fatal("secret exposed")
		}
		m := M{"key": f.key}
		necesseSettingPresentation(m)
		if (m["readonly"] == true) == necesseEditable(f.key) {
			t.Fatal("writable")
		}
	}
	copy, e := p.patch(nil)
	if e != nil || !bytes.Equal(copy, data) {
		t.Fatal("bytes changed")
	}
	if _, e = p.patch(map[string]string{"slots": "7"}); e == nil {
		t.Fatal("write allowed")
	}
	for _, body := range []string{"set slots 7", "SERVER = {\nslots = 7,\nslots = 8,\n}", "SERVER = {\nlogging = yes,\n}", "SERVER = {\nslots = 4.1,\n}", "SERVER = {\nslots = 7,"} {
		if _, e := parseNecesseSettings([]byte(body)); e == nil {
			t.Fatalf("accepted %q", body)
		}
	}
}

func TestNecesseSettingsAPI(t *testing.T) {
	a, mux, admin, s, f := quickSetupMinecraftFixture(t)
	ctx := context.Background()
	hl2dmFixtureAllocation(t, a, s)
	egg := batchSettingsRecipeFixture(t, necesseSettingsRecipe)
	egg["java_config"] = M{}
	if _, e := a.update(ctx, "eggs", num(s["egg_id"]), egg); e != nil {
		t.Fatal(e)
	}
	if _, e := a.update(ctx, "servers", num(s["id"]), M{"startup": egg["startup"]}); e != nil {
		t.Fatal(e)
	}
	data := []byte(necesseNativeSchemaFixture)
	f.mu.Lock()
	delete(f.Files, "/server.properties")
	f.Files[necesseSettingsPath] = data
	f.State = "offline"
	for n, b := range wave46CanonicalHelpers(t, necesseSettingsRecipe) {
		f.Files["/"+strings.TrimPrefix(n, "/")] = b
	}
	f.mu.Unlock()
	route := "/api/client/servers/" + str(s["uuid_short"]) + "/game-settings?file=" + necesseSettingsPath
	view := asMap(infraExpect(t, mux, admin, "GET", route, nil, 200)["attributes"])
	if len(asSlice(view["fields"])) != 12 {
		t.Fatal("missing typed native fields")
	}
	for _, v := range asSlice(view["fields"]) {
		field := asMap(v)
		if boolean(field["readonly"]) == necesseEditable(str(field["key"])) {
			t.Fatalf("wrong readonly: %v", field)
		}
	}
	infraExpect(t, mux, admin, "PUT", route, M{"revision": view["revision"], "settings": M{"slots": 7}}, 422)
	f.mu.Lock()
	if !bytes.Equal(f.Files[necesseSettingsPath], data) {
		t.Fatal("write changed bytes")
	}
	f.mu.Unlock()
	changes := M{"logging": false, "strictServerAuthority": true, "maxClientLatencySeconds": "31", "unloadLevelsCooldown": "32", "droppedItemsLifeMinutes": "-2", "unloadSettlements": true, "maxSettlementsPerPlayer": "-2", "maxSettlersPerSettlement": "-3", "zipSaves": false}
	infraExpect(t, mux, admin, "PUT", route, M{"revision": view["revision"], "settings": changes}, 200)
	f.mu.Lock()
	candidate := append([]byte(nil), f.Files[necesseSettingsPath]...)
	f.mu.Unlock()
	parsed, err := parseNecesseSettings(candidate)
	if err != nil {
		t.Fatal(err)
	}
	for _, field := range parsed.fields {
		if v, ok := changes[field.key]; ok {
			want := str(v)
			if field.kind == "boolean" {
				if boolean(v) {
					want = "true"
				} else {
					want = "false"
				}
			}
			if field.value != want {
				t.Fatalf("wrong persisted %s: %s", field.key, field.value)
			}
		}
	}
	if !bytes.Contains(candidate, []byte("password = , // Leave blank for no password")) {
		t.Fatal("private bytes changed")
	}
	view = asMap(infraExpect(t, mux, admin, "GET", route, nil, 200)["attributes"])
	for _, invalid := range []M{{"password": "x"}, {"unknown": "1"}, {"unloadLevelsCooldown": "1"}, {"logging": "yes"}, {"maxClientLatencySeconds": "2147483648"}} {
		infraExpect(t, mux, admin, "PUT", route, M{"revision": view["revision"], "settings": invalid}, 422)
	}
	reader, e := a.insert(ctx, "users", M{"uuid": newUUID(), "username": "necesse-reader", "email": "necesse-reader@example.invalid"})
	if e != nil {
		t.Fatal(e)
	}
	if _, e = a.insert(ctx, "subusers", M{"user_id": reader["id"], "server_id": s["id"], "permissions": []string{"file.read-content"}}); e != nil {
		t.Fatal(e)
	}
	infraExpect(t, mux, num(reader["id"]), "GET", route, nil, 200)
	infraExpect(t, mux, num(reader["id"]), "PUT", route, M{"revision": view["revision"], "settings": M{"slots": 7}}, 403)
	infraExpect(t, mux, admin, "PUT", route, M{"revision": "stale", "settings": M{"slots": 7}}, 409)
	f.mu.Lock()
	f.State = "running"
	f.mu.Unlock()
	infraExpect(t, mux, admin, "PUT", route, M{"revision": view["revision"], "settings": M{"slots": 7}}, 409)
	f.mu.Lock()
	f.State = "offline"
	f.Files["/.voltra/java_games_runtime.py"] = []byte("revoked")
	f.mu.Unlock()
	infraExpect(t, mux, admin, "GET", route, nil, 404)
}

// Exact publisher-generated SERVER defaults from the retained 1.3.3 JAR.
const necesseNativeSchemaFixture = "SERVER = {\n\tport = 14159, // [0 - 65535] Server default port\n\tslots = 10, // [1 - 250] Server default slots\n\tpassword = , // Leave blank for no password\n\tmaxClientLatencySeconds = 30,\n\tpauseWhenEmpty = true,\n\tstrictServerAuthority = false, // If true, server will be much more strict about what clients can do. It is strongly recommended to ONLY have this enabled if absolutely necessary\n\tlogging = true, // If true, will create log files for each server start\n\tlanguage = en,\n\tunloadLevelsCooldown = 30, // The number of seconds a level will stay loaded after the last player has left it\n\tdroppedItemsLifeMinutes = 0, // Minutes that dropped items will stay in the world. 0 or less for indefinite\n\tunloadSettlements = false, // If the server should unload player settlements or keep them loaded\n\tmaxSettlementsPerPlayer = -1, // The maximum amount of settlements per player. -1 or less means infinite\n\tmaxSettlersPerSettlement = -1, // The maximum amount of settlers per settlement. -1 or less means infinite\n\tzipSaves = true, // If true, will create new saves uncompressed\n\tMOTD =  // Message of the day\n}"

func TestNecesseEditableSpans(t *testing.T) {
	original := []byte(strings.ReplaceAll(necesseNativeSchemaFixture, "\n", "\r\n"))
	p, e := parseNecesseSettings(original)
	if e != nil {
		t.Fatal(e)
	}
	updates := map[string]string{"logging": "false", "strictServerAuthority": "true", "maxClientLatencySeconds": "31", "unloadLevelsCooldown": "32", "droppedItemsLifeMinutes": "-2", "unloadSettlements": "true", "maxSettlementsPerPlayer": "-2", "maxSettlersPerSettlement": "-3", "zipSaves": "false"}
	got, e := p.patch(updates)
	if e != nil {
		t.Fatal(e)
	}
	expected := string(original)
	for k, v := range updates {
		for _, f := range p.fields {
			if f.key == k {
				expected = strings.Replace(expected, k+" = "+f.value, k+" = "+v, 1)
			}
		}
	}
	if string(got) != expected {
		t.Fatal("non-value bytes changed")
	}
	t.Logf("candidate cfg bytes %d", len(got))
	if path := os.Getenv("WAVE466_CFG"); path != "" {
		input, e := os.ReadFile(os.Getenv("WAVE466_INPUT"))
		if e != nil {
			t.Fatal(e)
		}
		native, e := parseNecesseSettings(input)
		if e != nil {
			t.Fatal(e)
		}
		candidate, e := native.patch(updates)
		if e != nil {
			t.Fatal(e)
		}
		if e := os.WriteFile(path, candidate, 0600); e != nil {
			t.Fatal(e)
		}
	}
	for _, u := range []map[string]string{{"password": "x"}, {"unknown": "1"}, {"port": "3"}, {"slots": "3"}, {"pauseWhenEmpty": "false"}, {"logging": "TRUE"}, {"logging": "1"}, {"maxSettlementsPerPlayer": "2147483648"}, {"unloadLevelsCooldown": "1"}, {"maxClientLatencySeconds": "1.0"}} {
		if _, e := p.patch(u); e == nil {
			t.Fatalf("accepted %v", u)
		}
	}
	for _, bad := range []string{strings.Replace(necesseNativeSchemaFixture, "logging = true,", "logging = true", 1), strings.Replace(necesseNativeSchemaFixture, "password = ,", "password = {,", 1), "\ufeff" + necesseNativeSchemaFixture, necesseNativeSchemaFixture + "\nOTHER = {}", strings.Replace(necesseNativeSchemaFixture, "logging = true,", "logging = true,\nlogging = false,", 1)} {
		if _, e := parseNecesseSettings([]byte(bad)); e == nil {
			t.Fatal("accepted ambiguous cfg")
		}
	}
	absent, e := parseNecesseSettings([]byte("SERVER = {\nlogging = true\n}"))
	if e != nil {
		t.Fatal(e)
	}
	if _, e = absent.patch(map[string]string{"zipSaves": "false"}); e == nil {
		t.Fatal("insert allowed")
	}
	m := M{"key": "logging", "readonly": true}
	necesseSettingPresentation(m)
	if !boolean(m["readonly"]) {
		t.Fatal("permission readonly cleared")
	}
}

func TestNecesseNativeCooldownClampNoOp(t *testing.T) {
	for _, raw := range []string{"-2147483648", "0", "+0001"} {
		data := []byte(strings.Replace(necesseNativeSchemaFixture, "unloadLevelsCooldown = 30", "unloadLevelsCooldown = "+raw, 1))
		parsed, err := parseNecesseSettings(data)
		if err != nil {
			t.Fatal(raw, err)
		}
		found := false
		for _, field := range parsed.fields {
			if field.key == "unloadLevelsCooldown" {
				found = true
				if field.value != "2" {
					t.Fatal("wrong effective clamp", field.value)
				}
			}
		}
		if !found {
			t.Fatal("missing field")
		}
		result, err := parsed.patch(map[string]string{"unloadLevelsCooldown": "2"})
		if err != nil || !bytes.Equal(result, data) {
			t.Fatal("semantic no-op changed native bytes", err)
		}
		if _, err := parsed.patch(map[string]string{"unloadLevelsCooldown": "1"}); err == nil {
			t.Fatal("new below-minimum value accepted")
		}
	}
}
