package panel

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestSettingsIntegrationDDNetAPI(t *testing.T) {
	a, mux, admin, server, fixture := quickSetupMinecraftFixture(t)
	var egg M
	for _, entry := range gameTemplates().Entries {
		if entry.Path == "ddnet/egg-d-d-net.json" {
			egg = M{"uuid": gameTemplateEggUUID(entry), "startup": entry.Egg["startup"]}
		}
	}
	if egg == nil {
		t.Fatal("missing original DDNet recipe")
	}
	egg["config_files"] = M{}
	if _, err := a.update(context.Background(), "eggs", num(server["egg_id"]), egg); err != nil {
		t.Fatal(err)
	}
	if _, err := a.update(context.Background(), "servers", num(server["id"]), M{"startup": egg["startup"]}); err != nil {
		t.Fatal(err)
	}
	fixture.mu.Lock()
	delete(fixture.Files, "/server.properties")
	fixture.Files[ddnetSettingsPath], fixture.State = []byte(ddnetOriginalSeed), "offline"
	fixture.mu.Unlock()
	endpoint := "/api/client/servers/" + str(server["uuid_short"]) + "/game-settings"
	view := asMap(infraExpect(t, mux, admin, "GET", endpoint, nil, 200)["attributes"])
	if view["file"] != ddnetSettingsPath || len(asSlice(view["fields"])) != 6 {
		t.Fatal("root command document not discovered or specialized parser missing")
	}
	reader, err := a.insert(context.Background(), "users", M{"uuid": newUUID(), "username": "settings-reader", "email": "settings-reader@example.invalid"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = a.insert(context.Background(), "subusers", M{"user_id": reader["id"], "server_id": server["id"], "permissions": []string{"file.read-content"}}); err != nil {
		t.Fatal(err)
	}
	infraExpect(t, mux, num(reader["id"]), "GET", endpoint, nil, 200)
	infraExpect(t, mux, num(reader["id"]), "PUT", endpoint, M{"revision": view["revision"], "settings": M{"sv_name": "Rejected"}}, 403)
	encoded, _ := json.Marshal(view)
	if strings.Contains(string(encoded), "private-player") || strings.Contains(string(encoded), "private-rcon") {
		t.Fatal("credentials exposed")
	}
	infraExpect(t, mux, admin, "PUT", endpoint, M{"revision": "stale", "settings": M{"sv_name": "Rejected"}}, 409)
	fixture.mu.Lock()
	fixture.State = "running"
	fixture.mu.Unlock()
	infraExpect(t, mux, admin, "PUT", endpoint, M{"revision": view["revision"], "settings": M{"sv_name": "Rejected"}}, 409)
	fixture.mu.Lock()
	fixture.State = "offline"
	fixture.mu.Unlock()
	infraExpect(t, mux, admin, "PUT", endpoint, M{"file": ddnetSettingsPath, "revision": view["revision"], "settings": M{"sv_name": "Updated", "sv_register": true}}, 200)
	fixture.mu.Lock()
	updated := string(fixture.Files[ddnetSettingsPath])
	fixture.mu.Unlock()
	expected := strings.Replace(strings.Replace(ddnetOriginalSeed, `"Original"`, `"Updated"`, 1), "sv_register 0", `sv_register "1"`, 1)
	if updated != expected {
		t.Fatal("base exec, secrets or unrelated bytes changed")
	}
}

func TestSettingsIntegrationDDNetStartupDrift(t *testing.T) {
	a, mux, admin, server, fixture := quickSetupMinecraftFixture(t)
	egg := batchSettingsRecipeFixture(t, "ddnet/egg-d-d-net.json")
	ctx := context.Background()
	if _, err := a.update(ctx, "eggs", num(server["egg_id"]), egg); err != nil {
		t.Fatal(err)
	}
	if _, err := a.update(ctx, "servers", num(server["id"]), M{"startup": str(egg["startup"])}); err != nil {
		t.Fatal(err)
	}
	fixture.mu.Lock()
	delete(fixture.Files, "/server.properties")
	fixture.Files[ddnetSettingsPath] = []byte(ddnetOriginalSeed)
	fixture.State = "offline"
	fixture.mu.Unlock()
	route := "/api/client/servers/" + str(server["uuid_short"]) + "/game-settings?file=" + ddnetSettingsPath
	view := asMap(infraExpect(t, mux, admin, "GET", route, nil, 200)["attributes"])
	body := &etlegacyPausedBody{Reader: strings.NewReader(`{"revision":"` + str(view["revision"]) + `","settings":{"sv_name":"Rejected"}}`), admitted: make(chan struct{}), resume: make(chan struct{})}
	req := WithUser(httptest.NewRequest("PUT", route, body), admin)
	req.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	done := make(chan struct{})
	go func() { defer close(done); mux.ServeHTTP(recorder, req) }()
	select {
	case <-body.admitted:
	case <-time.After(5 * time.Second):
		close(body.resume)
		t.Fatal("save did not reach body decoding")
	}
	_, err := a.update(ctx, "servers", num(server["id"]), M{"startup": "./custom-launcher"})
	close(body.resume)
	if err != nil {
		t.Fatal(err)
	}
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("save did not finish")
	}
	if recorder.Code != 404 {
		t.Fatalf("changed startup save status=%d want=404", recorder.Code)
	}
	fixture.mu.Lock()
	defer fixture.mu.Unlock()
	if string(fixture.Files[ddnetSettingsPath]) != ddnetOriginalSeed {
		t.Fatal("startup changed during save mutated native bytes")
	}
}

func TestSettingsIntegrationUnprovedBootAuthority(t *testing.T) {
	for _, recipe := range []string{"starbound/egg-starbound.json", "squad/egg-squad.json", "truck-simulator/american-truck-simulator/egg-american-truck-simulator-dedicated-server.json", "truck-simulator/euro-truck-simulator2/egg-euro-truck-simulator2-dedicated-server.json"} {
		t.Run(recipe, func(t *testing.T) {
			a, mux, admin, server, _ := quickSetupMinecraftFixture(t)
			egg := batchSettingsRecipeFixture(t, recipe)
			// This is a non-Java launcher, not the Minecraft fixture's runtime.
			egg["java_config"] = M{}
			allocation, err := a.insert(context.Background(), "allocations", M{"node_id": server["node_id"], "server_id": server["id"], "ip": "127.0.0.1", "port": 29371})
			if err != nil {
				t.Fatal(err)
			}
			if _, err := a.update(context.Background(), "eggs", num(server["egg_id"]), egg); err != nil {
				t.Fatal(err)
			}
			if _, err := a.update(context.Background(), "servers", num(server["id"]), M{"startup": egg["startup"], "allocation_id": allocation["id"]}); err != nil {
				t.Fatal(err)
			}
			route := "/api/client/servers/" + str(server["uuid_short"]) + "/game-settings"
			infraExpect(t, mux, admin, "GET", route, nil, 404)
			infraExpect(t, mux, admin, "PUT", route, M{"settings": M{"unknown": "Rejected"}}, 404)
		})
	}
}
func TestSettingsIntegrationDDNetConfigDrift(t *testing.T) {
	a, mux, admin, server, fixture := quickSetupMinecraftFixture(t)
	egg := batchSettingsRecipeFixture(t, "ddnet/egg-d-d-net.json")
	ctx := context.Background()
	if _, err := a.update(ctx, "eggs", num(server["egg_id"]), egg); err != nil {
		t.Fatal(err)
	}
	if _, err := a.update(ctx, "servers", num(server["id"]), M{"startup": str(egg["startup"])}); err != nil {
		t.Fatal(err)
	}
	fixture.mu.Lock()
	delete(fixture.Files, "/server.properties")
	fixture.Files[ddnetSettingsPath] = []byte(ddnetOriginalSeed)
	fixture.State = "offline"
	fixture.mu.Unlock()
	route := "/api/client/servers/" + str(server["uuid_short"]) + "/game-settings?file=" + ddnetSettingsPath
	view := asMap(infraExpect(t, mux, admin, "GET", route, nil, 200)["attributes"])
	body := &etlegacyPausedBody{Reader: strings.NewReader(`{"revision":"` + str(view["revision"]) + `","settings":{"sv_name":"Rejected"}}`), admitted: make(chan struct{}), resume: make(chan struct{})}
	req := WithUser(httptest.NewRequest("PUT", route, body), admin)
	req.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	done := make(chan struct{})
	go func() { defer close(done); mux.ServeHTTP(recorder, req) }()
	select {
	case <-body.admitted:
	case <-time.After(5 * time.Second):
		close(body.resume)
		t.Fatal("save did not reach body decoding")
	}
	fixture.mu.Lock()
	delete(fixture.Files, ddnetSettingsPath)
	fixture.mu.Unlock()
	var err error
	close(body.resume)
	if err != nil {
		t.Fatal(err)
	}
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("save did not finish")
	}
	if recorder.Code != 409 {
		t.Fatalf("changed startup save status=%d want=404", recorder.Code)
	}
	fixture.mu.Lock()
	defer fixture.mu.Unlock()
	if len(fixture.Files[ddnetSettingsPath]) != 0 {
		t.Fatal("startup changed during save mutated native bytes")
	}
}
