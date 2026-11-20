package panel

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func wave79Fixture(t *testing.T, game string) (*App, *http.ServeMux, int64, M, *steamGamesWings, string) {
	t.Helper()
	a, m, u, n, f := steamGamesFixture(t)
	x := infraExpect(t, m, u, "POST", "/api/client/game-library/steam/"+game+"/install", steamGamesInput(game, n), 201)
	s, e := a.one(context.Background(), "SELECT * FROM servers WHERE uuid_short=$1", asMap(x["attributes"])["identifier"])
	if e != nil {
		t.Fatal(e)
	}
	for _, q := range []string{"UPDATE servers SET status=NULL", "UPDATE steam_jobs SET status='completed'", "UPDATE steam_servers SET initialized=true"} {
		if e = a.exec(context.Background(), q); e != nil {
			t.Fatal(e)
		}
	}
	return a, m, u, s, f, "/api/client/servers/" + str(s["uuid_short"])
}

func TestWave79SatisfactoryContendedAuthority(t *testing.T) {
	for _, kind := range []string{"startup", "managed", "variable", "permissions", "revision", "status", "egg"} {
		t.Run(kind, func(t *testing.T) {
			a, m, u, s, f, base := wave79Fixture(t, "satisfactory")
			ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
			defer cancel()
			file := "/FactoryGame/Saved/Config/LinuxServer/Game.ini"
			original := "; unknown\r\n[/Script/Engine.GameSession]\r\nMaxPlayers=4\r\nOther=3\r\nPassword=private-fixture\r\n"
			f.Files[file] = []byte(original)
			route := base + "/game-settings?file=" + file
			v := asMap(infraExpect(t, m, u, "GET", route, nil, 200)["attributes"])
			if kind == "permissions" {
				r, e := a.insert(ctx, "users", M{"uuid": newUUID(), "username": "wave79", "email": "wave79@example.invalid"})
				if e != nil {
					t.Fatal(e)
				}
				u = num(r["id"])
				if _, e = a.insert(ctx, "subusers", M{"user_id": u, "server_id": s["id"], "permissions": []string{"file.read-content", "file.update"}}); e != nil {
					t.Fatal(e)
				}
			}
			tx, e := a.DB.Begin(ctx)
			if e != nil {
				t.Fatal(e)
			}
			defer tx.Rollback(context.Background())
			if _, e = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "voltra:server-mutation:"+str(s["uuid"])); e != nil {
				t.Fatal(e)
			}
			var blocker int
			if e = tx.QueryRow(ctx, "SELECT pg_backend_pid()").Scan(&blocker); e != nil {
				t.Fatal(e)
			}
			b, _ := json.Marshal(M{"revision": v["revision"], "settings": M{"/Script/Engine.GameSession/MaxPlayers": "9", "/Script/Engine.GameSession/Other": "5"}})
			req := WithUser(httptest.NewRequest("PUT", route, strings.NewReader(string(b))).WithContext(ctx), u)
			done := make(chan *httptest.ResponseRecorder, 1)
			go func() { w := httptest.NewRecorder(); m.ServeHTTP(w, req); done <- w }()
			// pg_locks is the synchronization barrier: mutate only after the request is actually waiting.
			for {
				var waiting bool
				e = a.DB.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid WHERE l.locktype='advisory' AND NOT l.granted AND a.datname=current_database() AND $1=ANY(pg_blocking_pids(a.pid)))`, blocker).Scan(&waiting)
				if e != nil {
					t.Fatal("lock barrier unavailable")
				}
				if waiting {
					break
				}
				select {
				case <-ctx.Done():
					t.Fatal("request never waited")
				default:
				}
			}
			switch kind {
			case "startup":
				e = a.exec(ctx, "UPDATE servers SET startup=startup || ' changed' WHERE id=$1", s["id"])
			case "variable":
				e = a.exec(ctx, "UPDATE server_variables SET variable_value='11' WHERE server_id=$1 AND variable_id IN (SELECT id FROM egg_variables WHERE env_variable='MAX_PLAYERS')", s["id"])
			case "managed":
				e = a.exec(ctx, "UPDATE steam_servers SET initialized=false WHERE server_id=$1", s["id"])
			case "permissions":
				e = a.exec(ctx, "UPDATE subusers SET permissions='[\"file.read-content\"]' WHERE server_id=$1", s["id"])
			case "revision":
				f.mu.Lock()
				f.Files[file] = []byte(original + "; concurrent\r\n")
				f.mu.Unlock()
			case "status":
				e = a.exec(ctx, "UPDATE servers SET status='suspended' WHERE id=$1", s["id"])
			case "egg":
				e = a.exec(ctx, "UPDATE eggs SET uuid=$2 WHERE id=$1", s["egg_id"], newUUID())
			}
			if e != nil {
				t.Fatal(e)
			}
			before, e := a.one(ctx, "SELECT startup,(SELECT json_agg(v ORDER BY id)::text FROM server_variables v WHERE server_id=s.id) AS vars FROM servers s WHERE id=$1", s["id"])
			if e != nil {
				t.Fatal(e)
			}
			f.mu.Lock()
			bytesBefore := string(f.Files[file])
			writes := f.Writes
			f.mu.Unlock()
			if e = tx.Commit(ctx); e != nil {
				t.Fatal(e)
			}
			select {
			case w := <-done:
				if w.Code < 400 {
					t.Fatalf("revoked request succeeded: %d", w.Code)
				}
			case <-ctx.Done():
				t.Fatal("request did not finish")
			}
			after, e := a.one(ctx, "SELECT startup,(SELECT json_agg(v ORDER BY id)::text FROM server_variables v WHERE server_id=s.id) AS vars FROM servers s WHERE id=$1", s["id"])
			if e != nil {
				t.Fatal(e)
			}
			if str(before["startup"]) != str(after["startup"]) || str(before["vars"]) != str(after["vars"]) {
				t.Fatal("refusal mutated durable controls")
			}
			f.mu.Lock()
			defer f.mu.Unlock()
			if f.Writes != writes || string(f.Files[file]) != bytesBefore {
				t.Fatal("refusal published native bytes")
			}
		})
	}
}

func TestWave79SevenDaysNativeBounds(t *testing.T) {
	a, m, u, s, f, base := wave79Fixture(t, "7days")
	file := "/serverconfig.xml"
	original := `<?xml version="1.0"?><ServerSettings><!-- keep --><property name="ServerMaxPlayerCount" value="8"/><property name="ServerName" value="before"/><property name="TelnetPassword" value="private-fixture"/><property name="UnknownFuture" value="opaque"/></ServerSettings>`
	f.Files[file] = []byte(original)
	route := base + "/game-settings?file=" + file
	for _, value := range []string{"32", "33", "0", "-1", "1", "1.5"} {
		t.Run(value, func(t *testing.T) {
			v := asMap(infraExpect(t, m, u, "GET", route, nil, 200)["attributes"])
			f.mu.Lock()
			before := string(f.Files[file])
			writes := f.Writes
			f.mu.Unlock()
			status := 422
			if value == "32" || value == "1" {
				status = 200
			}
			infraExpect(t, m, u, "PUT", route, M{"revision": v["revision"], "settings": M{"ServerMaxPlayerCount": value, "ServerName": "after"}}, status)
			f.mu.Lock()
			defer f.mu.Unlock()
			if status != 200 && (before != string(f.Files[file]) || writes != f.Writes) {
				t.Fatal("invalid mixed edit mutated native file")
			}
			if !strings.Contains(string(f.Files[file]), `value="private-fixture"`) || !strings.Contains(string(f.Files[file]), `name="UnknownFuture" value="opaque"`) {
				t.Fatal("secret/unknown bytes lost")
			}
		})
	}
	v := asMap(infraExpect(t, m, u, "GET", route, nil, 200)["attributes"])
	for key, value := range (M{"TelnetPassword": "changed", "TelnetPort": "9009", "TelnetEnabled": "false"}) {
		before := string(f.Files[file])
		writes := f.Writes
		infraExpect(t, m, u, "PUT", route, M{"revision": v["revision"], "settings": M{key: value, "ServerMaxPlayerCount": "8"}}, 422)
		if before != string(f.Files[file]) || writes != f.Writes {
			t.Fatal("private console refusal wrote native bytes")
		}
	}
	before := string(f.Files[file])
	writes := f.Writes
	infraExpect(t, m, u, "PUT", route, M{"revision": "stale", "settings": M{"ServerMaxPlayerCount": "8"}}, 409)
	f.State = "running"
	infraExpect(t, m, u, "PUT", route, M{"revision": v["revision"], "settings": M{"ServerMaxPlayerCount": "8"}}, 409)
	f.State = "offline"
	reader, e := a.insert(context.Background(), "users", M{"uuid": newUUID(), "username": "seven-reader", "email": "seven-reader@example.invalid"})
	if e != nil {
		t.Fatal(e)
	}
	if _, e = a.insert(context.Background(), "subusers", M{"user_id": reader["id"], "server_id": s["id"], "permissions": []string{"file.read-content"}}); e != nil {
		t.Fatal(e)
	}
	infraExpect(t, m, num(reader["id"]), "GET", route, nil, 200)
	infraExpect(t, m, num(reader["id"]), "PUT", route, M{"revision": v["revision"], "settings": M{"ServerMaxPlayerCount": "8"}}, 403)
	infraExpect(t, m, u, "PUT", base+"/game-settings?file=/other.xml", M{"revision": v["revision"], "settings": M{"ServerMaxPlayerCount": "8"}}, 404)
	if before != string(f.Files[file]) || writes != f.Writes {
		t.Fatal("guard refusal wrote native bytes")
	}

}

func TestWave79SatisfactoryPartialWriteRollback(t *testing.T) { wave79PublicationFailure(t, false) }
func TestWave79SatisfactoryCommitRollback(t *testing.T)       { wave79PublicationFailure(t, true) }
func wave79PublicationFailure(t *testing.T, commit bool) {
	a, m, u, s, f, base := wave79Fixture(t, "satisfactory")
	file := "/FactoryGame/Saved/Config/LinuxServer/Game.ini"
	original := "; keep\r\n[/Script/Engine.GameSession]\r\nMaxPlayers=4\r\nOther=3\r\nPassword=private-fixture\r\n"
	f.Files[file] = []byte(original)
	route := base + "/game-settings?file=" + file
	v := asMap(infraExpect(t, m, u, "GET", route, nil, 200)["attributes"])
	before, _ := a.one(context.Background(), "SELECT startup,(SELECT json_agg(v ORDER BY id)::text FROM server_variables v WHERE server_id=s.id) AS vars FROM servers s WHERE id=$1", s["id"])
	if commit {
		for _, q := range []string{`CREATE FUNCTION wave79_reject_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture deferred commit refusal'; END $$`, `CREATE CONSTRAINT TRIGGER wave79_reject_commit AFTER UPDATE ON servers DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION wave79_reject_commit()`} {
			if e := a.exec(context.Background(), q); e != nil {
				t.Fatal(e)
			}
		}
	} else {
		f.FailWriteOnce = file
	}
	b, _ := json.Marshal(M{"revision": v["revision"], "settings": M{"/Script/Engine.GameSession/MaxPlayers": "9", "/Script/Engine.GameSession/Other": "5"}})
	w := httptest.NewRecorder()
	m.ServeHTTP(w, WithUser(httptest.NewRequest("PUT", route, strings.NewReader(string(b))), u))
	if w.Code < 400 {
		t.Fatal("partial write accepted")
	}
	after, _ := a.one(context.Background(), "SELECT startup,(SELECT json_agg(v ORDER BY id)::text FROM server_variables v WHERE server_id=s.id) AS vars FROM servers s WHERE id=$1", s["id"])
	if str(before["startup"]) != str(after["startup"]) || str(before["vars"]) != str(after["vars"]) {
		t.Fatal("durable controls committed")
	}
	if string(f.Files[file]) != original {
		t.Fatal("partial native write was not restored")
	}
}

func TestWave79SevenDaysSetupBounds(t *testing.T) {
	a, m, u, n, f := steamGamesFixture(t)
	for _, value := range []int{0, 33, -1} {
		input := steamGamesInput("7days", n)
		input["max_players"] = value
		infraExpect(t, m, u, "POST", "/api/client/game-library/steam/7days/install", input, 422)
		input = steamGamesInput("7days", n)
		input["environment"] = M{"MAX_PLAYERS": value}
		infraExpect(t, m, u, "POST", "/api/client/game-library/steam/7days/install", input, 422)
	}
	var count int
	if e := a.DB.QueryRow(context.Background(), "SELECT count(*) FROM servers").Scan(&count); e != nil || count != 0 || f.Creates != 0 || f.Writes != 0 {
		t.Fatal("invalid setup mutated state")
	}
}

func TestWave79SevenDaysQuickBounds(t *testing.T) {
	_, m, u, _, f, base := wave79Fixture(t, "7days")
	file := "/serverconfig.xml"
	f.Files[file] = []byte(`<ServerSettings><property name="ServerMaxPlayerCount" value="8"/><property name="ServerName" value="before"/><property name="TelnetPassword" value="private-fixture"/><property name="UnknownFuture" value="opaque"/></ServerSettings>`)
	for _, value := range []int{32, 33, 0, 1} {
		route := base + "/quick-setup"
		v := asMap(infraExpect(t, m, u, "GET", route, nil, 200)["attributes"])
		before := string(f.Files[file])
		writes := f.Writes
		status := 422
		if value == 32 || value == 1 {
			status = 200
		}
		infraExpect(t, m, u, "PUT", route, M{"revision": v["revision"], "settings": M{"ServerMaxPlayerCount": value, "ServerName": "after"}}, status)
		if status != 200 && (before != string(f.Files[file]) || writes != f.Writes) {
			t.Fatal("invalid quick setup mutated native bytes")
		}
	}
}

func TestWave79SevenDaysSetupAcceptedBounds(t *testing.T) {
	for _, n := range []int{1, 32} {
		t.Run(str(n), func(t *testing.T) {
			a, m, u, node, _ := steamGamesFixture(t)
			input := steamGamesInput("7days", node)
			input["max_players"] = n
			input["environment"] = M{"MAX_PLAYERS": n}
			result := infraExpect(t, m, u, "POST", "/api/client/game-library/steam/7days/install", input, 201)
			server, e := a.one(context.Background(), "SELECT * FROM servers WHERE uuid_short=$1", asMap(result["attributes"])["identifier"])
			if e != nil {
				t.Fatal(e)
			}
			config, _, e := a.steamCatalogLoad(context.Background(), server)
			if e != nil || config.Players != int64(n) {
				t.Fatal("setup durable player bound mismatch")
			}
		})
	}
}
