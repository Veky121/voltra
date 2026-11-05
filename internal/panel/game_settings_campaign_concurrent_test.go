package panel

import (
	"context"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestHL2DMStartupChangedDuringSave(t *testing.T) {
	a, mux, admin, server, fixture := quickSetupMinecraftFixture(t)
	egg := batchSettingsRecipeFixture(t, hl2dmSettingsRecipe)
	egg["java_config"] = M{}
	ctx := context.Background()
	if _, err := a.update(ctx, "eggs", num(server["egg_id"]), egg); err != nil {
		t.Fatal(err)
	}
	if _, err := a.update(ctx, "servers", num(server["id"]), M{"startup": str(egg["startup"])}); err != nil {
		t.Fatal(err)
	}
	hl2dmFixtureAllocation(t, a, server)
	fixture.mu.Lock()
	delete(fixture.Files, "/server.properties")
	hl2dmFixtureHelpers(t, fixture)
	fixture.Files[hl2dmSettingsPath] = []byte("mp_teamplay 1\n")
	fixture.State = "offline"
	fixture.mu.Unlock()
	route := "/api/client/servers/" + str(server["uuid_short"]) + "/game-settings?file=" + hl2dmSettingsPath
	view := asMap(infraExpect(t, mux, admin, "GET", route, nil, 200)["attributes"])
	body := &etlegacyPausedBody{Reader: strings.NewReader(`{"revision":"` + str(view["revision"]) + `","settings":{"mp_teamplay":false}}`), admitted: make(chan struct{}), resume: make(chan struct{})}
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
	if string(fixture.Files[hl2dmSettingsPath]) != "mp_teamplay 1\n" {
		t.Fatal("startup changed during save mutated native bytes")
	}
}
func TestQuakeLiveStartupChangedDuringSave(t *testing.T) {
	a, mux, admin, server, fixture := quickSetupMinecraftFixture(t)
	egg := batchSettingsRecipeFixture(t, quakeLiveSettingsRecipe)
	ctx := context.Background()
	if _, err := a.update(ctx, "eggs", num(server["egg_id"]), egg); err != nil {
		t.Fatal(err)
	}
	if _, err := a.update(ctx, "servers", num(server["id"]), M{"startup": str(egg["startup"])}); err != nil {
		t.Fatal(err)
	}
	fixture.mu.Lock()
	delete(fixture.Files, "/server.properties")
	fixture.Files[quakeLiveBaseSettingsPath] = []byte("set g_allowvote 1\n")
	fixture.State = "offline"
	fixture.mu.Unlock()
	route := "/api/client/servers/" + str(server["uuid_short"]) + "/game-settings?file=" + quakeLiveBaseSettingsPath
	view := asMap(infraExpect(t, mux, admin, "GET", route, nil, 200)["attributes"])
	body := &etlegacyPausedBody{Reader: strings.NewReader(`{"revision":"` + str(view["revision"]) + `","settings":{"g_allowvote":false}}`), admitted: make(chan struct{}), resume: make(chan struct{})}
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
	if string(fixture.Files[quakeLiveBaseSettingsPath]) != "set g_allowvote 1\n" {
		t.Fatal("startup changed during save mutated native bytes")
	}
}
func TestOpenRAStartupChangedDuringSave(t *testing.T) {
	a, mux, admin, server, fixture := quickSetupMinecraftFixture(t)
	egg := batchSettingsRecipeFixture(t, openraSettingsRecipe)
	ctx := context.Background()
	if _, err := a.update(ctx, "eggs", num(server["egg_id"]), egg); err != nil {
		t.Fatal(err)
	}
	if _, err := a.update(ctx, "servers", num(server["id"]), M{"startup": str(egg["startup"])}); err != nil {
		t.Fatal(err)
	}
	fixture.mu.Lock()
	delete(fixture.Files, "/server.properties")
	fixture.Files[openraSettingsPath] = []byte("Server:\n\tEnableVoteKick: true\n")
	fixture.State = "offline"
	fixture.mu.Unlock()
	route := "/api/client/servers/" + str(server["uuid_short"]) + "/game-settings?file=" + openraSettingsPath
	view := asMap(infraExpect(t, mux, admin, "GET", route, nil, 200)["attributes"])
	body := &etlegacyPausedBody{Reader: strings.NewReader(`{"revision":"` + str(view["revision"]) + `","settings":{"Server.EnableVoteKick":false}}`), admitted: make(chan struct{}), resume: make(chan struct{})}
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
	if string(fixture.Files[openraSettingsPath]) != "Server:\n\tEnableVoteKick: true\n" {
		t.Fatal("startup changed during save mutated native bytes")
	}
}
