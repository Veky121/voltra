package panel

import (
	"context"
	"strings"
	"testing"
)

func TestWave77NativeSatisfactoryPlayers(t *testing.T) {
	a, mux, admin, node, f := steamGamesFixture(t)
	ctx := context.Background()
	installed := infraExpect(t, mux, admin, "POST", "/api/client/game-library/steam/satisfactory/install", steamGamesInput("satisfactory", node), 201)
	s, e := a.one(ctx, "SELECT * FROM servers WHERE uuid_short=$1", asMap(installed["attributes"])["identifier"])
	if e != nil {
		t.Fatal(e)
	}
	for _, q := range []string{"UPDATE servers SET status=NULL", "UPDATE steam_jobs SET status='completed'", "UPDATE steam_servers SET initialized=true"} {
		if e = a.exec(ctx, q); e != nil {
			t.Fatal(e)
		}
	}
	file := "/FactoryGame/Saved/Config/LinuxServer/Game.ini"
	f.mu.Lock()
	f.State = "offline"
	f.Files[file] = []byte("; keep\r\n[/Script/Engine.GameSession]\r\nMaxPlayers=4\r\nOther=3\r\nPassword=private-fixture\r\n")
	f.mu.Unlock()
	route := "/api/client/servers/" + str(s["uuid_short"]) + "/game-settings?file=" + file
	view := asMap(infraExpect(t, mux, admin, "GET", route, nil, 200)["attributes"])
	infraExpect(t, mux, admin, "PUT", route, M{"revision": view["revision"], "settings": M{"/Script/Engine.GameSession/MaxPlayers": "9", "/Script/Engine.GameSession/Other": "5"}}, 200)
	current, e := a.one(ctx, "SELECT * FROM servers WHERE id=$1", s["id"])
	if e != nil {
		t.Fatal(e)
	}
	c, _, e := a.steamCatalogLoad(ctx, current)
	if e != nil || c.Players != 9 || !strings.Contains(str(current["startup"]), steamCatalogPlayersPrefix+"=9") {
		t.Fatal("durable players/startup mismatch", e)
	}
	f.mu.Lock()
	body := string(f.Files[file])
	f.mu.Unlock()
	if !strings.Contains(body, "Other=5") || !strings.Contains(body, "Password=private-fixture") || !strings.HasPrefix(body, "; keep\r\n") {
		t.Fatal("mixed edit retention")
	}
	infraExpect(t, mux, admin, "PUT", route, M{"revision": view["revision"], "settings": M{"/Script/Engine.GameSession/MaxPlayers": "10"}}, 409)
	view = asMap(infraExpect(t, mux, admin, "GET", route, nil, 200)["attributes"])
	reader, err := a.insert(ctx, "users", M{"uuid": newUUID(), "username": "players-reader", "email": "players-reader@example.invalid"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = a.insert(ctx, "subusers", M{"user_id": reader["id"], "server_id": s["id"], "permissions": []string{"file.read-content"}}); err != nil {
		t.Fatal(err)
	}
	infraExpect(t, mux, num(reader["id"]), "PUT", route, M{"revision": view["revision"], "settings": M{"/Script/Engine.GameSession/MaxPlayers": "10"}}, 403)
	f.mu.Lock()
	before := string(f.Files[file])
	f.State = "running"
	f.mu.Unlock()
	infraExpect(t, mux, admin, "PUT", route, M{"revision": view["revision"], "settings": M{"/Script/Engine.GameSession/MaxPlayers": "10"}}, 409)
	f.mu.Lock()
	after := string(f.Files[file])
	f.mu.Unlock()
	if before != after {
		t.Fatal("refusal wrote native bytes")
	}

}
func TestWave77SevenDaysBounds(t *testing.T) {
	spec, _ := steamGameSpecFor("7days")
	if spec.MaximumPlayers != 32 {
		t.Fatal("setup bound")
	}
	for _, n := range []int{32, 33} {
		_, e := steamCatalogParse("7days", M{"MAX_PLAYERS": n}, 0)
		if (e == nil) != (n == 32) {
			t.Fatalf("players %d: %v", n, e)
		}
	}
}
