package panel

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func TestSteamCatalogPalworldOriginalControls(t *testing.T) {
	for _, game := range []string{"palworld-native", "palworld-proton"} {
		config, err := steamCatalogParse(game, M{"ADMIN_PASSWORD": "fixture_admin", "SERVER_PASSWORD": "fixture_join", "ALLOW_CONNECT_PLATFORM": "Xbox", "SERVER_DESCRIPTION": "Description"}, 0)
		if err != nil {
			t.Fatal(err)
		}
		if config.Players != 32 || config.Values["ADMIN_PASSWORD"] != "" || config.Secrets["SERVER_PASSWORD"] != "fixture_join" {
			t.Fatal("Original defaults or secret storage changed")
		}
		patch, err := steamPalworldPatch(config, 8211, "127.0.0.1")
		if err != nil {
			t.Fatal(err)
		}
		if patch["CrossplayPlatforms"] != "(Xbox)" || patch["PublicIP"] != `"127.0.0.1"` || patch["RCONEnabled"] != "True" {
			t.Fatal("Publisher configuration mapping differs")
		}
		raw, err := quickPatchPalworld([]byte("[/Script/Pal.PalGameWorldSettings]\nOptionSettings=(CustomFuture=(A,B),ExpRate=2.0)\n"), patch)
		if err != nil || !strings.Contains(string(raw), "CustomFuture=(A,B)") {
			t.Fatal("Unknown native control lost")
		}
		for key, value := range (M{"ADMIN_PASSWORD": "invalid space", "ALLOW_CONNECT_PLATFORM": "Other", "SERVER_NAME": strings.Repeat("x", 65), "RCON_ENABLE": "False"}) {
			input := M{"ADMIN_PASSWORD": "fixture_admin"}
			input[key] = value
			if _, err = steamCatalogParse(game, input, 0); err == nil {
				t.Fatalf("Accepted invalid %s", key)
			}
		}
	}
	legacy, _ := steamGameSpecFor("palworld")
	native, _ := steamGameSpecFor("palworld-native")
	proton, _ := steamGameSpecFor("palworld-proton")
	if legacy.Players != 16 || native.Players != 32 || proton.UnavailableReason != "" {
		t.Fatal("Legacy/native defaults or reviewed public Proton availability changed")
	}
}
func TestSteamCatalogPalworldSecretsAndQuickSetup(t *testing.T) {
	a, mux, admin, node, f := steamGamesFixture(t)
	ctx := context.Background()
	input := steamGamesInput("palworld-native", node)
	input["server_password"] = "fixture_join"
	response := infraExpect(t, mux, admin, "POST", "/api/client/game-library/steam/palworld-native/install", input, 201)
	server, err := a.one(ctx, "SELECT * FROM servers WHERE uuid_short=$1", asMap(response["attributes"])["identifier"])
	if err != nil {
		t.Fatal(err)
	}
	state, err := a.one(ctx, "SELECT * FROM steam_servers WHERE server_id=$1", server["id"])
	if err != nil {
		t.Fatal(err)
	}
	for _, column := range []string{"console_password_encrypted", "join_password_encrypted"} {
		if !strings.HasPrefix(str(state[column]), "enc:v1:") {
			t.Fatal("Credential not encrypted")
		}
	}
	encoded, _ := json.Marshal(response)
	if strings.Contains(string(encoded), "fixture_admin") || strings.Contains(string(encoded), "fixture_join") {
		t.Fatal("Response exposed credential")
	}
	a.exec(ctx, "UPDATE steam_jobs SET status='completed' WHERE server_id=$1", server["id"])
	a.exec(ctx, "UPDATE servers SET status=NULL WHERE id=$1", server["id"])
	a.exec(ctx, "UPDATE steam_servers SET initialized=true WHERE server_id=$1", server["id"])
	f.Files["/DefaultPalWorldSettings.ini"] = []byte("[/Script/Pal.PalGameWorldSettings]\nOptionSettings=(CustomFuture=(A,B),ExpRate=1.0)\n")
	if err = a.steamPalworldAfterInstall(ctx, server, M{"managed_variant": "palworld-native"}); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(f.Files[palworldSettingsPath]), "ServerPlayerMaxNum=32") || !strings.Contains(string(f.Files[palworldSettingsPath]), "RCONEnabled=True") || len(f.Files["/.voltra/palworld-start.sh"]) == 0 {
		t.Fatal("Initial managed native preparation missing")
	}
	f.Files[palworldSettingsPath] = []byte("[/Script/Pal.PalGameWorldSettings]\nOptionSettings=(ServerName=\"Initial\",AdminPassword=\"fixture_admin\",ServerPassword=\"fixture_join\",ExpRate=1.0,CustomFuture=(A,B))\n")
	base := "/api/client/servers/" + str(server["uuid_short"]) + "/quick-setup"
	view := asMap(infraExpect(t, mux, admin, "GET", base, nil, 200)["attributes"])
	encodedView, _ := json.Marshal(view)
	if strings.Contains(string(encodedView), "fixture_admin") || strings.Contains(string(encodedView), "fixture_join") {
		t.Fatal("Quick setup exposed a native credential")
	}
	for _, raw := range asSlice(view["fields"]) {
		field := asMap(raw)
		if boolean(field["secret"]) && (field["value"] != nil || !boolean(field["configured"])) {
			t.Fatal("Masked Quick setup credential state missing")
		}
	}

	infraExpect(t, mux, admin, "PUT", base, M{"revision": view["revision"], "settings": M{"AdminPassword": "updated_admin", "ServerPassword": "updated_join", "ExpRate": 2}}, 200)
	state, err = a.one(ctx, "SELECT * FROM steam_servers WHERE server_id=$1", server["id"])
	if err != nil {
		t.Fatal(err)
	}
	for column, want := range map[string]string{"console_password_encrypted": "updated_admin", "join_password_encrypted": "updated_join"} {
		value, err := a.unseal(str(state[column]))
		if err != nil || value != want {
			t.Fatal("Quick setup credential store drifted")
		}
	}
	if !strings.Contains(string(f.Files[palworldSettingsPath]), "CustomFuture=(A,B)") || !strings.Contains(string(f.Files["/.voltra/palworld-console.json"]), "updated_admin") {
		t.Fatal("Quick setup native/private-console mapping lost")
	}
	infraExpect(t, mux, admin, "PUT", base, M{"revision": view["revision"], "settings": M{"AdminPassword": "stale_admin"}}, 409)
	current := asMap(infraExpect(t, mux, admin, "GET", base, nil, 200)["attributes"])
	clearView := asMap(infraExpect(t, mux, admin, "GET", base, nil, 200)["attributes"])
	infraExpect(t, mux, admin, "PUT", base, M{"revision": clearView["revision"], "settings": M{"ServerPassword": ""}}, 200)
	clearState, clearErr := a.one(ctx, "SELECT join_password_encrypted,console_password_encrypted FROM steam_servers WHERE server_id=$1", server["id"])
	if clearErr != nil || str(clearState["join_password_encrypted"]) != "" || str(clearState["console_password_encrypted"]) != str(state["console_password_encrypted"]) {
		t.Fatal("Explicit join clear changed untouched admin or retained join credential")
	}
	current = asMap(infraExpect(t, mux, admin, "GET", base, nil, 200)["attributes"])
	infraExpect(t, mux, admin, "PUT", base, M{"revision": current["revision"], "settings": M{"AdminPassword": ""}}, 422)
	beforeFile := string(f.Files[palworldSettingsPath])
	beforeSecret := str(state["console_password_encrypted"])
	infraExpect(t, mux, admin, "PUT", base, M{"revision": current["revision"], "settings": M{"AdminPassword": "invalid space"}}, 422)
	f.FailWriteOnce = "/.voltra/palworld-console.json"
	infraExpect(t, mux, admin, "PUT", base, M{"revision": current["revision"], "settings": M{"AdminPassword": "rollback_admin"}}, 502)
	after, err := a.one(ctx, "SELECT console_password_encrypted FROM steam_servers WHERE server_id=$1", server["id"])
	if err != nil || str(after["console_password_encrypted"]) != beforeSecret || string(f.Files[palworldSettingsPath]) != beforeFile {
		t.Fatal("Rejected/failed Quick setup partially mutated managed state")
	}

}

func TestSteamCatalogPalworldPrivateLauncher(t *testing.T) {
	artifact, err := steamCatalogConsoleArtifact("amd64")
	if err != nil {
		t.Fatal(err)
	}
	for game, seconds := range map[string]string{"palworld-native": "15", "palworld-proton": "5"} {
		raw, err := steamPalworldConsole(game, 25575, artifact)
		if err != nil {
			t.Fatal(err)
		}
		text := string(raw)
		if !strings.Contains(text, `while IFS= read -r command`) || !strings.Contains(text, `palworld-console.json "$command" || true`) {
			t.Fatal("Each stdin command must use a new authenticated connection with its exact literal value")
		}
		if !strings.Contains(text, "Shutdown "+seconds) || !strings.Contains(text, "sha256sum -c") || strings.Contains(text, "ADMIN_PASSWORD") || strings.Contains(text, "SERVER_PASSWORD") {
			t.Fatal("Launcher lost original stop semantics/private credential boundary")
		}
	}
}
