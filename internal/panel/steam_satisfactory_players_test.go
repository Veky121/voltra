package panel

import (
	"context"
	"strings"
	"testing"
)

func TestSteamCatalogSatisfactoryDurablePlayersStartup(t *testing.T) {
	base := "./FactoryServer.sh -Port={{SERVER_PORT}} -ReliablePort=28014 -unattended -custom=keep"
	want := base + " " + steamCatalogPlayersPrefix + "=6"
	if got, err := steamCatalogPlayersStartup(base, 6); err != nil || got != want {
		t.Fatalf("initial startup=%q error=%v", got, err)
	}
	if got, err := steamCatalogPlayersStartup(want, 9); err != nil || got != base+" "+steamCatalogPlayersPrefix+"=9" {
		t.Fatalf("updated startup=%q error=%v", got, err)
	}
	for _, invalid := range []string{want + " " + steamCatalogPlayersPrefix + "=7", base + " " + steamCatalogPlayersPrefix + "=bad", base + " " + steamCatalogPlayersPrefix + "=0", base + " " + steamCatalogPlayersPrefix + " 6", base + " \"" + steamCatalogPlayersPrefix + "=6\""} {
		if _, err := steamCatalogPlayersStartup(invalid, 8); err == nil {
			t.Fatal("Ambiguous or malformed managed player argument accepted")
		}
	}
}

func TestSteamCatalogSatisfactoryPlayersCommitRollback(t *testing.T) {
	a, mux, admin, node, f := steamGamesFixture(t)
	ctx := context.Background()
	input := steamGamesInput("satisfactory", node)
	input["max_players"] = 6
	installed := infraExpect(t, mux, admin, "POST", "/api/client/game-library/steam/satisfactory/install", input, 201)
	server, err := a.one(ctx, "SELECT * FROM servers WHERE uuid_short=$1", asMap(installed["attributes"])["identifier"])
	if err != nil || !strings.Contains(str(server["startup"]), steamCatalogPlayersPrefix+"=6") {
		t.Fatal("Original setup player limit not persisted in startup")
	}
	for _, statement := range []string{"UPDATE servers SET status=NULL", "UPDATE steam_jobs SET status='completed'", "UPDATE steam_servers SET initialized=true"} {
		if err = a.exec(ctx, statement); err != nil {
			t.Fatal(err)
		}
	}
	file := "/FactoryGame/Saved/Config/LinuxServer/Game.ini"
	f.mu.Lock()
	f.Files[file] = []byte("; keep\n[/Script/Engine.GameSession]\nMaxPlayers=6\nUnrelated=keep\n")
	f.mu.Unlock()
	if handled, err := a.steamCatalogUpdateControls(ctx, server, M{"MAX_PLAYERS": "9"}); !handled || err != nil {
		t.Fatal(err)
	}
	current, err := a.one(ctx, "SELECT * FROM servers WHERE id=$1", server["id"])
	if err != nil || !strings.Contains(str(current["startup"]), steamCatalogPlayersPrefix+"=9") {
		t.Fatal("Updated player limit not reconciled into startup")
	}
	f.mu.Lock()
	before := string(f.Files[file])
	f.mu.Unlock()
	if !strings.Contains(before, "MaxPlayers=9") || !strings.Contains(before, "Unrelated=keep") {
		t.Fatal("Conventional configuration was not preserved")
	}
	for _, statement := range []string{`CREATE FUNCTION reject_players_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture commit rejection'; END $$`, `CREATE CONSTRAINT TRIGGER reject_players_commit AFTER UPDATE ON steam_servers DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION reject_players_commit()`} {
		if err = a.exec(ctx, statement); err != nil {
			t.Fatal(err)
		}
	}
	if handled, err := a.steamCatalogUpdateControls(ctx, current, M{"MAX_PLAYERS": "12"}); !handled || err == nil {
		t.Fatal("Deferred commit failure was not surfaced")
	}
	after, err := a.one(ctx, "SELECT * FROM servers WHERE id=$1", server["id"])
	configuration, _, loadErr := a.steamCatalogLoad(ctx, after)
	f.mu.Lock()
	fileAfter := string(f.Files[file])
	f.mu.Unlock()
	if err != nil || loadErr != nil || str(after["startup"]) != str(current["startup"]) || configuration.Players != 9 || fileAfter != before {
		t.Fatal("Rejected update left startup, native files or controls partially changed")
	}
}

func TestSteamCatalogSatisfactoryLegacyPlayersPrecedence(t *testing.T) {
	for _, tc := range []struct {
		name     string
		legacy   M
		explicit *string
		want     int64
		invalid  bool
	}{
		{name: "legacy", legacy: M{"max_players": 6}, want: 6},
		{name: "default", legacy: M{}, want: 4},
		{name: "explicit wins", legacy: M{"max_players": 6}, explicit: func() *string { s := "9"; return &s }(), want: 9},
		{name: "explicit blank is invalid", legacy: M{"max_players": 6}, explicit: func() *string { s := ""; return &s }(), invalid: true},
		{name: "legacy invalid", legacy: M{"max_players": "bad"}, invalid: true},
		{name: "legacy null", legacy: M{"max_players": nil}, invalid: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			a, mux, admin, node, _ := steamGamesFixture(t)
			ctx := context.Background()
			installed := infraExpect(t, mux, admin, "POST", "/api/client/game-library/steam/satisfactory/install", steamGamesInput("satisfactory", node), 201)
			server, err := a.one(ctx, "SELECT * FROM servers WHERE uuid_short=$1", asMap(installed["attributes"])["identifier"])
			if err != nil {
				t.Fatal(err)
			}
			if err = a.exec(ctx, "DELETE FROM server_variables WHERE server_id=$1 AND variable_id IN (SELECT id FROM egg_variables WHERE env_variable='MAX_PLAYERS')", server["id"]); err != nil {
				t.Fatal(err)
			}
			if err = a.exec(ctx, "UPDATE steam_game_provisions SET settings=$2 WHERE server_id=$1", server["id"], tc.legacy); err != nil {
				t.Fatal(err)
			}
			if tc.explicit != nil {
				if err = a.exec(ctx, "INSERT INTO server_variables(server_id,variable_id,variable_value) SELECT $1,id,$3 FROM egg_variables WHERE egg_id=$2 AND env_variable='MAX_PLAYERS'", server["id"], server["egg_id"], *tc.explicit); err != nil {
					t.Fatal(err)
				}
			}
			configuration, _, err := a.steamCatalogLoad(ctx, server)
			if tc.invalid {
				if err == nil {
					t.Fatal("Invalid stored player limit silently fell back")
				}
				return
			}
			if err != nil || configuration.Players != tc.want {
				t.Fatalf("players=%d want=%d error=%v", configuration.Players, tc.want, err)
			}
		})
	}
}
