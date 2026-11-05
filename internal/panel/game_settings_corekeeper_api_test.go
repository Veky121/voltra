package panel

import (
	"bytes"
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func TestCoreKeeperSettingsAPI(t *testing.T) {
	a, mux, admin, s, f := quickSetupMinecraftFixture(t)
	ctx := context.Background()
	hl2dmFixtureAllocation(t, a, s)
	egg := batchSettingsRecipeFixture(t, coreKeeperSettingsRecipe)
	egg["java_config"] = M{}
	if _, e := a.update(ctx, "eggs", num(s["egg_id"]), egg); e != nil {
		t.Fatal(e)
	}
	if _, e := a.update(ctx, "servers", num(s["id"]), M{"startup": egg["startup"]}); e != nil {
		t.Fatal(e)
	}
	original := []byte("{\r\n  \"gameId\":\"private-id\",\"password\":\"private-password\",\"worldSeed\":\"875047367409\",\"hashedWorldSeed\":3327892597,\"worldMode\":0,\"maxNumberPlayers\":8,\"unknown\":[1,2]\r\n}\r\n")
	f.mu.Lock()
	delete(f.Files, "/server.properties")
	f.Files[coreKeeperSettingsPath] = original
	f.State = "offline"
	for n, b := range wave46CanonicalHelpers(t, coreKeeperSettingsRecipe) {
		f.Files["/"+strings.TrimPrefix(n, "/")] = b
	}
	f.mu.Unlock()
	route := "/api/client/servers/" + str(s["uuid_short"]) + "/game-settings?file=" + coreKeeperSettingsPath
	get := func() M { return asMap(infraExpect(t, mux, admin, "GET", route, nil, 200)["attributes"]) }
	defaultView := asMap(infraExpect(t, mux, admin, "GET", "/api/client/servers/"+str(s["uuid_short"])+"/game-settings", nil, 200)["attributes"])
	if str(defaultView["file"]) != coreKeeperSettingsPath || len(asSlice(defaultView["fields"])) != 1 {
		t.Fatal("shared Game settings did not select the native document")
	}
	view := get()
	fields := asSlice(view["fields"])
	if len(fields) != 1 {
		t.Fatalf("expected one verified control: %v", fields)
	}
	field := asMap(fields[0])
	if str(field["label"]) != "Player limit" || num(field["min"]) != 1 || num(field["max"]) != 100 || boolean(field["readonly"]) {
		t.Fatalf("incorrect player control: %v", field)
	}
	encoded, _ := json.Marshal(view)
	if bytes.Contains(encoded, []byte("private-password")) || bytes.Contains(encoded, []byte("private-id")) {
		t.Fatal("private values exposed")
	}
	infraExpect(t, mux, admin, "PUT", route, M{"revision": view["revision"], "settings": M{"/maxNumberPlayers": "7"}}, 200)
	expected := bytes.Replace(original, []byte("Players\":8"), []byte("Players\":7"), 1)
	assertBytes := func() {
		t.Helper()
		f.mu.Lock()
		defer f.mu.Unlock()
		if !bytes.Equal(f.Files[coreKeeperSettingsPath], expected) {
			t.Fatal("unexpected file mutation")
		}
	}
	assertBytes()
	current := get()
	infraExpect(t, mux, admin, "PUT", route, M{"revision": view["revision"], "settings": M{"/maxNumberPlayers": "6"}}, 409)
	for _, settings := range []M{{"/maxNumberPlayers": "101"}, {"/maxNumberPlayers": "1.5"}, {"/password": "changed"}} {
		infraExpect(t, mux, admin, "PUT", route, M{"revision": current["revision"], "settings": settings}, 422)
		assertBytes()
	}
	reader, e := a.insert(ctx, "users", M{"uuid": newUUID(), "username": "keeper-reader", "email": "keeper-reader@example.invalid"})
	if e != nil {
		t.Fatal(e)
	}
	if _, e = a.insert(ctx, "subusers", M{"user_id": reader["id"], "server_id": s["id"], "permissions": []string{"file.read-content"}}); e != nil {
		t.Fatal(e)
	}
	infraExpect(t, mux, num(reader["id"]), "PUT", route, M{"revision": current["revision"], "settings": M{"/maxNumberPlayers": "6"}}, 403)
	f.mu.Lock()
	f.State = "running"
	f.mu.Unlock()
	infraExpect(t, mux, admin, "PUT", route, M{"revision": current["revision"], "settings": M{"/maxNumberPlayers": "6"}}, 409)
	f.mu.Lock()
	f.State = "offline"
	f.Files["/.voltra/core_keeper_runtime.py"] = []byte("revoked")
	f.mu.Unlock()
	infraExpect(t, mux, admin, "GET", route, nil, 404)
	assertBytes()
	if a.DB.Stat().AcquiredConns() != 0 {
		t.Fatal("fixture connection leaked")
	}
}

func TestCoreKeeperRefusesInvalidUTF8(t *testing.T) {
	data := append([]byte(`{"maxNumberPlayers":8,"unknown":"`), 0xff)
	data = append(data, []byte(`"}`)...)
	if _, e := parseCoreKeeperSettings(data); e == nil {
		t.Fatal("settings accepted bytes rejected by native runtime decoder")
	}
}
