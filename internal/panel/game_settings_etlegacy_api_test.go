package panel

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func TestETLegacyActualSettingsAPI(t *testing.T) {
	a, mux, admin, server, fixture := quickSetupMinecraftFixture(t)
	egg := batchSettingsRecipeFixture(t, etlegacySettingsRecipe)
	if _, e := a.update(context.Background(), "eggs", num(server["egg_id"]), egg); e != nil {
		t.Fatal(e)
	}
	if _, e := a.update(context.Background(), "servers", num(server["id"]), M{"startup": str(egg["startup"])}); e != nil {
		t.Fatal(e)
	}
	original := "// operator\r\nSeTa sv_hostname \"Private fixture host\"\r\nset g_friendlyFire \"1\"\r\nset g_password \"fixture-private-pass\"\r\nset rconpassword \"fixture-private-rcon\"\r\nset unknown \"preserve\"\r\n"
	fixture.mu.Lock()
	delete(fixture.Files, "/server.properties")
	fixture.Files[etlegacySettingsPath] = []byte(original)
	fixture.State = "offline"
	fixture.mu.Unlock()
	route := "/api/client/servers/" + str(server["uuid_short"]) + "/game-settings"
	view := asMap(infraExpect(t, mux, admin, "GET", route, nil, 200)["attributes"])
	if view["file"] != etlegacySettingsPath || laneGameSettingsField(view, "g_friendlyfire")["type"] != "boolean" {
		t.Fatal("Exact declaration/parser dispatch missing")
	}
	for _, key := range []string{"g_password", "rconpassword"} {
		f := laneGameSettingsField(view, key)
		if !boolean(f["secret"]) || f["value"] != nil {
			t.Fatalf("Credential unmasked %s", key)
		}
	}
	encoded, _ := json.Marshal(view)
	if strings.Contains(string(encoded), "fixture-private-") {
		t.Fatal("Private credential leaked")
	}
	infraExpect(t, mux, admin, "GET", route+"?file=/other/voltra-native.cfg", nil, 404)
	infraExpect(t, mux, admin, "PUT", route, M{"revision": view["revision"], "settings": M{"net_port": "29115"}}, 422)
	infraExpect(t, mux, admin, "PUT", route, M{"revision": view["revision"], "settings": M{"g_password": "secret\nquit"}}, 422)
	infraExpect(t, mux, admin, "PUT", route, M{"revision": view["revision"], "settings": M{"g_friendlyfire": "0"}}, 422)
	infraExpect(t, mux, admin, "PUT", route, M{"revision": view["revision"], "settings": M{"g_friendlyfire": false, "sv_hostname": "Updated host", "g_password": "fixture-next-pass"}}, 200)
	fixture.mu.Lock()
	after := string(fixture.Files[etlegacySettingsPath])
	fixture.mu.Unlock()
	want := strings.Replace(original, `sv_hostname "Private fixture host"`, `sv_hostname "Updated host"`, 1)
	want = strings.Replace(want, `g_friendlyFire "1"`, `g_friendlyFire "0"`, 1)
	want = strings.Replace(want, `g_password "fixture-private-pass"`, `g_password "fixture-next-pass"`, 1)
	if after != want {
		t.Fatalf("Native command bytes changed unexpectedly: %q", after)
	}
	infraExpect(t, mux, admin, "PUT", route, M{"revision": view["revision"], "settings": M{"g_friendlyfire": true}}, 409)
	fixture.mu.Lock()
	fixture.Files[etlegacySettingsPath] = []byte("set g_friendlyFire 1\nset \"g_friendlyFire\" 0\n")
	fixture.mu.Unlock()
	unsafe := asMap(infraExpect(t, mux, admin, "GET", route, nil, 200)["attributes"])
	if !boolean(laneGameSettingsField(unsafe, "g_friendlyfire")["readonly"]) {
		t.Fatal("Quoted setter document writable")
	}
	infraExpect(t, mux, admin, "PUT", route, M{"revision": unsafe["revision"], "settings": M{"g_friendlyfire": false}}, 422)
	fixture.mu.Lock()
	defer fixture.mu.Unlock()
	if string(fixture.Files[etlegacySettingsPath]) != "set g_friendlyFire 1\nset \"g_friendlyFire\" 0\n" {
		t.Fatal("Unsafe refusal changed bytes")
	}
}
