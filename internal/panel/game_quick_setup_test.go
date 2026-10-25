package panel

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"path"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestQuickSetupPropertiesPreserveUnknownAndEscapes(t *testing.T) {
	input := []byte("# retain comment\r\ncustom\\ key : line1\\\r\n  line2\r\nmotd=old\\u0020message\r\nmax-players=10\r\nmotd: last message\r\nunknown=end")
	patch, err := quickValidateSettings("minecraft", M{"motd": " Grüß 😀 ", "max-players": 20, "pvp": true})
	if err != nil {
		t.Fatal(err)
	}
	out, err := quickPatchProperties(input, patch)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(out), "custom\\ key : line1\\\r\n  line2\r\n") || !strings.Contains(string(out), "unknown=end") {
		t.Fatal("unknown properties were altered")
	}
	records, err := quickPropertyRecords(out)
	if err != nil {
		t.Fatal(err)
	}
	values := map[string]string{}
	motds := 0
	for _, record := range records {
		values[record.Key] = record.Value
		if record.Key == "motd" {
			motds++
		}
	}
	if values["motd"] != " Grüß 😀 " || values["custom key"] != "line1line2" || values["max-players"] != "20" || values["pvp"] != "true" || motds != 1 {
		t.Fatalf("invalid property round trip: %v", values)
	}
	if _, err = quickPropertyRecords([]byte(`motd=bad\uXXXZ`)); err == nil {
		t.Fatal("malformed Unicode escape accepted")
	}
	commented, err := quickPatchProperties([]byte("# comment ending with slash \\\nmotd=before\n"), map[string]string{"motd": "after"})
	if err != nil || string(commented) != "# comment ending with slash \\\nmotd=after\n" {
		t.Fatal("comment continuation consumed following property")
	}
}

func TestQuickSetupPalworldPreservesNestedAndQuotedUnknownSettings(t *testing.T) {
	input := []byte("; preserve native comments\r\n[/Other]\r\nOptionSettings=(Wrong=1)\r\n[/Script/Pal.PalGameWorldSettings]\r\nOptionSettings=(ServerName=\"Name, with (punctuation)\",ExpRate=1.0,CrossplayPlatforms=(Steam,Xbox,PS5,Mac),Future=(Name=\"x,y\",Values=(A,B)),ServerPassword=\"old\",ServerPassword=\"duplicate\")\r\nUnknownOther=value\r\n")
	patch, err := quickValidateSettings("palworld", M{"ServerName": `New "name", (friends)`, "ServerPassword": `safe\"quoted`, "ExpRate": 2.5, "bIsUseBackupSaveData": true})
	if err != nil {
		t.Fatal(err)
	}
	out, err := quickPatchPalworld(input, patch)
	if err != nil {
		t.Fatal(err)
	}
	for _, fragment := range []string{"; preserve native comments\r\n", "[/Other]\r\nOptionSettings=(Wrong=1)", "CrossplayPlatforms=(Steam,Xbox,PS5,Mac)", `Future=(Name="x,y",Values=(A,B))`, "UnknownOther=value\r\n"} {
		if !strings.Contains(string(out), fragment) {
			t.Fatalf("unknown settings changed: %s", fragment)
		}
	}
	_, values, err := quickPalworldOptions(out)
	if err != nil {
		t.Fatal(err)
	}
	if values["ServerName"] != `New "name", (friends)` || values["ServerPassword"] != `safe\"quoted` || values["ExpRate"] != "2.5" || strings.Count(string(out), "ServerPassword=") != 1 {
		t.Fatal("Palworld values did not round trip")
	}
	for _, bad := range []string{"OptionSettings=(ServerName=\"x\")", "[/Script/Pal.PalGameWorldSettings]\nOptionSettings=(Broken=\"unterminated)\n", "[/Script/Pal.PalGameWorldSettings]\nOptionSettings=(A=1)\nOptionSettings=(A=2)\n"} {
		if _, _, err := quickPalworldOptions([]byte(bad)); err == nil {
			t.Fatal("malformed/ambiguous configuration accepted")
		}
	}
}

func TestQuickSetupAllowlistAndValidation(t *testing.T) {
	for _, tc := range []struct {
		game     string
		settings M
	}{
		{"minecraft", M{"server-port": 9000}}, {"minecraft", M{"online-mode": false}}, {"minecraft", M{"view-distance": 1}}, {"minecraft", M{"max-players": 1.5}}, {"minecraft", M{"pvp": "true"}}, {"minecraft", M{"motd": "line\nbreak"}}, {"minecraft", M{"gamemode": "unknown"}},
		{"palworld", M{"RCONEnabled": true}}, {"palworld", M{"RESTAPIEnabled": true}}, {"palworld", M{"ExpRate": 0}}, {"palworld", M{"ServerPlayerMaxNum": 33}}, {"palworld", M{"ServerPassword": "bad\nOptionSettings="}}, {"palworld", M{"DeathPenalty": "anything"}}, {"satisfactory", M{"Session": "invented"}},
	} {
		if _, err := quickValidateSettings(tc.game, tc.settings); err == nil {
			t.Errorf("accepted %s settings %v", tc.game, tc.settings)
		}
	}
	if quickRevision("minecraft", "/server.properties", nil, false) == quickRevision("minecraft", "/server.properties", nil, true) {
		t.Fatal("missing and empty configs have equal revisions")
	}
}

func quickSetupMinecraftFixture(t *testing.T) (*App, *http.ServeMux, int64, M, *steamGamesWings) {
	t.Helper()
	a, mux, admin, node, f := steamGamesFixture(t)
	ctx := context.Background()
	egg, err := a.gameLibraryMinecraftEgg(ctx)
	if err != nil {
		t.Fatal(err)
	}
	// No Minecraft provisioning or installer is executed in this test.
	server, err := a.insert(ctx, "servers", M{"uuid": newUUID(), "uuid_short": randomToken(4), "identifier": randomToken(4), "name": "Quick setup fixture", "owner_id": admin, "node_id": node["id"], "nest_id": egg["nest_id"], "egg_id": egg["id"], "startup": "java -jar server.jar", "image": "fixture/java", "memory": 2048, "disk": 10240, "io": 500, "cpu": 100})
	if err != nil {
		t.Fatal(err)
	}
	f.Files["/server.properties"] = []byte("# fixture\nmotd=Before\nmax-players=10\npvp=true\nunknown-plugin-property=retained\nlevel-name=custom-world\n")
	f.Folders["/mods"] = []M{}
	f.Folders["/custom-world"] = []M{}
	return a, mux, admin, server, f
}

func TestQuickSetupPermissionsStoppedStateAndRevision(t *testing.T) {
	a, mux, admin, server, f := quickSetupMinecraftFixture(t)
	ctx := context.Background()
	endpoint := "/api/client/servers/" + str(server["uuid_short"]) + "/quick-setup"
	view := asMap(infraExpect(t, mux, admin, "GET", endpoint, nil, 200)["attributes"])
	if str(view["game"]) != "minecraft" || len(asSlice(view["fields"])) < 5 || len(asSlice(view["folders"])) != 2 {
		t.Fatal("Quick setup did not read native Minecraft config/folders")
	}
	revision := str(view["revision"])
	input := M{"revision": revision, "settings": M{"motd": "After", "max-players": 24}}
	f.mu.Lock()
	f.State = "running"
	f.mu.Unlock()
	infraExpect(t, mux, admin, "PUT", endpoint, input, 409)
	f.mu.Lock()
	f.State = "offline"
	f.Files["/server.properties"] = append(f.Files["/server.properties"], []byte("concurrent=value\n")...)
	f.mu.Unlock()
	infraExpect(t, mux, admin, "PUT", endpoint, input, 409)
	view = asMap(infraExpect(t, mux, admin, "GET", endpoint, nil, 200)["attributes"])
	input["revision"] = view["revision"]
	infraExpect(t, mux, admin, "PUT", endpoint, input, 200)
	f.mu.Lock()
	content := string(f.Files["/server.properties"])
	writes := f.Writes
	f.mu.Unlock()
	if !strings.Contains(content, "unknown-plugin-property=retained\n") || !strings.Contains(content, "concurrent=value\n") || !strings.Contains(content, "motd=After\n") || writes != 1 {
		t.Fatal("settings did not preserve unknown fields or stale/running writes escaped")
	}
	u, err := a.insert(ctx, "users", M{"uuid": newUUID(), "username": "quick-reader", "email": "quick-reader@example.invalid"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = a.insert(ctx, "subusers", M{"user_id": u["id"], "server_id": server["id"], "permissions": []string{"file.read-content"}}); err != nil {
		t.Fatal(err)
	}
	readOnly := asMap(infraExpect(t, mux, num(u["id"]), "GET", endpoint, nil, 200)["attributes"])
	if len(asSlice(readOnly["folders"])) != 0 {
		t.Fatal("folder paths disclosed without file.read")
	}
	infraExpect(t, mux, num(u["id"]), "PUT", endpoint, M{"revision": readOnly["revision"], "settings": M{"pvp": false}}, 403)
	if err = a.exec(ctx, "UPDATE subusers SET permissions=$1 WHERE server_id=$2", []string{"file.update"}, server["id"]); err != nil {
		t.Fatal(err)
	}
	infraExpect(t, mux, num(u["id"]), "GET", endpoint, nil, 403)
	infraExpect(t, mux, num(u["id"]), "PUT", endpoint, M{"revision": readOnly["revision"], "settings": M{"pvp": false}}, 403)
}

func TestQuickSetupMinecraftListingReuseIsViewScoped(t *testing.T) {
	a, mux, admin, server, f := quickSetupMinecraftFixture(t)
	transport := a.HTTP.Transport
	if transport == nil {
		transport = http.DefaultTransport
	}
	var requests []string
	a.HTTP.Transport = gameLibraryTransport(func(r *http.Request) (*http.Response, error) {
		requests = append(requests, r.URL.Path+"?"+r.URL.RawQuery)
		return transport.RoundTrip(r)
	})
	endpoint := "/api/client/servers/" + str(server["uuid_short"]) + "/quick-setup"
	view := asMap(infraExpect(t, mux, admin, "GET", endpoint, nil, 200)["attributes"])
	if len(requests) != 2 || !strings.Contains(requests[0], "list-directory?directory=%2F") || !strings.Contains(requests[1], "contents?file=%2Fserver.properties") {
		t.Fatalf("Minecraft settings should need just one root listing and one properties read: %v", requests)
	}
	if len(asSlice(view["folders"])) != 2 {
		t.Fatal("existing shortcuts were lost")
	}
	// A later visit must see external file/folder edits, not the previous view.
	f.mu.Lock()
	f.Files["/server.properties"] = []byte("motd=External edit\nlevel-name=new-world\n")
	delete(f.Folders, "/custom-world")
	f.Folders["/new-world"] = []M{}
	f.mu.Unlock()
	requests = nil
	next := asMap(infraExpect(t, mux, admin, "GET", endpoint, nil, 200)["attributes"])
	if len(requests) != 2 || str(next["revision"]) == str(view["revision"]) {
		t.Fatal("later view reused stale properties or made redundant requests")
	}
	folders, _ := json.Marshal(next["folders"])
	if strings.Contains(string(folders), "/custom-world") || !strings.Contains(string(folders), "/new-world") {
		t.Fatal("later view reused stale folder entries")
	}
}

func TestQuickSetupConcurrentWritesUseOneRevision(t *testing.T) {
	_, mux, admin, server, f := quickSetupMinecraftFixture(t)
	endpoint := "/api/client/servers/" + str(server["uuid_short"]) + "/quick-setup"
	view := asMap(infraExpect(t, mux, admin, "GET", endpoint, nil, 200)["attributes"])
	var wg sync.WaitGroup
	codes := make(chan int, 2)
	for _, motd := range []string{"A", "B"} {
		wg.Add(1)
		go func(value string) {
			defer wg.Done()
			code, _, _ := infraRequest(t, mux, admin, "PUT", endpoint, M{"revision": view["revision"], "settings": M{"motd": value}})
			codes <- code
		}(motd)
	}
	wg.Wait()
	close(codes)
	saved, conflicts := 0, 0
	for code := range codes {
		if code == 200 {
			saved++
		} else if code == 409 {
			conflicts++
		} else {
			t.Fatalf("unexpected status %d", code)
		}
	}
	f.mu.Lock()
	writes := f.Writes
	f.mu.Unlock()
	if saved != 1 || conflicts != 1 || writes != 1 {
		t.Fatal("concurrent writes did not enforce optimistic concurrency")
	}
}

func TestQuickSetupUsesSharedMutationLock(t *testing.T) {
	a, mux, admin, server, _ := quickSetupMinecraftFixture(t)
	ctx := context.Background()
	endpoint := "/api/client/servers/" + str(server["uuid_short"]) + "/quick-setup"
	view := asMap(infraExpect(t, mux, admin, "GET", endpoint, nil, 200)["attributes"])
	conn, err := a.DB.Acquire(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer steamUnlock(conn)
	key := "voltra:server-mutation:" + str(server["uuid"])
	if err = steamSessionLock(ctx, conn, key); err != nil {
		t.Fatal(err)
	}
	done := make(chan int, 1)
	go func() {
		code, _, _ := infraRequest(t, mux, admin, "PUT", endpoint, M{"revision": view["revision"], "settings": M{"pvp": false}})
		done <- code
	}()
	select {
	case <-done:
		t.Fatal("Quick setup bypassed shared power/Steam lock")
	case <-time.After(100 * time.Millisecond):
	}
	if _, err = conn.Exec(ctx, "SELECT pg_advisory_unlock(hashtextextended($1,0))", key); err != nil {
		t.Fatal(err)
	}
	select {
	case code := <-done:
		if code != 200 {
			t.Fatalf("save status %d", code)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("save did not resume after mutation lock release")
	}
}

func TestQuickSetupSatisfactoryDiscoversOnlyRealBlueprintSessions(t *testing.T) {
	a, mux, admin, node, f := steamGamesFixture(t)
	ctx := context.Background()
	input := steamGamesInput("satisfactory", node)
	result := asMap(infraExpect(t, mux, admin, "POST", "/api/client/game-library/steam/satisfactory/install", input, 201)["attributes"])
	server, err := a.one(ctx, "SELECT * FROM servers WHERE uuid_short=$1", result["identifier"])
	if err != nil {
		t.Fatal(err)
	}
	if err = a.exec(ctx, "UPDATE servers SET status=NULL WHERE id=$1", server["id"]); err != nil {
		t.Fatal(err)
	}
	endpoint := "/api/client/servers/" + str(server["uuid_short"]) + "/quick-setup"
	empty := asMap(infraExpect(t, mux, admin, "GET", endpoint, nil, 200)["attributes"])
	if len(asSlice(empty["folders"])) != 0 || len(asSlice(empty["fields"])) != 0 {
		t.Fatal("invented Satisfactory settings or folders")
	}
	base := "/.config/Epic/FactoryGame/Saved/SaveGames/blueprints"
	f.mu.Lock()
	f.Folders[base] = []M{{"name": "Actual session", "directory": true, "file": false, "symlink": false}, {"name": "../unsafe", "directory": true}, {"name": "file.sbp", "directory": false, "file": true}, {"name": "symlink", "directory": true, "symlink": true}}
	f.Folders[base+"/Actual session"] = []M{}
	f.mu.Unlock()
	view := asMap(infraExpect(t, mux, admin, "GET", endpoint, nil, 200)["attributes"])
	folders := asSlice(view["folders"])
	if len(folders) != 1 || str(asMap(folders[0])["path"]) != base+"/Actual session" {
		t.Fatal("blueprint shortcut was not a safe discovered session")
	}
	infraExpect(t, mux, admin, "PUT", endpoint, M{"revision": view["revision"], "settings": M{"Session": "invented"}}, 422)
}

func TestQuickSetupPalworldSecretAuditAndMissingConfiguration(t *testing.T) {
	a, mux, admin, node, f := steamGamesFixture(t)
	ctx := context.Background()
	input := steamGamesInput("palworld", node)
	result := asMap(infraExpect(t, mux, admin, "POST", "/api/client/game-library/steam/palworld/install", input, 201)["attributes"])
	server, err := a.one(ctx, "SELECT * FROM servers WHERE uuid_short=$1", result["identifier"])
	if err != nil {
		t.Fatal(err)
	}
	if err = a.exec(ctx, "UPDATE servers SET status=NULL WHERE id=$1", server["id"]); err != nil {
		t.Fatal(err)
	}
	endpoint := "/api/client/servers/" + str(server["uuid_short"]) + "/quick-setup"
	view := asMap(infraExpect(t, mux, admin, "GET", endpoint, nil, 200)["attributes"])
	if len(asSlice(view["fields"])) != 0 {
		t.Fatal("missing native file reported default values")
	}
	infraExpect(t, mux, admin, "PUT", endpoint, M{"revision": view["revision"], "settings": M{"ServerName": "No file"}}, 409)
	f.mu.Lock()
	f.Files[palworldSettingsPath] = []byte("[/Script/Pal.PalGameWorldSettings]\nOptionSettings=(ServerName=\"Before\",ServerPlayerMaxNum=16,ServerPassword=\"\",ExpRate=1.0,RCONEnabled=False,RESTAPIEnabled=False,FutureValue=(A,B))\n")
	f.mu.Unlock()
	view = asMap(infraExpect(t, mux, admin, "GET", endpoint, nil, 200)["attributes"])
	infraExpect(t, mux, admin, "PUT", endpoint, M{"revision": view["revision"], "settings": M{"ServerPassword": "fixture-private-password"}}, 200)
	logs, err := a.query(ctx, "SELECT properties FROM activity_logs WHERE server_id=$1", server["id"])
	if err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(logs)
	if strings.Contains(string(encoded), "fixture-private-password") {
		t.Fatal("password leaked to activity logs")
	}
	f.mu.Lock()
	content := string(f.Files[palworldSettingsPath])
	f.mu.Unlock()
	if !strings.Contains(content, "FutureValue=(A,B)") || !strings.Contains(content, `ServerPassword="fixture-private-password"`) {
		t.Fatal("Palworld patch lost native values")
	}
}

func TestQuickSetupMissingIntermediateParentPreparation(t *testing.T) {
	for _, game := range []string{"satisfactory", "palworld"} {
		t.Run(game, func(t *testing.T) {
			a, mux, admin, node, f := steamGamesFixture(t)
			ctx := context.Background()
			result := asMap(infraExpect(t, mux, admin, "POST", "/api/client/game-library/steam/"+game+"/install", steamGamesInput(game, node), 201)["attributes"])
			server, err := a.one(ctx, "SELECT * FROM servers WHERE uuid_short=$1", result["identifier"])
			if err != nil {
				t.Fatal(err)
			}
			file := "/FactoryGame/Saved/Config/LinuxServer/Game.ini"
			installedRoot := "/FactoryGame"
			f.mu.Lock()
			if game == "palworld" {
				file = palworldSettingsPath
				installedRoot = "/Pal"
				f.Files["/DefaultPalWorldSettings.ini"] = []byte("[/Script/Pal.PalGameWorldSettings]\nOptionSettings=(ServerName=\"Default\",ServerPlayerMaxNum=32,RCONEnabled=True,RESTAPIEnabled=True,FutureValue=(A,B))\n")
			}
			f.Folders[installedRoot] = []M{}
			f.mu.Unlock()
			// The live failure was a 500 from Wings' openat2 when a parent did not
			// exist. Demonstrate the fixture has that behavior before testing the fix.
			_, err = a.daemonServer(ctx, server, "GET", "/files/contents?"+url.Values{"file": {file}}.Encode(), nil)
			if err == nil || !strings.Contains(err.Error(), "500") {
				t.Fatal("fixture did not reproduce missing-intermediate-parent 500")
			}
			f.mu.Lock()
			failedReads := f.MissingParentRequests
			f.mu.Unlock()
			_, exists, err := a.quickSetupRead(ctx, server, file)
			if err != nil || exists {
				t.Fatalf("missing config not established by parent listings: exists=%v err=%v", exists, err)
			}
			_, exists, err = a.quickSetupList(ctx, server, "/.config/Epic/FactoryGame/Saved/SaveGames/blueprints")
			if err != nil || exists {
				t.Fatalf("missing folder not established by parent listings: exists=%v err=%v", exists, err)
			}
			if err = a.exec(ctx, "UPDATE servers SET status=NULL WHERE id=$1", server["id"]); err != nil {
				t.Fatal(err)
			}
			endpoint := "/api/client/servers/" + str(server["uuid_short"]) + "/quick-setup"
			infraExpect(t, mux, admin, "GET", endpoint, nil, 200)
			if err = a.steamGameAfterInstall(ctx, server); err != nil {
				t.Fatalf("initial native preparation failed with missing parents: %v", err)
			}
			f.mu.Lock()
			content, created := f.Files[file]
			failures := f.MissingParentRequests
			writes := f.Writes
			f.mu.Unlock()
			expectedWrites := 1
			if game == "satisfactory" {
				// Managed Satisfactory now prepares both native INI files and a
				// one-time marker so later starts preserve operator edits.
				expectedWrites = 3
				f.mu.Lock()
				engine := string(f.Files["/FactoryGame/Saved/Config/LinuxServer/Engine.ini"])
				marker := string(f.Files["/FactoryGame/Saved/.voltra-managed-initialized"])
				f.mu.Unlock()
				if !strings.Contains(engine, "mNumRotatingAutosaves=") || marker != "initialized\n" {
					t.Fatal("Satisfactory preparation omitted engine settings or initialization marker")
				}
			}
			if !created || len(content) == 0 || writes != expectedWrites {
				t.Fatal("preparation did not create the native configuration")
			}
			if failures != failedReads {
				t.Fatal("fixed helpers requested a file/directory through an absent parent")
			}
			infraExpect(t, mux, admin, "GET", endpoint, nil, 200)
		})
	}
}

func TestQuickSetupPathWalkPreservesRealWingsErrors(t *testing.T) {
	a, _, _, node, f := steamGamesFixture(t)
	ctx := context.Background()
	server := M{"uuid": newUUID(), "node_id": node["id"]}
	file := "/FactoryGame/Saved/Config/LinuxServer/Game.ini"
	f.mu.Lock()
	f.Files[file] = []byte("[/Script/Engine.GameSession]\nMaxPlayers=4\n")
	f.mu.Unlock()
	for _, tc := range []struct {
		name, folder string
		status       int
	}{{"root permission", "/", 403}, {"root server error", "/", 500}, {"root missing error", "/", 404}, {"existing parent permission", "/FactoryGame", 403}, {"existing parent server error", "/FactoryGame/Saved", 500}, {"listed target vanished", "/FactoryGame/Saved/Config/LinuxServer", 404}} {
		t.Run(tc.name, func(t *testing.T) {
			f.mu.Lock()
			f.ListFailures = map[string]int{tc.folder: tc.status}
			f.mu.Unlock()
			if _, _, err := a.quickSetupRead(ctx, server, file); err == nil {
				t.Fatal("read hid a real parent listing failure")
			}
			if _, _, err := a.quickSetupList(ctx, server, path.Dir(file)); err == nil {
				t.Fatal("list hid a real parent listing failure")
			}
			if err := a.quickSetupMkdirAll(ctx, server, path.Dir(file)); err == nil {
				t.Fatal("mkdir hid a real parent listing failure")
			}
		})
	}
	f.mu.Lock()
	f.ListFailures = nil
	f.mu.Unlock()
	for _, status := range []int{403, 404, 500} {
		f.mu.Lock()
		f.ReadFailures = map[string]int{file: status}
		f.mu.Unlock()
		if _, _, err := a.quickSetupRead(ctx, server, file); err == nil {
			t.Fatalf("listed existing file HTTP %d was treated as absent", status)
		}
	}
	f.mu.Lock()
	f.ReadFailures = nil
	f.Folders["/"] = []M{{"name": "FactoryGame", "directory": true, "file": false, "symlink": true}}
	f.mu.Unlock()
	if _, _, err := a.quickSetupRead(ctx, server, file); err == nil {
		t.Fatal("symlink parent accepted")
	}
	if err := a.quickSetupMkdirAll(ctx, server, path.Dir(file)); err == nil {
		t.Fatal("mkdir traversed a symlink parent")
	}
	f.mu.Lock()
	f.Folders["/"] = []M{{"name": "FactoryGame", "directory": false, "file": true, "symlink": false}}
	f.mu.Unlock()
	if err := a.quickSetupMkdirAll(ctx, server, path.Dir(file)); err == nil {
		t.Fatal("mkdir treated an existing file as an absent folder")
	}
	f.mu.Lock()
	delete(f.Folders, "/")
	f.Folders[path.Dir(file)] = []M{{"name": "Game.ini", "file": true, "directory": false, "symlink": true}}
	f.mu.Unlock()
	if _, _, err := a.quickSetupRead(ctx, server, file); err == nil {
		t.Fatal("symlink configuration accepted")
	}
	client := a.HTTP
	a.HTTP = &http.Client{Transport: gameLibraryTransport(func(*http.Request) (*http.Response, error) { return nil, errors.New("fixture network unavailable") })}
	if _, _, err := a.quickSetupRead(ctx, server, file); err == nil {
		t.Fatal("network failure was treated as absence")
	}
	a.HTTP = client
	f.mu.Lock()
	writes := f.Writes
	f.mu.Unlock()
	if writes != 0 {
		t.Fatal("error cases wrote game files")
	}
}
