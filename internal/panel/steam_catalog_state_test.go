package panel

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

// These are API/database fixtures using an isolated infraTestApp schema and
// fake Wings, not native game or SteamCMD acceptance.
func TestSteamCatalogBridgeConsoleSecretAtRestAndAPI(t *testing.T) {
	a, mux, admin, node, f := steamGamesFixture(t)
	for _, port := range []int{7778, 7779, 7780} {
		if _, err := a.insert(context.Background(), "allocations", M{"node_id": node["id"], "ip": "127.0.0.1", "port": port}); err != nil {
			t.Fatal(err)
		}
	}
	mux.HandleFunc("GET /api/client/servers/{server}/startup", a.clientStartup)
	mux.HandleFunc("PUT /api/client/servers/{server}/startup/variable", a.clientStartup)
	a.registerSteam(mux)
	secret := "+fixture \"private\" \\ +quit λé"
	input := steamGamesInput("7days", node)
	input["environment"] = M{"PASSWORD": " invalid-fixture"}
	infraExpect(t, mux, admin, "POST", "/api/client/game-library/steam/7days/install", input, 422)
	count, countErr := a.one(context.Background(), "SELECT count(*) AS total FROM servers")
	if countErr != nil || num(count["total"]) != 0 || f.Creates != 0 {
		t.Fatal("Rejected setup partially provisioned a server")
	}
	input["environment"] = M{"PASSWORD": secret, "TELNET_PORT": "9081", "GAME_DIFFICULTY": "4", "SRCDS_BETAID": "", "SERVER_DISABLED_NETWORK_PROTOCOLS": ""}
	installed := infraExpect(t, mux, admin, "POST", "/api/client/game-library/steam/7days/install", input, 201)
	server, err := a.one(context.Background(), "SELECT * FROM servers WHERE uuid_short=$1", asMap(installed["attributes"])["identifier"])
	if err != nil {
		t.Fatal(err)
	}
	state, err := a.one(context.Background(), "SELECT * FROM steam_servers WHERE server_id=$1", server["id"])
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(str(state["console_password_encrypted"]), "enc:v1:") {
		t.Fatal("Console credential was not encrypted")
	}
	decoded, err := a.unseal(str(state["console_password_encrypted"]))
	if err != nil || decoded != secret {
		t.Fatal("Opaque console credential changed during setup")
	}
	variables, err := a.query(context.Background(), "SELECT variable_value FROM server_variables WHERE server_id=$1", server["id"])
	if err != nil {
		t.Fatal(err)
	}
	for _, variable := range variables {
		if strings.Contains(str(variable["variable_value"]), "fixture") {
			t.Fatal("Credential entered ordinary variables")
		}
	}
	base := "/api/client/servers/" + str(server["uuid_short"])
	if err = a.exec(context.Background(), "UPDATE servers SET status=NULL WHERE id=$1", server["id"]); err != nil {
		t.Fatal(err)
	}
	for _, endpoint := range []string{"/startup", "/steam"} {
		response := infraExpect(t, mux, admin, "GET", base+endpoint, nil, 200)
		encoded, _ := json.Marshal(response)
		if strings.Contains(string(encoded), "fixture ") || strings.Contains(string(encoded), "enc:v1:") {
			t.Fatal("API exposed credential material")
		}
	}
	if err = a.exec(context.Background(), "UPDATE steam_jobs SET status='completed' WHERE server_id=$1", server["id"]); err != nil {
		t.Fatal(err)
	}
	if err = a.exec(context.Background(), "UPDATE servers SET status=NULL WHERE id=$1", server["id"]); err != nil {
		t.Fatal(err)
	}
	unchanged := str(state["console_password_encrypted"])
	f.mu.Lock()
	writesBeforeRejection := f.Writes
	f.mu.Unlock()
	for _, invalid := range []string{" leading-private", "trailing-private "} {
		response := infraExpect(t, mux, admin, "PUT", base+"/startup/variable", M{"key": "PASSWORD", "value": invalid}, 422)
		encoded, _ := json.Marshal(response)
		if strings.Contains(string(encoded), invalid) {
			t.Fatal("Rejected credential leaked")
		}
		after, readErr := a.one(context.Background(), "SELECT * FROM steam_servers WHERE server_id=$1", server["id"])
		if readErr != nil || str(after["console_password_encrypted"]) != unchanged {
			t.Fatal("Rejected credential partially changed settings")
		}
		f.mu.Lock()
		writesAfterRejection := f.Writes
		f.mu.Unlock()
		if writesAfterRejection != writesBeforeRejection {
			t.Fatal("Rejected credential wrote native files")
		}
	}
	next := "+replacement +quit \"opaque\" λé"
	infraExpect(t, mux, admin, "PUT", base+"/startup/variable", M{"key": "PASSWORD", "value": next}, 200)
	state, err = a.one(context.Background(), "SELECT * FROM steam_servers WHERE server_id=$1", server["id"])
	if err != nil {
		t.Fatal(err)
	}
	decoded, err = a.unseal(str(state["console_password_encrypted"]))
	if err != nil || decoded != next {
		t.Fatal("Startup API changed opaque console credential")
	}
	configuration, err := a.serverConfig(context.Background(), server)
	if err != nil {
		t.Fatal(err)
	}
	environment := asMap(configuration["environment"])
	if _, exists := environment["PASSWORD"]; exists {
		t.Fatal("Credential entered Docker environment")
	}
	if str(environment["AUTO_UPDATE"]) != "0" {
		t.Fatal("Image updater remained enabled")
	}
	logs, err := a.query(context.Background(), "SELECT properties FROM activity_logs WHERE server_id=$1", server["id"])
	if err != nil {
		t.Fatal(err)
	}
	encodedLogs, _ := json.Marshal(logs)
	if strings.Contains(string(encodedLogs), "replacement") || strings.Contains(string(encodedLogs), "private") || strings.Contains(string(encodedLogs), "enc:v1:") {
		t.Fatal("Credential material entered activity logs")
	}
}

func TestSteamCatalogBridgeSettingsAtomicAndPrivateFailClosed(t *testing.T) {
	a, mux, admin, node, f := steamGamesFixture(t)
	a.registerSteam(mux)
	ctx := context.Background()
	input := steamGamesInput("satisfactory", node)
	input["environment"] = M{"RELIABLE_PORT": "9001", "VALIDATE": "1", "NUM_AUTOSAVES": "7"}
	installed := infraExpect(t, mux, admin, "POST", "/api/client/game-library/steam/satisfactory/install", input, 201)
	server, err := a.one(ctx, "SELECT * FROM servers WHERE uuid_short=$1", asMap(installed["attributes"])["identifier"])
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(str(server["startup"]), "-ReliablePort=9001 -ExternalReliablePort=9001") {
		t.Fatal("Requested reliable allocation was not used")
	}
	if err = a.exec(ctx, "UPDATE servers SET status=NULL WHERE id=$1", server["id"]); err != nil {
		t.Fatal(err)
	}
	endpoint := "/api/client/servers/" + str(server["uuid_short"]) + "/steam"
	// An active maintenance job rejects all settings in this request together.
	infraExpect(t, mux, admin, "PATCH", endpoint, M{"mode": "off", "environment": M{"NUM_AUTOSAVES": "8"}}, 409)
	state, _ := a.one(ctx, "SELECT * FROM steam_servers WHERE server_id=$1", server["id"])
	if str(state["mode"]) != "on_start" {
		t.Fatal("Rejected control update partially changed mode")
	}
	if err = a.exec(ctx, "UPDATE steam_jobs SET status='completed' WHERE server_id=$1", server["id"]); err != nil {
		t.Fatal(err)
	}
	infraExpect(t, mux, admin, "PATCH", endpoint, M{"mode": "off", "check_interval_seconds": 600, "branch": "experimental", "validate_on_start": false, "environment": M{"NUM_AUTOSAVES": "8", "RELIABLE_PORT": "0"}}, 200)
	state, _ = a.one(ctx, "SELECT * FROM steam_servers WHERE server_id=$1", server["id"])
	if str(state["branch"]) != "experimental" || str(state["mode"]) != "off" || boolean(state["validate_on_start"]) || !boolean(state["needs_repair"]) || num(state["check_interval_seconds"]) != 600 {
		t.Fatal("Typed advanced settings did not commit together")
	}
	infraExpect(t, mux, admin, "PATCH", endpoint, M{"mode": "scheduled", "beta_password": "  fake +quit \"secret\"  "}, 409)
	state, _ = a.one(ctx, "SELECT * FROM steam_servers WHERE server_id=$1", server["id"])
	if str(state["mode"]) != "off" || str(state["beta_password_encrypted"]) != "" {
		t.Fatal("Unavailable private beta partially changed settings")
	}
	f.mu.Lock()
	f.State = "running"
	f.mu.Unlock()
	infraExpect(t, mux, admin, "PATCH", endpoint, M{"environment": M{"NUM_AUTOSAVES": "9"}}, 409)
}

func TestSteamCatalogBridgeCommitFailureRestoresNativeConfiguration(t *testing.T) {
	a, mux, admin, node, f := steamGamesFixture(t)
	ctx := context.Background()
	installed := infraExpect(t, mux, admin, "POST", "/api/client/game-library/steam/satisfactory/install", steamGamesInput("satisfactory", node), 201)
	server, err := a.one(ctx, "SELECT * FROM servers WHERE uuid_short=$1", asMap(installed["attributes"])["identifier"])
	if err != nil {
		t.Fatal(err)
	}
	for _, statement := range []string{"UPDATE servers SET status=NULL", "UPDATE steam_jobs SET status='completed'", "UPDATE steam_servers SET initialized=true"} {
		if err = a.exec(ctx, statement); err != nil {
			t.Fatal(err)
		}
	}
	file := "/FactoryGame/Saved/Config/LinuxServer/Engine.ini"
	before := "; keep this exact native configuration\n[/Script/FactoryGame.FGSaveSession]\nmNumRotatingAutosaves=3\nFutureValue=untouched\n"
	f.mu.Lock()
	f.Files[file] = []byte(before)
	f.mu.Unlock()
	// A deferred constraint fails after native writes, exactly at COMMIT. The
	// entire DDL and fixture data live in infraTestApp's disposable schema.
	if err = a.exec(ctx, `CREATE FUNCTION reject_bridge_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture commit rejection'; END $$`); err != nil {
		t.Fatal(err)
	}
	if err = a.exec(ctx, `CREATE CONSTRAINT TRIGGER reject_bridge_commit AFTER UPDATE ON steam_servers DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION reject_bridge_commit()`); err != nil {
		t.Fatal(err)
	}
	handled, err := a.steamCatalogUpdateControls(ctx, server, M{"NUM_AUTOSAVES": "8"})
	if !handled || err == nil {
		t.Fatal("Deferred fixture constraint did not reject commit")
	}
	f.mu.Lock()
	after := string(f.Files[file])
	writes := f.Writes
	f.mu.Unlock()
	if after != before || writes != 2 {
		t.Fatal("Failed DB commit left native configuration changed")
	}
	configuration, _, err := a.steamCatalogLoad(ctx, server)
	if err != nil || str(configuration.Values["NUM_AUTOSAVES"]) != "3" {
		t.Fatal("Failed commit persisted requested controls")
	}
}

func TestSteamCatalogBridgePartialWriteRestoresOriginal(t *testing.T) {
	a, mux, admin, node, f := steamGamesFixture(t)
	ctx := context.Background()
	installed := infraExpect(t, mux, admin, "POST", "/api/client/game-library/steam/satisfactory/install", steamGamesInput("satisfactory", node), 201)
	server, err := a.one(ctx, "SELECT * FROM servers WHERE uuid_short=$1", asMap(installed["attributes"])["identifier"])
	if err != nil {
		t.Fatal(err)
	}
	for _, statement := range []string{"UPDATE servers SET status=NULL", "UPDATE steam_jobs SET status='completed'", "UPDATE steam_servers SET initialized=true"} {
		if err = a.exec(ctx, statement); err != nil {
			t.Fatal(err)
		}
	}
	file := "/FactoryGame/Saved/Config/LinuxServer/Engine.ini"
	before := "; operator value\n[/Script/FactoryGame.FGSaveSession]\nmNumRotatingAutosaves=3\nFutureValue=keep\n"
	f.mu.Lock()
	f.Files[file] = []byte(before)
	f.FailWriteOnce = file
	f.mu.Unlock()
	handled, err := a.steamCatalogUpdateControls(ctx, server, M{"NUM_AUTOSAVES": "8"})
	if !handled || err == nil {
		t.Fatal("Fixture partial write did not reject the edit")
	}
	f.mu.Lock()
	after := string(f.Files[file])
	f.mu.Unlock()
	if after != before {
		t.Fatal("Partially written native file was not restored")
	}
	configuration, _, err := a.steamCatalogLoad(ctx, server)
	if err != nil || str(configuration.Values["NUM_AUTOSAVES"]) != "3" {
		t.Fatal("Failed native write persisted control changes")
	}
}

func TestSteamCatalogBridgeFailedNewFileRestoresAbsence(t *testing.T) {
	a, mux, admin, node, f := steamGamesFixture(t)
	ctx := context.Background()
	installed := infraExpect(t, mux, admin, "POST", "/api/client/game-library/steam/satisfactory/install", steamGamesInput("satisfactory", node), 201)
	server, err := a.one(ctx, "SELECT * FROM servers WHERE uuid_short=$1", asMap(installed["attributes"])["identifier"])
	if err != nil {
		t.Fatal(err)
	}
	for _, statement := range []string{"UPDATE servers SET status=NULL", "UPDATE steam_jobs SET status='completed'", "UPDATE steam_servers SET initialized=true"} {
		if err = a.exec(ctx, statement); err != nil {
			t.Fatal(err)
		}
	}
	file := "/FactoryGame/Saved/Config/LinuxServer/Engine.ini"
	f.mu.Lock()
	f.Folders["/FactoryGame"] = []M{}
	f.FailWriteOnce = file
	f.mu.Unlock()
	handled, err := a.steamCatalogUpdateControls(ctx, server, M{"NUM_AUTOSAVES": "8"})
	if !handled || err == nil {
		t.Fatal("Fixture new-file partial write did not reject the edit")
	}
	f.mu.Lock()
	_, exists := f.Files[file]
	f.mu.Unlock()
	if exists {
		t.Fatal("Rollback left an empty or partial replacement for a previously absent file")
	}
}
