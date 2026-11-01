package panel

import (
	"context"
	"io"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// Regression: the persisted per-server command can differ from the
// egg's canonical command. Discovery must follow the executable authority.
func TestETLegacyActualServerStartupAuthorityResume(t *testing.T) {
	a, mux, admin, server, fixture := quickSetupMinecraftFixture(t)
	egg := batchSettingsRecipeFixture(t, etlegacySettingsRecipe)
	if _, err := a.update(context.Background(), "eggs", num(server["egg_id"]), egg); err != nil {
		t.Fatal(err)
	}
	if _, err := a.update(context.Background(), "servers", num(server["id"]), M{"startup": str(egg["startup"])}); err != nil {
		t.Fatal(err)
	}
	fixture.mu.Lock()
	delete(fixture.Files, "/server.properties")
	fixture.Files[etlegacySettingsPath] = []byte("set g_friendlyFire 1\n")
	fixture.State = "offline"
	fixture.mu.Unlock()
	route := "/api/client/servers/" + str(server["uuid_short"]) + "/game-settings?file=" + etlegacySettingsPath
	view := asMap(infraExpect(t, mux, admin, "GET", route, nil, 200)["attributes"])
	old := "exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/quake_family_runtime.py etlegacy"
	if _, err := a.update(context.Background(), "servers", num(server["id"]), M{"startup": old}); err != nil {
		t.Fatal(err)
	}
	infraExpect(t, mux, admin, "GET", route, nil, 404)
	infraExpect(t, mux, admin, "PUT", route, M{"revision": view["revision"], "settings": M{"g_friendlyfire": false}}, 404)
	fixture.mu.Lock()
	unchanged := string(fixture.Files[etlegacySettingsPath]) == "set g_friendlyFire 1\n"
	fixture.mu.Unlock()
	if !unchanged {
		t.Fatal("Rejected custom startup changed native bytes")
	}
	if _, err := a.update(context.Background(), "servers", num(server["id"]), M{"startup": str(egg["startup"])}); err != nil {
		t.Fatal(err)
	}
	infraExpect(t, mux, admin, "GET", route, nil, 200)
}

// Pause body decoding after admission so a concurrent startup change is
// deterministic, rather than relying on request timing.
type etlegacyPausedBody struct {
	io.Reader
	admitted chan struct{}
	resume   chan struct{}
}

func (b *etlegacyPausedBody) Read(p []byte) (int, error) {
	select {
	case <-b.admitted:
	default:
		close(b.admitted)
		<-b.resume
	}
	return b.Reader.Read(p)
}
func TestETLegacyStartupChangedDuringSave(t *testing.T) {
	a, mux, admin, server, fixture := quickSetupMinecraftFixture(t)
	egg := batchSettingsRecipeFixture(t, etlegacySettingsRecipe)
	ctx := context.Background()
	if _, err := a.update(ctx, "eggs", num(server["egg_id"]), egg); err != nil {
		t.Fatal(err)
	}
	if _, err := a.update(ctx, "servers", num(server["id"]), M{"startup": str(egg["startup"])}); err != nil {
		t.Fatal(err)
	}
	fixture.mu.Lock()
	delete(fixture.Files, "/server.properties")
	fixture.Files[etlegacySettingsPath] = []byte("set g_friendlyFire 1\n")
	fixture.State = "offline"
	fixture.mu.Unlock()
	route := "/api/client/servers/" + str(server["uuid_short"]) + "/game-settings?file=" + etlegacySettingsPath
	view := asMap(infraExpect(t, mux, admin, "GET", route, nil, 200)["attributes"])
	body := &etlegacyPausedBody{Reader: strings.NewReader(`{"revision":"` + str(view["revision"]) + `","settings":{"g_friendlyfire":false}}`), admitted: make(chan struct{}), resume: make(chan struct{})}
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
	if string(fixture.Files[etlegacySettingsPath]) != "set g_friendlyFire 1\n" {
		t.Fatal("startup changed during save mutated native bytes")
	}
}
