package panel

import (
	"bytes"
	"context"
	"testing"
)

// Isolated PostgreSQL plus fake Wings; this verifies raw-byte transactional
// publication, not actual publisher/game behavior.
func TestSteamCatalogConsolePackageRawInstallAndRollback(t *testing.T) {
	for _, existing := range []bool{false, true} {
		name := "new_package"
		if existing {
			name = "existing_package"
		}
		t.Run(name, func(t *testing.T) {
			a, mux, admin, node, f := steamGamesFixture(t)
			ctx := context.Background()
			for _, port := range []int{7778, 7779, 7780} {
				if _, err := a.insert(ctx, "allocations", M{"node_id": node["id"], "ip": "127.0.0.1", "port": port}); err != nil {
					t.Fatal(err)
				}
			}
			input := steamGamesInput("7days", node)
			input["environment"] = M{"PASSWORD": "+fixture original λé"}
			installed := infraExpect(t, mux, admin, "POST", "/api/client/game-library/steam/7days/install", input, 201)
			server, err := a.one(ctx, "SELECT * FROM servers WHERE uuid_short=$1", asMap(installed["attributes"])["identifier"])
			if err != nil {
				t.Fatal(err)
			}
			for _, sql := range []string{"UPDATE servers SET status=NULL", "UPDATE steam_jobs SET status='completed'", "UPDATE steam_servers SET initialized=true"} {
				if err = a.exec(ctx, sql); err != nil {
					t.Fatal(err)
				}
			}
			f.mu.Lock()
			f.Files[sevenDaysSettingsPath] = []byte("<ServerSettings></ServerSettings>\n")
			f.mu.Unlock()
			configuration, state, err := a.steamCatalogLoad(ctx, server)
			if err != nil {
				t.Fatal(err)
			}
			if existing {
				if err = a.steamCatalogApplyConfiguration(ctx, server, configuration, nil); err != nil {
					t.Fatal(err)
				}
				artifact, err := steamCatalogConsoleArtifact("amd64")
				if err != nil {
					t.Fatal(err)
				}
				f.mu.Lock()
				binary := append([]byte(nil), f.Files[steamCatalogConsolePath]...)
				f.mu.Unlock()
				if len(binary) <= 4<<20 || !bytes.Equal(binary, artifact.Binary) {
					t.Fatal("binary was truncated or JSON/string encoded")
				}
				if _, _, err = a.quickSetupRead(ctx, server, steamCatalogConsolePath); err == nil {
					t.Fatal("generic configuration read limit was broadened")
				}
				read, found, err := a.steamCatalogReadNativeFile(ctx, server, steamCatalogConsolePath)
				if err != nil || !found || !bytes.Equal(read, binary) {
					t.Fatal("fixed-path raw artifact read failed")
				}
			}
			f.mu.Lock()
			before := map[string][]byte{}
			for path, data := range f.Files {
				before[path] = append([]byte(nil), data...)
			}
			f.mu.Unlock()
			if err = a.exec(ctx, `CREATE FUNCTION reject_console_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture console commit rejection'; END $$`); err != nil {
				t.Fatal(err)
			}
			if err = a.exec(ctx, `CREATE CONSTRAINT TRIGGER reject_console_commit AFTER UPDATE ON steam_servers DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION reject_console_commit()`); err != nil {
				t.Fatal(err)
			}
			handled, err := a.steamCatalogUpdateControls(ctx, server, M{"PASSWORD": "+replacement fixture λé"})
			if !handled || err == nil {
				t.Fatal("fixture deferred commit did not fail")
			}
			f.mu.Lock()
			defer f.mu.Unlock()
			if len(before) != len(f.Files) {
				t.Fatal("rollback did not restore artifact absence")
			}
			for path, data := range before {
				if !bytes.Equal(data, f.Files[path]) {
					t.Fatal("rollback changed native/artifact bytes:", path)
				}
			}
			after, err := a.one(ctx, "SELECT * FROM steam_servers WHERE server_id=$1", server["id"])
			if err != nil || str(after["console_password_encrypted"]) != str(state["console_password_encrypted"]) {
				t.Fatal("failed publication changed encrypted settings")
			}
		})
	}
}
