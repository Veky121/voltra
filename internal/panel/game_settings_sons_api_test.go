package panel

import (
	"bytes"
	"context"
	"encoding/json"
	"testing"
)

func TestSonsSettingsAPIPrivacyAndGroups(t *testing.T) {
	a, mux, admin, server, fixture := quickSetupMinecraftFixture(t)
	egg := batchSettingsRecipeFixture(t, sonsSettingsRecipe)
	ctx := context.Background()
	if _, err := a.update(ctx, "eggs", num(server["egg_id"]), egg); err != nil {
		t.Fatal(err)
	}
	if _, err := a.update(ctx, "servers", num(server["id"]), M{"startup": egg["startup"]}); err != nil {
		t.Fatal(err)
	}
	original := []byte("\xef\xbb\xbf{\r\n\"ServerName\":\"operator\",\"Password\":\"private-password\",\"LanOnly\":false,\"SaveMode\":\"continue\",\"GamePort\":8766,\"Unknown\":123456789012345678901234567890,\"GameSettings\":{\"token\":\"nested-private\"}\r\n}\r\n")
	fixture.mu.Lock()
	delete(fixture.Files, "/server.properties")
	fixture.Files[sonsSettingsPath], fixture.State = original, "offline"
	fixture.mu.Unlock()
	route := "/api/client/servers/" + str(server["uuid_short"]) + "/game-settings?file=" + sonsSettingsPath
	view := asMap(infraExpect(t, mux, admin, "GET", route, nil, 200)["attributes"])
	encoded, _ := json.Marshal(view)
	if bytes.Contains(encoded, []byte("private-password")) || bytes.Contains(encoded, []byte("nested-private")) {
		t.Fatal("native secrets leaked")
	}
	fields := map[string]M{}
	for _, raw := range asSlice(view["fields"]) {
		f := asMap(raw)
		fields[str(f["key"])] = f
	}
	if !boolean(fields["/Password"]["secret"]) || !boolean(fields["/Password"]["configured"]) || fields["/Password"]["value"] != nil {
		t.Fatal("password not masked")
	}
	if fields["/LanOnly"]["type"] != "boolean" || fields["/LanOnly"]["group"] != "General" {
		t.Fatal("boolean presentation missing")
	}
	if fields["/SaveMode"]["type"] != "select" || fields["/SaveInterval"]["group"] != "World and saves" {
		t.Fatal("save settings presentation missing")
	}
	if _, exposed := fields["/GamePort"]; exposed {
		t.Fatal("allocation-owned port exposed")
	}
	fixture.mu.Lock()
	unchanged := bytes.Equal(original, fixture.Files[sonsSettingsPath])
	fixture.mu.Unlock()
	if !unchanged {
		t.Fatal("read inserted defaults")
	}
	infraExpect(t, mux, admin, "PUT", route, M{"revision": view["revision"], "settings": M{"/GamePort": "9999"}}, 422)
	infraExpect(t, mux, admin, "PUT", route, M{"revision": view["revision"], "settings": M{"/MaxPlayers": "9"}}, 422)
	fixture.mu.Lock()
	unchanged = bytes.Equal(original, fixture.Files[sonsSettingsPath])
	fixture.mu.Unlock()
	if !unchanged {
		t.Fatal("invalid patch changed native bytes")
	}
	infraExpect(t, mux, admin, "PUT", route, M{"revision": view["revision"], "settings": M{"/ServerName": "changed", "/SaveInterval": "300"}}, 200)
	fixture.mu.Lock()
	after := append([]byte(nil), fixture.Files[sonsSettingsPath]...)
	fixture.mu.Unlock()
	for _, retained := range []string{`"Password":"private-password"`, `"Unknown":123456789012345678901234567890`, `"GameSettings":{"token":"nested-private"}`} {
		if !bytes.Contains(after, []byte(retained)) {
			t.Fatal("lost opaque native bytes")
		}
	}
	if !bytes.HasPrefix(after, []byte{0xef, 0xbb, 0xbf}) || !json.Valid(after[3:]) {
		t.Fatal("invalid saved JSON")
	}
}
