package panel

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"testing"
	"time"
)

type wave161Transport struct {
	base http.RoundTripper
	hook func(*http.Request)
}

func (x wave161Transport) RoundTrip(r *http.Request) (*http.Response, error) {
	res, e := x.base.RoundTrip(r)
	if e == nil && x.hook != nil {
		b, er := io.ReadAll(res.Body)
		res.Body.Close()
		if er != nil {
			return nil, er
		}
		res.Body = io.NopCloser(bytes.NewReader(b))
		x.hook(r)
	}
	return res, e
}
func TestWave156ArcheanHandler(t *testing.T) {
	a, mux, admin, s, f := quickSetupMinecraftFixture(t)
	ctx := context.Background()
	egg := batchSettingsRecipeFixture(t, archeanRepairRecipe)
	if _, e := a.update(ctx, "eggs", num(s["egg_id"]), egg); e != nil {
		t.Fatal(e)
	}
	al, e := a.insert(ctx, "allocations", M{"node_id": s["node_id"], "server_id": s["id"], "ip": "127.0.0.1", "port": 28020})
	if e != nil {
		t.Fatal(e)
	}
	if _, e = a.update(ctx, "servers", num(s["id"]), M{"startup": egg["startup"], "allocation_id": al["id"], "java_config": M{}, "image": "fixture/archean"}); e != nil {
		t.Fatal(e)
	}
	if _, e = a.DB.Exec(ctx, "DELETE FROM server_variables WHERE server_id=$1", s["id"]); e != nil {
		t.Fatal(e)
	}
	if _, e = a.DB.Exec(ctx, "DELETE FROM egg_variables WHERE egg_id=$1", s["egg_id"]); e != nil {
		t.Fatal(e)
	}
	if _, e = a.update(ctx, "eggs", num(s["egg_id"]), M{"name": "Archean", "java_config": M{}, "features": []any{}}); e != nil {
		t.Fatal(e)
	}
	if _, e = a.insert(ctx, "egg_variables", M{"egg_id": s["egg_id"], "name": "Port", "env_variable": "SERVER_PORT", "default_value": "28020", "rules": "required|integer"}); e != nil {
		t.Fatal(e)
	}
	entry, _ := gameSettingsProfile(egg)
	script := str(asMap(asMap(entry.Egg["scripts"])["installation"])["script"])
	re := regexp.MustCompile(`(?s)cat > (\S+) <<'([^']+)'\n(.*?)\n`)
	_ = re
	// Split using each exact delimiter, preserving final LF.
	for _, chunk := range strings.Split(script, "cat > ")[1:] {
		head, body, _ := strings.Cut(chunk, "\n")
		name, marker, ok := strings.Cut(head, " <<'")
		if !ok {
			continue
		}
		data, _, ok := strings.Cut(body, "\n"+strings.TrimSuffix(marker, "'")+"\n")
		if !ok {
			t.Fatal("delimiter")
		}
		f.Files["/"+name] = []byte(data + "\n")
	}
	f.Files[archeanRepairPath] = []byte("[server]\nmax_simultaneous_players=4\npassword=fixture-private-password\n[networking]\nlisten_port=28020\n")
	route := "/api/client/servers/" + str(s["uuid_short"]) + "/game-settings"
	view := asMap(infraExpect(t, mux, admin, "GET", route, nil, 200)["attributes"])
	b, _ := json.Marshal(view)
	if strings.Contains(string(b), "fixture-private-password") {
		t.Fatal("secret leak")
	}
	for k, v := range (M{"server/max_simultaneous_players": "0", "networking/listen_port": "28021"}) {
		infraExpect(t, mux, admin, "PUT", route, M{"revision": view["revision"], "settings": M{k: v}}, 422)
	}
	f.mu.Lock()
	f.State = "running"
	f.mu.Unlock()
	infraExpect(t, mux, admin, "PUT", route, M{"revision": view["revision"], "settings": M{"server/max_simultaneous_players": "5"}}, 409)
	f.mu.Lock()
	f.State = "offline"
	f.mu.Unlock()
	infraExpect(t, mux, admin, "PUT", route, M{"revision": view["revision"], "settings": M{"server/max_simultaneous_players": "5"}}, 200)
	infraExpect(t, mux, admin, "PUT", route, M{"revision": view["revision"], "settings": M{"server/max_simultaneous_players": "6"}}, 409)
	if _, e = a.update(ctx, "servers", num(s["id"]), M{"startup": "custom"}); e != nil {
		t.Fatal(e)
	}
	infraExpect(t, mux, admin, "GET", route, nil, 404)
	if _, e = a.update(ctx, "servers", num(s["id"]), M{"startup": egg["startup"]}); e != nil {
		t.Fatal(e)
	}
	f.mu.Lock()
	f.Files["/.voltra/archean_parity_wave3.py"] = []byte("custom")
	f.mu.Unlock()
	infraExpect(t, mux, admin, "GET", route, nil, 404)
}

func TestWave161ArcheanPublication(t *testing.T) {
	a, mux, admin, s, f := quickSetupMinecraftFixture(t)
	ctx := context.Background()
	egg := batchSettingsRecipeFixture(t, archeanRepairRecipe)
	if _, e := a.update(ctx, "eggs", num(s["egg_id"]), egg); e != nil {
		t.Fatal(e)
	}
	al, e := a.insert(ctx, "allocations", M{"node_id": s["node_id"], "server_id": s["id"], "ip": "127.0.0.1", "port": 28020})
	if e != nil {
		t.Fatal(e)
	}
	if _, e = a.update(ctx, "servers", num(s["id"]), M{"startup": egg["startup"], "allocation_id": al["id"], "java_config": M{}, "image": "fixture/archean"}); e != nil {
		t.Fatal(e)
	}
	if _, e = a.DB.Exec(ctx, "DELETE FROM server_variables WHERE server_id=$1", s["id"]); e != nil {
		t.Fatal(e)
	}
	if _, e = a.DB.Exec(ctx, "DELETE FROM egg_variables WHERE egg_id=$1", s["egg_id"]); e != nil {
		t.Fatal(e)
	}
	if _, e = a.update(ctx, "eggs", num(s["egg_id"]), M{"name": "Archean", "java_config": M{}, "features": []any{}}); e != nil {
		t.Fatal(e)
	}
	if _, e = a.insert(ctx, "egg_variables", M{"egg_id": s["egg_id"], "name": "Port", "env_variable": "SERVER_PORT", "default_value": "28020", "rules": "required|integer"}); e != nil {
		t.Fatal(e)
	}
	entry, _ := gameSettingsProfile(egg)
	script := str(asMap(asMap(entry.Egg["scripts"])["installation"])["script"])
	re := regexp.MustCompile(`(?s)cat > (\S+) <<'([^']+)'\n(.*?)\n`)
	_ = re
	// Split using each exact delimiter, preserving final LF.
	for _, chunk := range strings.Split(script, "cat > ")[1:] {
		head, body, _ := strings.Cut(chunk, "\n")
		name, marker, ok := strings.Cut(head, " <<'")
		if !ok {
			continue
		}
		data, _, ok := strings.Cut(body, "\n"+strings.TrimSuffix(marker, "'")+"\n")
		if !ok {
			t.Fatal("delimiter")
		}
		f.Files["/"+name] = []byte(data + "\n")
	}
	f.Files[archeanRepairPath] = []byte("[server]\nmax_simultaneous_players=4\npassword=fixture-private-password\n[networking]\nlisten_port=28020\n")
	route := "/api/client/servers/" + str(s["uuid_short"]) + "/game-settings"
	get := func(user int64) M { return asMap(infraExpect(t, mux, user, "GET", route, nil, 200)["attributes"]) }
	put := func(user int64, v M) int {
		status, _, _ := infraRequest(t, mux, user, "PUT", route, M{"revision": v["revision"], "settings": M{"server/max_simultaneous_players": "5"}})
		return status
	}
	unchanged := func(writes int, b []byte) {
		t.Helper()
		if f.Writes != writes || !bytes.Equal(f.Files[archeanRepairPath], b) {
			t.Fatal("refused mutation wrote native bytes")
		}
	}
	view := get(admin)
	found := false
	for _, raw := range asSlice(view["fields"]) {
		field := asMap(raw)
		if str(field["key"]) == "networking/listen_port" {
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
	before := append([]byte(nil), f.Files[archeanRepairPath]...)
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
		if strings.HasSuffix(r.URL.Path, "/files/contents") && r.URL.Query().Get("file") == archeanRepairPath {
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
	for _, kind := range []string{"startup", "helper", "actor"} {
		t.Run("final-read-"+kind, func(t *testing.T) {
			view := get(admin)
			before := append([]byte(nil), f.Files[archeanRepairPath]...)
			writes := f.Writes
			n := 0
			fired := false
			helper := append([]byte(nil), f.Files["/.voltra/archean_parity_wave3.py"]...)
			a.HTTP.Transport = wave161Transport{base, func(r *http.Request) {
				if strings.HasSuffix(r.URL.Path, "/files/contents") && r.URL.Query().Get("file") == archeanRepairPath {
					n++
					if n == finalRead {
						fired = true
						switch kind {
						case "startup":
							_, e = a.update(ctx, "servers", num(s["id"]), M{"startup": "revoked"})
						case "helper":
							f.mu.Lock()
							f.Files["/.voltra/archean_parity_wave3.py"] = []byte("revoked")
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
			unchanged(writes, before)
			a.update(ctx, "servers", num(s["id"]), M{"startup": egg["startup"]})
			a.update(ctx, "users", admin, M{"disabled": false})
			f.Files["/.voltra/archean_parity_wave3.py"] = helper
			t.Logf("final selected read %d revoked %s, status %d, zero writes", n, kind, status)
		})
	}
	t.Run("contended-lock", func(t *testing.T) {
		view := get(admin)
		before := append([]byte(nil), f.Files[archeanRepairPath]...)
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
		if _, e = a.update(ctx, "servers", num(s["id"]), M{"startup": "revoked-under-lock"}); e != nil {
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
