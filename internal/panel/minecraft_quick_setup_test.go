package panel

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestMinecraftQuickSetupSynchronizesStartupProperties(t *testing.T) {
	a, mux, admin, server, f := quickSetupMinecraftFixture(t)
	endpoint := "/api/client/servers/" + str(server["uuid_short"]) + "/quick-setup"
	base := a.HTTP.Transport
	if base == nil {
		base = http.DefaultTransport
	}
	syncs := 0
	a.HTTP.Transport = gameLibraryTransport(func(r *http.Request) (*http.Response, error) {
		if strings.HasSuffix(r.URL.Path, "/sync") {
			syncs++
			env, err := a.serverEnvironment(context.Background(), server)
			if err != nil || env["MAX_PLAYERS"] != "7" || env["GAME_MODE"] != "creative" || env["DIFFICULTY"] != "hard" {
				t.Errorf("Wings sync saw stale installation values: %v, %v", env, err)
			}
		}
		return base.RoundTrip(r)
	})
	view := asMap(infraExpect(t, mux, admin, "GET", endpoint, nil, 200)["attributes"])
	infraExpect(t, mux, admin, "PUT", endpoint, M{"revision": view["revision"], "settings": M{"max-players": 7, "gamemode": "creative", "difficulty": "hard", "motd": "Saved"}}, 200)
	if syncs != 1 {
		t.Fatalf("want one committed-environment sync, got %d", syncs)
	}
	f.mu.Lock()
	content := string(f.Files["/server.properties"])
	f.mu.Unlock()
	for _, expected := range []string{"max-players=7", "gamemode=creative", "difficulty=hard", "motd=Saved", "unknown-plugin-property=retained", "level-name=custom-world"} {
		if !strings.Contains(content, expected) {
			t.Fatalf("missing saved or preserved property %q", expected)
		}
	}
	// A file-only control must not rewrite unrelated startup state or force sync.
	view = asMap(infraExpect(t, mux, admin, "GET", endpoint, nil, 200)["attributes"])
	infraExpect(t, mux, admin, "PUT", endpoint, M{"revision": view["revision"], "settings": M{"pvp": false}}, 200)
	if syncs != 1 {
		t.Fatal("file-only setting unexpectedly synchronized startup variables")
	}
}

func TestMinecraftQuickSetupSyncFailureRestoresFileAndVariables(t *testing.T) {
	a, mux, admin, server, f := quickSetupMinecraftFixture(t)
	ctx := context.Background()
	if err := a.exec(ctx, `INSERT INTO server_variables(server_id,variable_id,variable_value) SELECT $1,id,'5' FROM egg_variables WHERE egg_id=$2 AND env_variable='MAX_PLAYERS'`, server["id"], server["egg_id"]); err != nil {
		t.Fatal(err)
	}
	original := string(f.Files["/server.properties"])
	base := a.HTTP.Transport
	if base == nil {
		base = http.DefaultTransport
	}
	syncs := 0
	a.HTTP.Transport = gameLibraryTransport(func(r *http.Request) (*http.Response, error) {
		if strings.HasSuffix(r.URL.Path, "/sync") {
			syncs++
			if syncs == 1 {
				return &http.Response{StatusCode: 503, Header: http.Header{}, Body: io.NopCloser(strings.NewReader("fixture sync failure")), Request: r}, nil
			}
		}
		return base.RoundTrip(r)
	})
	endpoint := "/api/client/servers/" + str(server["uuid_short"]) + "/quick-setup"
	view := asMap(infraExpect(t, mux, admin, "GET", endpoint, nil, 200)["attributes"])
	infraExpect(t, mux, admin, "PUT", endpoint, M{"revision": view["revision"], "settings": M{"max-players": 7, "gamemode": "creative"}}, 502)
	env, err := a.serverEnvironment(ctx, server)
	if err != nil || env["MAX_PLAYERS"] != "5" || env["GAME_MODE"] != "survival" {
		t.Fatalf("original variables were not restored: %v, %v", env, err)
	}
	f.mu.Lock()
	content := string(f.Files["/server.properties"])
	f.mu.Unlock()
	if content != original || syncs != 2 {
		t.Fatalf("failed sync did not restore the original file and resync: equal=%v, syncs=%d", content == original, syncs)
	}
}

func TestMinecraftQuickSetupPreservesAdministratorRules(t *testing.T) {
	for _, mode := range []string{"locked", "custom-mapping", "custom-validation"} {
		t.Run(mode, func(t *testing.T) {
			a, mux, admin, server, f := quickSetupMinecraftFixture(t)
			ctx := context.Background()
			var err error
			switch mode {
			case "locked":
				err = a.exec(ctx, "UPDATE egg_variables SET user_editable=false WHERE egg_id=$1 AND env_variable='MAX_PLAYERS'", server["egg_id"])
			case "custom-validation":
				err = a.exec(ctx, "UPDATE egg_variables SET rules='required|integer|min:10|max:200' WHERE egg_id=$1 AND env_variable='MAX_PLAYERS'", server["egg_id"])
			case "custom-mapping":
				err = a.exec(ctx, `UPDATE eggs SET config_files=jsonb_set(config_files,'{server.properties,find,max-players}','"{{server.build.env.ADMIN_LIMIT}}"') WHERE id=$1`, server["egg_id"])
			}
			if err != nil {
				t.Fatal(err)
			}
			endpoint := "/api/client/servers/" + str(server["uuid_short"]) + "/quick-setup"
			view := asMap(infraExpect(t, mux, admin, "GET", endpoint, nil, 200)["attributes"])
			infraExpect(t, mux, admin, "PUT", endpoint, M{"revision": view["revision"], "settings": M{"max-players": 7}}, 422)
			if f.Writes != 0 {
				t.Fatal("administrator-managed property was overwritten")
			}
		})
	}
}
