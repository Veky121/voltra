package panel

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestCollaborationTaskValidation(t *testing.T) {
	for _, tt := range []struct{ action, payload, permission string }{{"command", "say test", "control.console"}, {"power", "kill", "control.stop"}, {"power", "restart", "control.restart"}, {"backup", "", "backup.create"}} {
		p, e := collabValidateTask(M{"action": tt.action, "payload": tt.payload, "time_offset": json.Number("0")})
		if e != nil || p != tt.permission {
			t.Fatalf("%v %s: %s %v", tt.action, tt.payload, p, e)
		}
	}
	for _, d := range []M{{"action": "shell", "payload": "rm", "time_offset": 0}, {"action": "power", "payload": "explode", "time_offset": 0}, {"action": "command", "payload": " ", "time_offset": 0}, {"action": "backup", "time_offset": -1}, {"action": "backup", "time_offset": 901}, {"action": "backup", "time_offset": json.Number("1.5")}, {"action": "backup"}} {
		if _, e := collabValidateTask(d); e == nil {
			t.Fatalf("accepted invalid task: %v", d)
		}
	}
}
func TestCollaborationCronValidation(t *testing.T) {
	d := M{"minute": "*/5", "hour": "*", "day_of_month": "*", "month": "*", "day_of_week": "1-5"}
	cr, e := collabCron(d)
	if e != nil {
		t.Fatal(e)
	}
	next := cr.Next(time.Date(2026, 10, 21, 12, 1, 0, 0, time.UTC))
	if next.Minute() != 5 || next.Hour() != 12 {
		t.Fatalf("unexpected next run %v", next)
	}
	for _, invalid := range []string{"60", "* *", "\n*", ""} {
		d["minute"] = invalid
		if _, e = collabCron(d); e == nil {
			t.Fatalf("accepted cron minute %q", invalid)
		}
	}
}

func TestCollaborationNativeCronModifiers(t *testing.T) {
	start := time.Date(2026, 10, 21, 12, 1, 0, 0, time.UTC)
	for _, tt := range []struct {
		day, weekday string
		year         int
		month        time.Month
		date         int
	}{{"*", "7", 2026, 10, 25}, {"L", "*", 2026, 10, 31}, {"15W", "*", 2026, 11, 16}, {"*", "5L", 2026, 10, 30}, {"*", "1#2", 2026, 11, 9}, {"?", "SUN", 2026, 10, 25}, {"1", "MON", 2026, 10, 26}} {
		d := M{"minute": "0", "hour": "0", "day_of_month": tt.day, "month": "*", "day_of_week": tt.weekday}
		cr, e := collabCron(d)
		if e != nil {
			t.Fatalf("%v: %v", d, e)
		}
		got := cr.Next(start)
		want := time.Date(tt.year, tt.month, tt.date, 0, 0, 0, 0, time.UTC)
		if !got.Equal(want) {
			t.Fatalf("%v got %v want %v", d, got, want)
		}
	}
}

func TestCollaborationCronDSTParity(t *testing.T) {
	location, e := time.LoadLocation("Europe/Berlin")
	if e != nil {
		t.Fatal(e)
	}
	// Expected instants were checked against the original vendored PHP
	// CronExpression::getNextRunDate using Europe/Berlin. Native behavior moves
	// nonexistent spring 02:30 to 03:30 and runs both repeated fall 02:30 slots.
	for _, tt := range []struct{ expression, after, want string }{{"30 0 * * *", "2026-10-21T21:00:00Z", "2026-10-21T22:30:00Z"}, {"30 2 * * *", "2026-03-29T00:00:00Z", "2026-03-29T01:30:00Z"}, {"30 2 * * *", "2026-03-29T01:00:00Z", "2026-03-29T01:30:00Z"}, {"30 2 * * *", "2026-10-25T00:00:00Z", "2026-10-25T00:30:00Z"}, {"30 2 * * *", "2026-10-25T00:45:00Z", "2026-10-25T01:30:00Z"}, {"30 2 * * *", "2026-10-25T01:00:00Z", "2026-10-25T01:30:00Z"}, {"30 2 * * *", "2026-10-25T01:45:00Z", "2026-10-26T01:30:00Z"}} {
		t.Run(tt.after, func(t *testing.T) {
			after, e := time.Parse(time.RFC3339, tt.after)
			if e != nil {
				t.Fatal(e)
			}
			want, e := time.Parse(time.RFC3339, tt.want)
			if e != nil {
				t.Fatal(e)
			}
			got := collabCronSchedule(tt.expression).Next(after.In(location))
			if !got.Equal(want) {
				t.Fatalf("%s after %s got %s want %s", tt.expression, after, got, want)
			}
		})
	}
}

func TestCollaborationCronOtherDSTZones(t *testing.T) {
	for _, tt := range []struct{ zone, expression, after, want string }{{"Australia/Lord_Howe", "15 2 * * *", "2026-10-03T15:00:00Z", "2026-10-04T15:15:00Z"}, {"America/New_York", "30 2 * * *", "2026-03-08T06:00:00Z", "2026-03-08T07:30:00Z"}, {"America/New_York", "30 1 * * *", "2026-11-01T05:45:00Z", "2026-11-01T06:30:00Z"}, {"Europe/Berlin", "* * * * *", "2026-10-25T00:59:00Z", "2026-10-25T01:00:00Z"}} {
		t.Run(tt.zone+"/"+tt.after, func(t *testing.T) {
			location, e := time.LoadLocation(tt.zone)
			if e != nil {
				t.Fatal(e)
			}
			after, e := time.Parse(time.RFC3339, tt.after)
			if e != nil {
				t.Fatal(e)
			}
			want, e := time.Parse(time.RFC3339, tt.want)
			if e != nil {
				t.Fatal(e)
			}
			got := collabCronSchedule(tt.expression).Next(after.In(location))
			if !got.Equal(want) {
				t.Fatalf("%s after %s got %s want %s", tt.expression, after, got, want)
			}
		})
	}
}

func TestCollaborationConfiguredTimezoneAndSettingOverride(t *testing.T) {
	after, e := time.Parse(time.RFC3339, "2026-10-21T21:00:00Z")
	if e != nil {
		t.Fatal(e)
	}
	expression := collabCronSchedule("30 0 * * *")
	for _, tt := range []struct{ zone, want string }{{"", "2026-10-22T00:30:00Z"}, {"UTC", "2026-10-22T00:30:00Z"}, {"Europe/Berlin", "2026-10-21T22:30:00Z"}} {
		a := &App{Config: Config{Timezone: tt.zone}}
		got, e := a.collabNextRun(context.Background(), expression, after)
		if e != nil {
			t.Fatal(e)
		}
		want, e := time.Parse(time.RFC3339, tt.want)
		if e != nil || !got.Equal(want) {
			t.Fatalf("zone %q got %v want %v err %v", tt.zone, got, want, e)
		}
	}
	a, ctx := collabTestApp(t)
	a.Config.Timezone = "America/New_York"
	if e = a.exec(ctx, "INSERT INTO settings(key,value) VALUES('app:timezone','\"Europe/Berlin\"'::jsonb)"); e != nil {
		t.Fatal(e)
	}
	got, e := a.collabNextRun(ctx, expression, after)
	if e != nil {
		t.Fatal(e)
	}
	if got.UTC().Format(time.RFC3339) != "2026-10-21T22:30:00Z" {
		t.Fatal("persisted setting did not override environment timezone", got)
	}
	daemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(204) }))
	defer daemon.Close()
	user, server := collabFixture(t, a, ctx, daemon.URL)
	before := time.Now()
	expected := expression.Next(before.In(got.Location()))
	code, out := collabRequest(t, a, num(user["id"]), "POST", "/api/client/servers/"+str(server["uuid_short"])+"/schedules", M{"name": "Berlin schedule", "minute": "30", "hour": "0", "day_of_month": "*", "month": "*", "day_of_week": "*", "is_active": true})
	if code != 200 {
		t.Fatal(code, out)
	}
	schedule := asMap(out["attributes"])
	actual, e := time.Parse(time.RFC3339Nano, str(schedule["next_run_at"]))
	if e != nil || !actual.Equal(expected) {
		t.Fatal("schedule create ignored configured timezone", actual, expected, e)
	}
	sid := num(schedule["id"])
	if _, e = a.insert(ctx, "tasks", M{"schedule_id": sid, "sequence_id": 1, "action": "command", "payload": "noop"}); e != nil {
		t.Fatal(e)
	}
	if e = a.collabQueueSchedule(ctx, sid, true); e != nil {
		t.Fatal(e)
	}
	queued, e := a.one(ctx, "SELECT next_run_at FROM schedules WHERE id=$1", sid)
	if e != nil {
		t.Fatal(e)
	}
	next, ok := queued["next_run_at"].(time.Time)
	if !ok || !next.Equal(expected) {
		t.Fatal("queued next run ignored configured timezone", queued, expected)
	}
}
func TestCollaborationDatabaseInput(t *testing.T) {
	name, e := collabDatabaseName(123, "world_data")
	if e != nil || name != "s123_world_data" {
		t.Fatal(name, e)
	}
	name, e = collabDatabaseName(123, strings.Repeat("a", 48))
	if e != nil || len(name) != 48 {
		t.Fatal(name, e)
	}
	for _, name := range []string{"", "x`;DROP DATABASE mysql;--", "../world", "two words"} {
		if _, e := collabDatabaseName(1, name); e == nil {
			t.Fatalf("accepted %q", name)
		}
	}
	if collabRemoteRE.MatchString("%';DROP USER x;--") {
		t.Fatal("SQL remote injection accepted")
	}
	if !collabRemoteRE.MatchString("192.168.1.%") {
		t.Fatal("wildcard not accepted")
	}
}
func TestCollaborationActivityRedaction(t *testing.T) {
	original := M{"password": "secret", "ip": "192.0.2.1", "nested": M{"access_token": "secret", "name": "safe"}, "items": []any{M{"secret": "s"}}}
	got := collabRedactProperties(original, true)
	if got["password"] != "[hidden]" || got["ip"] != "[hidden]" || asMap(got["nested"])["access_token"] != "[hidden]" || asMap(asSlice(got["items"])[0])["secret"] != "[hidden]" {
		t.Fatalf("secret exposed: %v", got)
	}
	if original["password"] != "secret" {
		t.Fatal("redaction mutated source")
	}
}

func collabTestApp(t *testing.T) (*App, context.Context) {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL is required for isolated PostgreSQL integration")
	}
	ctx := context.Background()
	base, e := pgxpool.New(ctx, url)
	if e != nil {
		t.Fatal(e)
	}
	name := "collab_" + randomToken(6)
	if _, e = base.Exec(ctx, "CREATE SCHEMA "+name); e != nil {
		base.Close()
		t.Fatal(e)
	}
	cfg, e := pgxpool.ParseConfig(url)
	if e != nil {
		t.Fatal(e)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = name
	pool, e := pgxpool.NewWithConfig(ctx, cfg)
	if e != nil {
		t.Fatal(e)
	}
	a := &App{DB: pool, HTTP: &http.Client{Timeout: 5 * time.Second}, Config: Config{EncryptionKey: "collaboration-integration-tests-only-key"}}
	if _, e = pool.Exec(ctx, schema); e != nil {
		pool.Close()
		base.Exec(ctx, "DROP SCHEMA "+name+" CASCADE")
		base.Close()
		t.Fatal(e)
	}
	t.Cleanup(func() { pool.Close(); base.Exec(ctx, "DROP SCHEMA "+name+" CASCADE"); base.Close() })
	return a, ctx
}
func collabFixture(t *testing.T, a *App, ctx context.Context, daemonURL string) (M, M) {
	t.Helper()
	must := func(m M, e error) M {
		if e != nil {
			t.Fatal(e)
		}
		return m
	}
	u := must(a.insert(ctx, "users", M{"uuid": newUUID(), "username": "owner", "email": "owner@example.test"}))
	location := must(a.insert(ctx, "locations", M{"short": "test"}))
	host, portText, e := net.SplitHostPort(strings.TrimPrefix(daemonURL, "http://"))
	if e != nil {
		t.Fatal(e)
	}
	port, _ := strconv.Atoi(portText)
	sealed, e := a.seal("test-secret")
	if e != nil {
		t.Fatal(e)
	}
	node := must(a.insert(ctx, "nodes", M{"uuid": newUUID(), "name": "test", "location_id": location["id"], "fqdn": host, "daemon_listen": port, "daemon_token_id": "test", "daemon_token": sealed}))
	nest := must(a.insert(ctx, "nests", M{"uuid": newUUID(), "author": "test@example.test", "name": "test"}))
	egg := must(a.insert(ctx, "eggs", M{"uuid": newUUID(), "nest_id": nest["id"], "author": "test@example.test", "name": "test"}))
	uuid := newUUID()
	s := must(a.insert(ctx, "servers", M{"uuid": uuid, "uuid_short": uuid[:8], "identifier": uuid[:8], "name": "test", "owner_id": u["id"], "node_id": node["id"], "nest_id": nest["id"], "egg_id": egg["id"], "image": "alpine:latest", "installed_at": time.Now(), "database_limit": 2, "backup_limit": 2}))
	return u, s
}
func collabRequest(t *testing.T, a *App, userID int64, method, path string, body M) (int, M) {
	t.Helper()
	mux := http.NewServeMux()
	a.registerCollaboration(mux)
	var raw string
	if body != nil {
		raw = collabJSON(body)
	}
	req := WithUser(httptest.NewRequest(method, path, strings.NewReader(raw)), userID)
	res := httptest.NewRecorder()
	mux.ServeHTTP(res, req)
	var out M
	if res.Body.Len() > 0 {
		if e := json.Unmarshal(res.Body.Bytes(), &out); e != nil {
			t.Fatalf("response %s: %v", res.Body, e)
		}
	}
	return res.Code, out
}

func TestCollaborationPostgresSchedulingAndSubusers(t *testing.T) {
	a, ctx := collabTestApp(t)
	var mu sync.Mutex
	calls := []string{}
	failCommand := false
	daemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		calls = append(calls, r.URL.Path)
		if strings.HasSuffix(r.URL.Path, "/commands") && failCommand {
			http.Error(w, "rejected", 500)
			return
		}
		if r.Method == "GET" {
			writeJSON(w, 200, M{"state": "running"})
			return
		}
		w.WriteHeader(204)
	}))
	defer daemon.Close()
	u, s := collabFixture(t, a, ctx, daemon.URL)
	uid := num(u["id"])
	base := "/api/client/servers/" + str(s["uuid_short"])
	code, out := collabRequest(t, a, uid, "POST", base+"/users", M{"email": "invited@example.test", "permissions": []string{"schedule.read", "schedule.update", "user.create", "user.update", "control.console"}})
	if code != 200 {
		t.Fatalf("invite %d %v", code, out)
	}
	invited := asMap(out["attributes"])
	invitedID := num(invited["id"])
	account, accountErr := a.one(ctx, "SELECT username FROM users WHERE id=$1", invitedID)
	if accountErr != nil || !usernamePattern.MatchString(str(account["username"])) {
		t.Fatalf("invitation username violates native account invariant: %v", accountErr)
	}
	code, out = collabRequest(t, a, invitedID, "POST", base+"/users", M{"email": "escalated@example.test", "permissions": []string{"file.delete"}})
	if code != 403 {
		t.Fatalf("permission escalation %d %v", code, out)
	}
	code, out = collabRequest(t, a, uid, "POST", base+"/schedules", M{"name": "test schedule", "minute": "*", "hour": "*", "day_of_month": "*", "month": "*", "day_of_week": "*", "is_active": true})
	if code != 200 {
		t.Fatalf("schedule %d %v", code, out)
	}
	sid := num(asMap(out["attributes"])["id"])
	scheduleBase := base + "/schedules/" + strconv.FormatInt(sid, 10)
	var taskIDs []int64
	for _, d := range []M{{"action": "command", "payload": "first", "time_offset": 0}, {"action": "power", "payload": "restart", "time_offset": 0}, {"action": "command", "payload": "inserted", "time_offset": 0, "sequence_id": 1}} {
		code, out = collabRequest(t, a, uid, "POST", scheduleBase+"/tasks", d)
		if code != 200 {
			t.Fatalf("task %d %v", code, out)
		}
		taskIDs = append(taskIDs, num(asMap(out["attributes"])["id"]))
	}
	code, out = collabRequest(t, a, uid, "POST", scheduleBase+"/tasks/"+strconv.FormatInt(taskIDs[1], 10), M{"action": "power", "payload": "restart", "time_offset": 0, "sequence_id": 1})
	if code != 200 {
		t.Fatalf("reorder %d %v", code, out)
	}
	tasks, e := a.query(ctx, "SELECT id,sequence_id FROM tasks WHERE schedule_id=$1 ORDER BY sequence_id", sid)
	if e != nil || len(tasks) != 3 || num(tasks[0]["id"]) != taskIDs[1] {
		t.Fatalf("reorder failed %v %v", tasks, e)
	}
	for i, row := range tasks {
		if num(row["sequence_id"]) != int64(i+1) {
			t.Fatal("sequence gap")
		}
	}
	code, out = collabRequest(t, a, uid, "POST", scheduleBase+"/execute", nil)
	if code != 202 {
		t.Fatalf("queue %d %v", code, out)
	}
	for i := 0; i < 3; i++ {
		ran, e := a.collabSchedulerStep(ctx)
		if e != nil || !ran {
			t.Fatalf("step %v %v", ran, e)
		}
	}
	run, e := a.one(ctx, "SELECT * FROM schedule_runs WHERE schedule_id=$1", sid)
	if e != nil || str(run["status"]) != "completed" {
		t.Fatalf("run %v %v", run, e)
	}
	schedule, e := a.one(ctx, "SELECT * FROM schedules WHERE id=$1", sid)
	if e != nil || boolean(schedule["is_processing"]) || schedule["last_run_at"] == nil {
		t.Fatalf("completion %v %v", schedule, e)
	}
	mu.Lock()
	failCommand = true
	mu.Unlock()
	if e = a.collabQueueSchedule(ctx, sid, true); e != nil {
		t.Fatal(e)
	}
	for i := 0; i < 2; i++ {
		if _, e = a.collabSchedulerStep(ctx); e != nil {
			t.Fatal(e)
		}
	}
	run, e = a.one(ctx, "SELECT * FROM schedule_runs WHERE schedule_id=$1 ORDER BY id DESC LIMIT 1", sid)
	if e != nil || str(run["status"]) != "failed" {
		t.Fatalf("failure not persisted %v %v", run, e)
	}
	code, out = collabRequest(t, a, uid, "POST", base+"/users/"+str(invited["uuid"]), M{"permissions": []string{"file.read"}})
	if code != 200 {
		t.Fatalf("permission update %d %v", code, out)
	}
	for i := 0; i < 4; i++ {
		ran, e := a.processRevocation(ctx)
		if e != nil {
			t.Fatal(e)
		}
		if !ran {
			break
		}
	}
	mu.Lock()
	found := false
	for _, p := range calls {
		if p == "/api/deauthorize-user" {
			found = true
		}
	}
	mu.Unlock()
	if !found {
		t.Fatal("daemon user sessions were not revoked")
	}
	if e = a.audit(ctx, uid, num(s["id"]), "server:test", M{"password": "never-return"}); e != nil {
		t.Fatal(e)
	}
	code, out = collabRequest(t, a, uid, "GET", base+"/activity?per_page=1&filter[event]=server:test", nil)
	if code != 200 {
		t.Fatalf("activity %d %v", code, out)
	}
	if strings.Contains(collabJSON(out), "never-return") {
		t.Fatal("secret in activity")
	}
	if num(asMap(asMap(out["meta"])["pagination"])["total"]) != 1 {
		t.Fatal("activity pagination count")
	}
	code, out = collabRequest(t, a, uid, "DELETE", base+"/users/"+str(invited["uuid"]), nil)
	if code != 204 {
		t.Fatal("remove subuser", code, out)
	}

}

func TestCollaborationRealMySQLProvisioning(t *testing.T) {
	if os.Getenv("TEST_MYSQL_HOST") == "" {
		t.Skip("TEST_MYSQL_HOST and TEST_MYSQL_USER required for real game database integration")
	}
	a, ctx := collabTestApp(t)
	daemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(204) }))
	defer daemon.Close()
	_, s := collabFixture(t, a, ctx, daemon.URL)
	password, e := a.seal(os.Getenv("TEST_MYSQL_PASSWORD"))
	if e != nil {
		t.Fatal(e)
	}
	port := collabID(os.Getenv("TEST_MYSQL_PORT"))
	if port == 0 {
		port = 3306
	}
	host, e := a.insert(ctx, "database_hosts", M{"name": "integration", "host": os.Getenv("TEST_MYSQL_HOST"), "port": port, "username": os.Getenv("TEST_MYSQL_USER"), "password": password, "node_id": s["node_id"], "max_databases": 1})
	if e != nil {
		t.Fatal(e)
	}
	d, e := a.collabCreateDatabase(ctx, s, M{"database": "integration_" + randomToken(4), "remote": "%", "max_connections": 2}, false)
	if e != nil {
		t.Fatal(e)
	}
	defer a.collabDeleteDatabase(ctx, d)
	plain, e := a.unseal(str(d["password"]))
	if e != nil {
		t.Fatal(e)
	}
	assertLogin := func(password string, want bool) {
		t.Helper()
		cfg := fmt.Sprintf("%s:%s@tcp(%s)/%s", str(d["username"]), password, net.JoinHostPort(str(host["host"]), str(host["port"])), str(d["database"]))
		db, e := sql.Open("mysql", cfg)
		if e != nil {
			t.Fatal(e)
		}
		defer db.Close()
		e = db.PingContext(ctx)
		if (e == nil) != want {
			t.Fatalf("login got %v expected success %v", e, want)
		}
		if want {
			if _, e = db.ExecContext(ctx, "CREATE TABLE IF NOT EXISTS persistence_test(id int PRIMARY KEY,value text)"); e != nil {
				t.Fatal(e)
			}
		}
	}
	assertLogin(plain, true)
	// Enforce the real MySQL resource limit, rather than only checking metadata.
	limitedDSN := fmt.Sprintf("%s:%s@tcp(%s)/%s", str(d["username"]), plain, net.JoinHostPort(str(host["host"]), str(host["port"])), str(d["database"]))
	limitedDB, e := sql.Open("mysql", limitedDSN)
	if e != nil {
		t.Fatal(e)
	}
	limitedDB.SetMaxOpenConns(3)
	c1, e := limitedDB.Conn(ctx)
	if e != nil {
		limitedDB.Close()
		t.Fatal(e)
	}
	c2, e := limitedDB.Conn(ctx)
	if e != nil {
		c1.Close()
		limitedDB.Close()
		t.Fatal(e)
	}
	c3, e := limitedDB.Conn(ctx)
	if c3 != nil {
		c3.Close()
	}
	c1.Close()
	c2.Close()
	limitedDB.Close()
	if e == nil {
		t.Fatal("MySQL MAX_USER_CONNECTIONS not enforced")
	}
	if _, e = a.collabCreateDatabase(ctx, s, M{"database": "must_fail", "remote": "%"}, false); e == nil {
		t.Fatal("host capacity limit ignored")
	}
	d, e = a.collabRotateDatabase(ctx, d)
	if e != nil {
		t.Fatal(e)
	}
	assertLogin(plain, false)
	plain, e = a.unseal(str(d["password"]))
	if e != nil {
		t.Fatal(e)
	}
	assertLogin(plain, true)
	if e = a.collabDeleteDatabase(ctx, d); e != nil {
		t.Fatal(e)
	}
	assertLogin(plain, false)
	// A host that can create schemas/users but cannot grant application privileges
	// must not leave orphan resources after failing halfway through provisioning.
	adminDB, e := a.collabMySQL(ctx, host)
	if e != nil {
		t.Fatal(e)
	}
	defer adminDB.Close()
	limitedUser := "limited_" + randomToken(4)
	limitedPassword := randomToken(12)
	account := collabQuoteString(limitedUser) + "@'%'"
	if _, e = adminDB.ExecContext(ctx, "CREATE USER "+account+" IDENTIFIED BY "+collabQuoteString(limitedPassword)); e != nil {
		t.Fatal(e)
	}
	defer adminDB.ExecContext(ctx, "DROP USER IF EXISTS "+account)
	if _, e = adminDB.ExecContext(ctx, "GRANT CREATE,DROP,CREATE USER ON *.* TO "+account); e != nil {
		t.Fatal(e)
	}
	limitedSealed, e := a.seal(limitedPassword)
	if e != nil {
		t.Fatal(e)
	}
	limitedHost, e := a.insert(ctx, "database_hosts", M{"name": "restricted", "host": host["host"], "port": host["port"], "username": limitedUser, "password": limitedSealed})
	if e != nil {
		t.Fatal(e)
	}
	failedName := "fail_" + randomToken(4)
	if _, e = a.collabCreateDatabase(ctx, s, M{"host": limitedHost["id"], "database": failedName, "remote": "%"}, true); e == nil {
		t.Fatal("restricted host provisioning unexpectedly succeeded")
	}
	prefixedName, e := collabDatabaseName(num(s["id"]), failedName)
	if e != nil {
		t.Fatal(e)
	}
	var orphanCount int
	if e = adminDB.QueryRowContext(ctx, "SELECT count(*) FROM information_schema.schemata WHERE schema_name=?", prefixedName).Scan(&orphanCount); e != nil || orphanCount != 0 {
		t.Fatalf("orphan schema after rollback count=%d err=%v", orphanCount, e)
	}
}

func TestCollaborationSchedulerDelaysRecoveryAndOffline(t *testing.T) {
	a, ctx := collabTestApp(t)
	online := false
	commands, backups := 0, 0
	daemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == "GET":
			state := "offline"
			if online {
				state = "running"
			}
			writeJSON(w, 200, M{"state": state})
		case strings.HasSuffix(r.URL.Path, "/commands"):
			commands++
			http.Error(w, "task failure", 500)
		case strings.HasSuffix(r.URL.Path, "/backup"):
			backups++
			w.WriteHeader(204)
		default:
			w.WriteHeader(204)
		}
	}))
	defer daemon.Close()
	u, s := collabFixture(t, a, ctx, daemon.URL)
	schedule, e := a.insert(ctx, "schedules", M{"server_id": s["id"], "name": "recovery", "only_when_online": true, "next_run_at": time.Now().Add(-time.Minute)})
	if e != nil {
		t.Fatal(e)
	}
	sid := num(schedule["id"])
	_, e = a.insert(ctx, "tasks", M{"schedule_id": sid, "sequence_id": 1, "action": "command", "payload": "fails", "time_offset": 30, "continue_on_failure": true})
	if e != nil {
		t.Fatal(e)
	}
	_, e = a.insert(ctx, "tasks", M{"schedule_id": sid, "sequence_id": 2, "action": "backup", "payload": "cache\n*.tmp", "time_offset": 60})
	if e != nil {
		t.Fatal(e)
	}
	if e = a.collabQueueSchedule(ctx, sid, false); e != nil {
		t.Fatal(e)
	}
	ran, e := a.collabSchedulerStep(ctx)
	if e != nil || ran {
		t.Fatalf("initial task delay ignored %v %v", ran, e)
	}
	if e = a.exec(ctx, "UPDATE schedule_runs SET run_after=now()-interval '1 second' WHERE schedule_id=$1", sid); e != nil {
		t.Fatal(e)
	}
	ran, e = a.collabSchedulerStep(ctx)
	if e != nil || !ran {
		t.Fatal(ran, e)
	}
	if commands != 0 || backups != 0 {
		t.Fatal("offline schedule performed actions")
	}
	run, e := a.one(ctx, "SELECT * FROM schedule_runs WHERE schedule_id=$1", sid)
	if e != nil || str(run["status"]) != "completed" {
		t.Fatal(run, e)
	}
	online = true
	if e = a.collabQueueSchedule(ctx, sid, true); e != nil {
		t.Fatal(e)
	}
	ran, e = a.collabSchedulerStep(ctx)
	if e != nil || !ran {
		t.Fatal(ran, e)
	}
	if commands != 1 || backups != 0 {
		t.Fatal("first task execution did not continue after failure")
	}
	ran, e = a.collabSchedulerStep(ctx)
	if e != nil || ran {
		t.Fatal("second task delay ignored", ran, e)
	}
	// A new App object represents a restarted process. All queue and timing state
	// comes from PostgreSQL, with no goroutine or in-memory queue to restore.
	restarted := &App{DB: a.DB, Config: a.Config, HTTP: a.HTTP}
	if e = a.exec(ctx, "UPDATE schedule_runs SET run_after=now()-interval '1 second' WHERE schedule_id=$1 AND status='pending'", sid); e != nil {
		t.Fatal(e)
	}
	ran, e = restarted.collabSchedulerStep(ctx)
	if e != nil || !ran {
		t.Fatal(ran, e)
	}
	if backups != 1 {
		t.Fatal("persisted backup task not resumed")
	}
	backup, e := a.one(ctx, "SELECT * FROM backups WHERE server_id=$1", s["id"])
	if e != nil || len(asSlice(backup["ignored_files"])) != 2 {
		t.Fatal("backup ignore payload not passed", backup, e)
	}
	status, e := a.one(ctx, "SELECT * FROM schedules WHERE id=$1", sid)
	if e != nil || boolean(status["is_processing"]) {
		t.Fatal("schedule still processing", status, e)
	}
	base := "/api/client/servers/" + str(s["uuid_short"]) + "/schedules/" + str(sid)
	code, out := collabRequest(t, a, num(u["id"]), "DELETE", base+"/tasks/1", nil)
	if code != 204 {
		t.Fatal("task delete", code, out)
	}
	tasks, e := a.query(ctx, "SELECT sequence_id FROM tasks WHERE schedule_id=$1", sid)
	if e != nil || len(tasks) != 1 || num(tasks[0]["sequence_id"]) != 1 {
		t.Fatal("delete failed to close sequence gap", tasks, e)
	}
}

func TestCollaborationLiveQueuedTaskEdits(t *testing.T) {
	a, ctx := collabTestApp(t)
	var commands []string
	daemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/commands") {
			var body struct {
				Commands []string `json:"commands"`
			}
			if e := json.NewDecoder(r.Body).Decode(&body); e != nil {
				t.Error(e)
			}
			commands = append(commands, body.Commands...)
		}
		w.WriteHeader(204)
	}))
	defer daemon.Close()
	u, s := collabFixture(t, a, ctx, daemon.URL)
	schedule, e := a.insert(ctx, "schedules", M{"server_id": s["id"], "name": "live editing", "next_run_at": time.Now().Add(-time.Minute)})
	if e != nil {
		t.Fatal(e)
	}
	sid := num(schedule["id"])
	first, e := a.insert(ctx, "tasks", M{"schedule_id": sid, "sequence_id": 1, "action": "command", "payload": "old payload", "time_offset": 300})
	if e != nil {
		t.Fatal(e)
	}
	second, e := a.insert(ctx, "tasks", M{"schedule_id": sid, "sequence_id": 2, "action": "command", "payload": "moved before queued task"})
	if e != nil {
		t.Fatal(e)
	}
	if e = a.collabQueueSchedule(ctx, sid, false); e != nil {
		t.Fatal(e)
	}
	base := "/api/client/servers/" + str(s["uuid_short"]) + "/schedules/" + str(sid)
	code, out := collabRequest(t, a, num(u["id"]), "POST", base+"/tasks/"+str(first["id"]), M{"action": "command", "payload": "edited live payload", "time_offset": 300, "sequence_id": 2})
	if code != 200 {
		t.Fatal("edit delayed task", code, out)
	}
	code, out = collabRequest(t, a, num(u["id"]), "POST", base+"/tasks", M{"action": "command", "payload": "appended while queued", "time_offset": 0})
	if code != 200 {
		t.Fatal("append while queued", code, out)
	}
	if e = a.exec(ctx, "UPDATE schedule_runs SET run_after=now()-interval '1 second' WHERE schedule_id=$1 AND status='pending'", sid); e != nil {
		t.Fatal(e)
	}
	for i := 0; i < 2; i++ {
		ran, e := a.collabSchedulerStep(ctx)
		if e != nil || !ran {
			t.Fatal(ran, e)
		}
	}
	if len(commands) != 2 || commands[0] != "edited live payload" || commands[1] != "appended while queued" {
		t.Fatalf("wrong queued model/order: %v", commands)
	}
	if ran, e := a.collabSchedulerStep(ctx); e != nil || ran {
		t.Fatal("task executed twice", ran, e)
	}
	if e = a.collabQueueSchedule(ctx, sid, true); e != nil {
		t.Fatal(e)
	}
	code, out = collabRequest(t, a, num(u["id"]), "DELETE", base+"/tasks/"+str(second["id"]), nil)
	if code != 204 {
		t.Fatal("delete queued model", code, out)
	}
	if ran, e := a.collabSchedulerStep(ctx); e != nil || ran {
		t.Fatal("deleted task dispatched another model", ran, e)
	}
	latest, e := a.one(ctx, "SELECT * FROM schedule_runs WHERE schedule_id=$1 ORDER BY id DESC LIMIT 1", sid)
	if e != nil || str(latest["status"]) != "completed" {
		t.Fatal("deleted job not canceled", latest, e)
	}
	parent, e := a.one(ctx, "SELECT * FROM schedules WHERE id=$1", sid)
	if e != nil || boolean(parent["is_processing"]) {
		t.Fatal("deleted queued model left processing stuck", parent, e)
	}
}

func TestCollaborationConcurrentWorkersDoNotDuplicateTask(t *testing.T) {
	a, ctx := collabTestApp(t)
	started, release := make(chan struct{}), make(chan struct{})
	calls := 0
	daemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls++; close(started); <-release; w.WriteHeader(204) }))
	defer daemon.Close()
	_, s := collabFixture(t, a, ctx, daemon.URL)
	schedule, e := a.insert(ctx, "schedules", M{"server_id": s["id"], "name": "concurrent workers"})
	if e != nil {
		t.Fatal(e)
	}
	sid := num(schedule["id"])
	if _, e = a.insert(ctx, "tasks", M{"schedule_id": sid, "sequence_id": 1, "action": "command", "payload": "once"}); e != nil {
		t.Fatal(e)
	}
	if e = a.collabQueueSchedule(ctx, sid, true); e != nil {
		t.Fatal(e)
	}
	done := make(chan error, 1)
	go func() {
		ran, e := a.collabSchedulerStep(ctx)
		if e == nil && !ran {
			e = fmt.Errorf("first worker did not claim job")
		}
		done <- e
	}()
	select {
	case <-started:
	case <-time.After(5 * time.Second):
		close(release)
		t.Fatal("worker did not reach daemon")
	}
	ran, e := a.collabSchedulerStep(ctx)
	close(release)
	if e != nil || ran {
		t.Fatal("second worker claimed locked task", ran, e)
	}
	if e = <-done; e != nil {
		t.Fatal(e)
	}
	if calls != 1 {
		t.Fatalf("daemon called %d times", calls)
	}
}

func TestCollaborationApplicationDatabaseHostIncludes(t *testing.T) {
	a, ctx := collabTestApp(t)
	daemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(204) }))
	defer daemon.Close()
	u, s := collabFixture(t, a, ctx, daemon.URL)
	if e := a.exec(ctx, "UPDATE users SET root_admin=true WHERE id=$1", u["id"]); e != nil {
		t.Fatal(e)
	}
	hostSecret, e := a.seal("never-return-host-password")
	if e != nil {
		t.Fatal(e)
	}
	host, e := a.insert(ctx, "database_hosts", M{"name": "host include", "host": "127.0.0.1", "username": "host-admin", "password": hostSecret})
	if e != nil {
		t.Fatal(e)
	}
	secret, e := a.seal("generated-db-password")
	if e != nil {
		t.Fatal(e)
	}
	d, e := a.insert(ctx, "databases", M{"server_id": s["id"], "database_host_id": host["id"], "database": "test_view", "username": "test_view", "password": secret})
	if e != nil {
		t.Fatal(e)
	}
	mux := http.NewServeMux()
	a.registerCollaboration(mux)
	path := "/api/application/servers/" + str(s["id"]) + "/databases/" + str(d["id"]) + "?include=password,host"
	for _, hostScope := range []int64{0, 1} {
		req := WithUser(httptest.NewRequest("GET", path, nil), num(u["id"]))
		req = req.WithContext(context.WithValue(req.Context(), apiKeyContextKey{}, M{"type": "application", "permissions": M{"server_databases": int64(1), "database_hosts": hostScope}}))
		res := httptest.NewRecorder()
		mux.ServeHTTP(res, req)
		if res.Code != 200 {
			t.Fatal(res.Code, res.Body.String())
		}
		var response M
		if e = json.Unmarshal(res.Body.Bytes(), &response); e != nil {
			t.Fatal(e)
		}
		relationships := asMap(asMap(response["attributes"])["relationships"])
		if _, included := relationships["host"]; included != (hostScope == 1) {
			t.Fatal("host scope not enforced", relationships)
		}
		if strings.Contains(res.Body.String(), "never-return-host-password") || strings.Contains(res.Body.String(), "enc:v1:") {
			t.Fatal("host credentials leaked")
		}
		if !strings.Contains(res.Body.String(), "generated-db-password") {
			t.Fatal("requested generated database password missing")
		}
	}
}
