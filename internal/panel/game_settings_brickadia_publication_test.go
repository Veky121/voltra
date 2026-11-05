package panel

import (
	"bytes"
	"context"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"
)

func TestWave171BrickadiaPublication(t *testing.T) {
	a, mux, admin, s, f := wave95Fixture(t)
	ctx := context.Background()
	egg := batchSettingsRecipeFixture(t, "brickadia/egg-brickadia.json")
	egg["java_config"] = M{}
	if _, e := a.update(ctx, "eggs", num(s["egg_id"]), egg); e != nil {
		t.Fatal(e)
	}
	alloc, e := a.insert(ctx, "allocations", M{"node_id": s["node_id"], "server_id": s["id"], "ip": "127.0.0.1", "port": 29100})
	if e != nil {
		t.Fatal(e)
	}
	if _, e = a.update(ctx, "servers", num(s["id"]), M{"startup": egg["startup"], "allocation_id": alloc["id"]}); e != nil {
		t.Fatal(e)
	}
	entry, _ := gameSettingsProfile(egg)
	for _, value := range asSlice(entry.Egg["variables"]) {
		v := asMap(value)
		row := M{}
		for _, k := range []string{"name", "description", "env_variable", "default_value", "user_viewable", "user_editable", "rules"} {
			row[k] = v[k]
		}
		row["egg_id"] = s["egg_id"]
		ev, e := a.insert(ctx, "egg_variables", row)
		if e != nil {
			t.Fatal(e)
		}
		val := str(v["default_value"])
		if str(v["env_variable"]) == "SERVER_PORT" {
			val = "29100"
		}
		if str(v["env_variable"]) == "SERVER_HOSTING_TOKEN" {
			val = "fixture-private-token"
		}
		if _, e = a.insert(ctx, "server_variables", M{"server_id": s["id"], "variable_id": ev["id"], "variable_value": val}); e != nil {
			t.Fatal(e)
		}
	}
	script := str(asMap(asMap(entry.Egg["scripts"])["installation"])["script"])
	count := 0
	for _, chunk := range strings.Split(script, "cat > ")[1:] {
		head, body, ok := strings.Cut(chunk, "\n")
		if !ok {
			continue
		}
		name, marker, ok := strings.Cut(head, " <<'")
		if !ok || !strings.HasPrefix(name, ".voltra/") {
			continue
		}
		expected, _, ok := strings.Cut(body, "\n"+strings.TrimSuffix(marker, "'")+"\n")
		if !ok {
			t.Fatal("emission")
		}
		f.Files["/"+name] = []byte(expected + "\n")
		count++
	}
	if count != 7 {
		t.Fatal(count)
	}
	raw := "; retained\r\n[" + strings.TrimSuffix(brickadiaSection, "/") + "]\r\nServerName=Before\r\nServerPassword=fixture-private\r\nbPubliclyListed=False\r\nPort=29100\r\nUnknownScalar=9007199254740993\r\n+Array=A\r\n+Array=B\r\n"
	f.Files[brickadiaPath] = []byte(raw)
	f.Files["/unrelated.ini"] = []byte("Name=Other\n")
	f.State = "offline"
	route := "/api/client/servers/" + str(s["uuid_short"]) + "/game-settings?file=" + url.QueryEscape(brickadiaPath)

	helperPath := ""
	for p := range f.Files {
		if strings.HasPrefix(p, "/.voltra/") {
			helperPath = p
			break
		}
	}
	get := func(user int64) M { return asMap(infraExpect(t, mux, user, "GET", route, nil, 200)["attributes"]) }
	put := func(user int64, v M) int {
		status, _, _ := infraRequest(t, mux, user, "PUT", route, M{"revision": v["revision"], "settings": M{brickadiaSection + "ServerName": "5"}})
		return status
	}
	unchanged := func(writes int, b []byte) {
		t.Helper()
		if f.Writes != writes || !bytes.Equal(f.Files[brickadiaPath], b) {
			t.Fatal("refused mutation wrote native bytes")
		}
	}
	view := get(admin)
	found := false
	for _, raw := range asSlice(view["fields"]) {
		field := asMap(raw)
		if str(field["key"]) == brickadiaSection+"Port" {
			found = true
			if !boolean(field["readonly"]) {
				t.Fatal("managed port not readonly")
			}
		}
	}
	if !found {
		t.Fatal("missing managed port")
	}
	reader, e := a.insert(ctx, "users", M{"uuid": newUUID(), "username": "reader161", "email": "reader161@example.invalid"})
	if e != nil {
		t.Fatal(e)
	}
	_, e = a.insert(ctx, "subusers", M{"user_id": reader["id"], "server_id": s["id"], "permissions": []string{"file.read", "file.read-content"}})
	if e != nil {
		t.Fatal(e)
	}
	before := append([]byte(nil), f.Files[brickadiaPath]...)
	writes := f.Writes
	if put(num(reader["id"]), get(num(reader["id"]))) != 403 {
		t.Fatal("read-only user accepted")
	}
	unchanged(writes, before)
	_, e = a.update(ctx, "users", admin, M{"disabled": true})
	if e != nil {
		t.Fatal(e)
	}
	if put(admin, view) != 403 {
		t.Fatal("disabled user accepted")
	}
	unchanged(writes, before)
	a.update(ctx, "users", admin, M{"disabled": false})
	// Count selected-file reads on an actual successful request, then revoke on its final read.
	reads := 0
	base := a.HTTP.Transport
	if base == nil {
		base = http.DefaultTransport
	}
	a.HTTP.Transport = wave161Transport{base, func(r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/files/contents") && r.URL.Query().Get("file") == brickadiaPath {
			reads++
		}
	}}
	if put(admin, get(admin)) != 200 {
		t.Fatal("counting edit failed")
	}
	// GET contributes one selected-file read; measure PUT independently.
	view = get(admin)
	reads = 0
	if put(admin, view) != 200 {
		t.Fatal("counting PUT failed")
	}
	finalRead := reads - 1
	if finalRead < 2 {
		t.Fatal("missing final read")
	}
	a.HTTP.Transport = base
	for _, kind := range []string{"startup", "helper", "actor", "content"} {
		t.Run("final-read-"+kind, func(t *testing.T) {
			view := get(admin)
			before := append([]byte(nil), f.Files[brickadiaPath]...)
			writes := f.Writes
			n := 0
			fired := false
			helper := append([]byte(nil), f.Files[helperPath]...)
			transportBase := base
			if kind == "content" {
				transportBase = wave171BeforeTransport{base, func(r *http.Request) {
					if strings.HasSuffix(r.URL.Path, "/files/contents") && r.URL.Query().Get("file") == brickadiaPath && n+1 == finalRead {
						f.mu.Lock()
						f.Files[brickadiaPath] = []byte(strings.Replace(string(before), "ServerName=5", "ServerName=external", 1))
						f.mu.Unlock()
					}
				}}
			}
			a.HTTP.Transport = wave161Transport{transportBase, func(r *http.Request) {
				if strings.HasSuffix(r.URL.Path, "/files/contents") && r.URL.Query().Get("file") == brickadiaPath {
					n++
					if n == finalRead {
						fired = true
						switch kind {
						case "startup":
							_, e = a.update(ctx, "servers", num(s["id"]), M{"startup": "revoked"})
						case "helper":
							f.mu.Lock()
							f.Files[helperPath] = []byte("revoked")
							f.mu.Unlock()
						case "content":
							f.mu.Lock()
							f.Files[brickadiaPath] = []byte(strings.Replace(string(before), "ServerName=5", "ServerName=external", 1))
							f.mu.Unlock()
						case "actor":
							_, e = a.update(ctx, "users", admin, M{"disabled": true})
						}
					}
				}
			}}
			status := put(admin, view)
			a.HTTP.Transport = base
			if e != nil {
				t.Fatal(e)
			}
			if !fired || status < 400 {
				t.Fatalf("revocation fired=%v status=%d read=%d/%d", fired, status, n, finalRead)
			}
			if kind == "content" {
				if f.Writes != writes {
					t.Fatal("content refusal wrote")
				}
				f.Files[brickadiaPath] = before
			} else {
				unchanged(writes, before)
			}
			a.update(ctx, "servers", num(s["id"]), M{"startup": egg["startup"]})
			a.update(ctx, "users", admin, M{"disabled": false})
			f.Files[helperPath] = helper
			t.Logf("final selected read %d revoked %s, status %d, zero writes", n, kind, status)
		})
	}
	for _, kind := range []string{"startup", "helper", "allocation", "actor", "state"} {
		t.Run("contended-lock-"+kind, func(t *testing.T) {
			helperBefore := append([]byte(nil), f.Files[helperPath]...)
			defer func() {
				a.update(ctx, "servers", num(s["id"]), M{"startup": egg["startup"], "status": nil})
				a.update(ctx, "users", admin, M{"disabled": false})
				a.update(ctx, "allocations", num(alloc["id"]), M{"port": 29100})
				f.Files[helperPath] = helperBefore
			}()
			view := get(admin)
			before := append([]byte(nil), f.Files[brickadiaPath]...)
			writes := f.Writes
			conn, e := a.DB.Acquire(ctx)
			if e != nil {
				t.Fatal(e)
			}
			defer conn.Release()
			tx, e := conn.Begin(ctx)
			if e != nil {
				t.Fatal(e)
			}
			defer tx.Rollback(ctx)
			key := "voltra:server-mutation:" + str(s["uuid"])
			if _, e = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", key); e != nil {
				t.Fatal(e)
			}
			pid := conn.Conn().PgConn().PID()
			done := make(chan int, 1)
			go func() { done <- put(admin, view) }()
			deadline := time.Now().Add(5 * time.Second)
			observed := false
			for time.Now().Before(deadline) {
				var matched bool
				e = a.DB.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM pg_locks held JOIN pg_locks waiting ON held.locktype=waiting.locktype AND held.database=waiting.database AND held.classid=waiting.classid AND held.objid=waiting.objid AND held.objsubid=waiting.objsubid WHERE held.locktype='advisory' AND held.pid=$1 AND held.granted AND NOT waiting.granted AND held.classid=((hashtextextended($2,0)>>32)&4294967295)::oid AND held.objid=(hashtextextended($2,0)&4294967295)::oid)`, pid, key).Scan(&matched)
				if e != nil {
					t.Fatal(e)
				}
				if matched {
					observed = true
					break
				}
				time.Sleep(10 * time.Millisecond)
			}
			if !observed {
				tx.Rollback(ctx)
				<-done
				t.Fatal("no matching lock contention")
			}
			switch kind {
			case "startup":
				_, e = a.update(ctx, "servers", num(s["id"]), M{"startup": "revoked-under-lock"})
			case "helper":
				f.mu.Lock()
				f.Files[helperPath] = []byte("revoked")
				f.mu.Unlock()
			case "allocation":
				_, e = a.update(ctx, "allocations", num(alloc["id"]), M{"port": 29101})
			case "actor":
				_, e = a.update(ctx, "users", admin, M{"disabled": true})
			case "state":
				_, e = a.update(ctx, "servers", num(s["id"]), M{"status": "suspended"})
			}
			if e != nil {
				t.Fatal(e)
			}
			tx.Rollback(ctx)
			select {
			case status := <-done:
				if status < 400 {
					t.Fatal("contended mutation accepted")
				}
				t.Log(fmt.Sprintf("matched held PID %d and exact hash key; refusal %d", pid, status))
			case <-time.After(5 * time.Second):
				t.Fatal("handler did not finish")
			}
			unchanged(writes, before)
		})
	}
}

type wave171BeforeTransport struct {
	base http.RoundTripper
	hook func(*http.Request)
}

func (x wave171BeforeTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	x.hook(r)
	return x.base.RoundTrip(r)
}
