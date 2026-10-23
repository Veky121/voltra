package panel

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"
)

type configurationWings struct {
	mu               sync.Mutex
	app              *App
	state            string
	reject           int
	badState         bool
	stateUnavailable bool
	calls            []string
	snapshots        []M
	callbackErrors   []error
}

type configurationUnavailableTransport struct{}

func (configurationUnavailableTransport) RoundTrip(*http.Request) (*http.Response, error) {
	return nil, context.DeadlineExceeded
}

func (f *configurationWings) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls = append(f.calls, r.Method+" "+r.URL.Path)
	if r.Header.Get("Authorization") != "Bearer configuration-fixture-token" {
		w.WriteHeader(401)
		return
	}
	if r.Method == "GET" && strings.HasPrefix(r.URL.Path, "/api/servers/") {
		if f.stateUnavailable {
			writeJSON(w, 503, M{"error": "private-daemon-error-detail"})
			return
		}
		if f.badState {
			_, _ = w.Write([]byte("not JSON"))
			return
		}
		writeJSON(w, 200, M{"state": f.state})
		return
	}
	if r.Method == "POST" && strings.HasSuffix(r.URL.Path, "/sync") {
		// Wings synchronizes by reading committed panel state. Read through a
		// different DB connection to expose hidden writes or callback deadlocks.
		uuid := strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/api/servers/"), "/sync")
		server, err := f.app.one(r.Context(), "SELECT * FROM servers WHERE uuid=$1", uuid)
		var effective M
		if err == nil {
			effective, err = f.app.serverEffectiveEgg(r.Context(), server)
		}
		if err != nil {
			f.callbackErrors = append(f.callbackErrors, err)
			w.WriteHeader(500)
			return
		}
		f.snapshots = append(f.snapshots, M{"overrides": server["configuration_overrides"], "effective": configurationValues(effective), "process": eggDaemonConfig(effective, M{})})
		if f.reject > 0 {
			f.reject--
			w.WriteHeader(503)
			return
		}
		w.WriteHeader(204)
		return
	}
	w.WriteHeader(405) // No power, installation, or file writes are implemented.
}

func configurationFixture(t *testing.T) (*App, *http.ServeMux, int64, M, M, *configurationWings) {
	t.Helper()
	a, _, admin := infraTestApp(t)
	ctx := context.Background()
	f := &configurationWings{app: a, state: "offline"}
	wings := httptest.NewServer(f)
	t.Cleanup(wings.Close)
	insert := func(table string, values M) M {
		t.Helper()
		row, err := a.insert(ctx, table, values)
		if err != nil {
			t.Fatal(err)
		}
		return row
	}
	location := insert("locations", M{"short": "configuration-fixture"})
	data := daemonTestNode(t, wings)
	data["uuid"], data["name"], data["location_id"] = newUUID(), "Configuration fixture", location["id"]
	var err error
	data["daemon_token"], err = a.seal("configuration-fixture-token")
	if err != nil {
		t.Fatal(err)
	}
	node := insert("nodes", data)
	nest := insert("nests", M{"uuid": newUUID(), "name": "Configuration fixture", "author": "fixture@example.invalid"})
	egg := insert("eggs", M{"uuid": newUUID(), "nest_id": nest["id"], "name": "Shared defaults", "author": "fixture@example.invalid", "startup": "echo ready", "config_startup": M{"done": "ready"}, "config_files": M{}, "config_stop": "stop", "script_install": "#!/bin/sh\necho original\n", "script_entry": "sh", "script_container": "alpine:3.21"})
	newServer := func(name string) M {
		return insert("servers", M{"uuid": newUUID(), "uuid_short": randomToken(4), "identifier": randomToken(4), "name": name, "owner_id": admin, "node_id": node["id"], "nest_id": nest["id"], "egg_id": egg["id"], "startup": "echo ready", "image": "alpine:3.21"})
	}
	first, second := newServer("First"), newServer("Second")
	mux := http.NewServeMux()
	a.registerServerConfiguration(mux)
	return a, mux, admin, first, second, f
}

func configurationEndpoint(server M) string {
	return "/api/client/servers/" + str(server["uuid_short"]) + "/configuration"
}
func configurationGet(t *testing.T, mux http.Handler, admin int64, server M) M {
	t.Helper()
	return asMap(infraExpect(t, mux, admin, "GET", configurationEndpoint(server), nil, 200)["attributes"])
}

func TestServerConfigurationValidation(t *testing.T) {
	valid := []string{
		`{}`, `{"config_files":{},"config_startup":{},"config_stop":"","script_install":""}`,
		`{"config_files":{"config/server.properties":{"parser":"properties","find":{"port":"{{server.build.default.port}}","enabled":true,"count":4,"conditional":{"old":"new"}}}},"config_startup":{"done":["ready","listening"],"strip_ansi":true},"config_stop":"^C","script_install":"#!/bin/sh\n  echo exact  \n","script_container":"ghcr.io/example/installer:latest","script_entry":"/bin/sh"}`,
	}
	for _, input := range valid {
		var value any
		if err := json.Unmarshal([]byte(input), &value); err != nil {
			t.Fatal(err)
		}
		if _, err := validateServerConfiguration(value); err != nil {
			t.Errorf("valid input rejected: %v", err)
		}
	}
	invalid := []string{
		`[]`, `{"java_config":{}}`, `{"script_is_privileged":true}`, `{"startup":"danger"}`, `{"config_from":1}`,
		`{"config_files":null}`, `{"config_startup":[]}`, `{"config_stop":null}`, `{"script_install":4}`,
		`{"config_startup":{"done":[1]}}`, `{"config_startup":{"done":true}}`, `{"config_startup":{"strip_ansi":"true"}}`, `{"config_startup":{"unknown":true}}`,
		`{"script_entry":"sh -c"}`, `{"script_entry":"../sh"}`, `{"script_container":"image;curl secret"}`, `{"config_stop":"stop\nstart"}`, `{"script_install":"secret\u0000"}`,
		`{"config_files":{"../outside":{"parser":"file","find":{}}}}`, `{"config_files":{"/absolute":{"parser":"file","find":{}}}}`, `{"config_files":{"a/../../outside":{"parser":"file","find":{}}}}`,
		`{"config_files":{"C:/outside":{"parser":"file","find":{}}}}`, `{"config_files":{"a\\b":{"parser":"file","find":{}}}}`, `{"config_files":{"a":{"parser":"unknown","find":{}}}}`,
		`{"config_files":{"a":{"parser":"file"}}}`, `{"config_files":{"a":{"parser":"file","find":{},"file":"../outside"}}}`, `{"config_files":{"a":{"parser":"file","find":{"match":[1]}}}}`, `{"config_files":{"a":{"parser":"file","find":{"match":{"condition":{}}}}}}`,
	}
	for _, input := range invalid {
		var value any
		if err := json.Unmarshal([]byte(input), &value); err != nil {
			t.Fatal(err)
		}
		if _, err := validateServerConfiguration(value); err == nil {
			t.Errorf("invalid input accepted: %s", input)
		}
	}
	if _, err := validateServerConfiguration(M{"script_install": strings.Repeat("x", 512<<10+1)}); err == nil {
		t.Fatal("oversized installer accepted")
	}
}

func TestServerConfigurationReadinessKeepsGETReadable(t *testing.T) {
	a, mux, admin, server, _, f := configurationFixture(t)
	ctx := context.Background()
	baseline := configurationGet(t, mux, admin, server)
	check := func(canUpdate bool, reason string) {
		t.Helper()
		view := configurationGet(t, mux, admin, server)
		if boolean(view["can_update"]) != canUpdate {
			t.Fatalf("can_update=%v expected=%v", view["can_update"], canUpdate)
		}
		if canUpdate {
			if _, exists := view["update_unavailable_reason"]; exists {
				t.Fatal("available configuration has an unavailable reason")
			}
		} else if hint := str(view["update_unavailable_reason"]); hint == "" || !strings.Contains(hint, reason) || strings.Contains(hint, "private-daemon-error-detail") {
			t.Fatalf("unsafe or missing readiness hint: %q", hint)
		}
		for _, key := range []string{"revision", "template", "defaults", "effective", "overrides"} {
			if !reflect.DeepEqual(view[key], baseline[key]) {
				t.Fatalf("readiness failure changed readable %s", key)
			}
		}
	}
	check(true, "")
	for _, state := range []string{"running", "starting", "stopping"} {
		f.mu.Lock()
		f.state = state
		f.mu.Unlock()
		check(false, "Stop the server")
	}
	f.mu.Lock()
	f.state = "offline"
	f.stateUnavailable = true
	f.mu.Unlock()
	check(false, "node connection")
	f.mu.Lock()
	f.stateUnavailable = false
	f.badState = true
	f.mu.Unlock()
	check(false, "node connection")
	f.mu.Lock()
	f.badState = false
	f.mu.Unlock()
	client := a.HTTP
	a.HTTP = &http.Client{Transport: configurationUnavailableTransport{}}
	check(false, "node connection")
	a.HTTP = client
	for _, status := range []string{"queued", "running"} {
		if err := a.exec(ctx, "INSERT INTO steam_jobs(id,server_id,operation,status,lease_until) VALUES($1,$2,'verify',$3,now()+interval '1 minute')", newUUID(), server["id"], status); err != nil {
			t.Fatal(err)
		}
		check(false, "Steam maintenance")
		if err := a.exec(ctx, "DELETE FROM steam_jobs WHERE server_id=$1", server["id"]); err != nil {
			t.Fatal(err)
		}
	}
	if err := a.exec(ctx, "INSERT INTO steam_game_provisions(actor_id,request_id,game,input_hash,server_id,stage) VALUES($1,$2,'fixture','hash',$3,'created')", admin, newUUID(), server["id"]); err != nil {
		t.Fatal(err)
	}
	check(false, "game installation")
	if err := a.exec(ctx, "DELETE FROM steam_game_provisions WHERE server_id=$1", server["id"]); err != nil {
		t.Fatal(err)
	}
	for _, status := range []string{"installing", "suspended", "restoring_backup"} {
		if err := a.exec(ctx, "UPDATE servers SET status=$2 WHERE id=$1", server["id"], status); err != nil {
			t.Fatal(err)
		}
		check(false, "installation")
	}
	if err := a.exec(ctx, "UPDATE servers SET status=NULL WHERE id=$1", server["id"]); err != nil {
		t.Fatal(err)
	}
	if err := a.exec(ctx, "UPDATE nodes SET maintenance_mode=true WHERE id=$1", server["node_id"]); err != nil {
		t.Fatal(err)
	}
	check(false, "maintenance")
	if err := a.exec(ctx, "UPDATE nodes SET maintenance_mode=false WHERE id=$1", server["node_id"]); err != nil {
		t.Fatal(err)
	}
	check(true, "")
}

func TestServerConfigurationIsolationInheritanceAndNextInstall(t *testing.T) {
	a, mux, admin, first, second, f := configurationFixture(t)
	ctx := context.Background()
	view := configurationGet(t, mux, admin, first)
	if boolean(view["managed"]) || !boolean(view["can_update"]) || str(asMap(view["applies"])["process"]) != "next_start" || str(asMap(view["applies"])["installation"]) != "next_install" {
		t.Fatal("configuration contract flags are wrong")
	}
	script := "#!/bin/sh\n  printf '%s' exact  \n"
	overrides := M{"config_startup": M{"done": []any{"custom-ready"}, "strip_ansi": true}, "config_stop": "^C", "script_install": script, "script_container": "alpine:3.22", "script_entry": "sh", "config_files": M{"server.properties": M{"parser": "properties", "find": M{"motd": "private-fixture-value"}}}}
	saved := asMap(infraExpect(t, mux, admin, "PUT", configurationEndpoint(first), M{"revision": view["revision"], "overrides": overrides}, 200)["attributes"])
	if !reflect.DeepEqual(asMap(saved["overrides"]), overrides) || str(asMap(saved["effective"])["script_install"]) != script {
		t.Fatal("save changed override/script bytes")
	}
	other := configurationGet(t, mux, admin, second)
	if len(asMap(other["overrides"])) != 0 || str(asMap(other["effective"])["config_stop"]) != "stop" {
		t.Fatal("save changed another server")
	}
	egg, err := a.effectiveEgg(ctx, num(first["egg_id"]))
	if err != nil {
		t.Fatal(err)
	}
	if str(egg["config_stop"]) != "stop" || strings.Contains(str(egg["script_install"]), "exact") {
		t.Fatal("save changed the egg")
	}
	f.mu.Lock()
	if len(f.snapshots) != 1 || len(f.callbackErrors) != 0 {
		t.Fatalf("sync callback snapshots=%d errors=%v", len(f.snapshots), f.callbackErrors)
	}
	process := asMap(f.snapshots[0]["process"])
	if str(asMap(process["stop"])["value"]) != "SIGINT" || !reflect.DeepEqual(asMap(process["startup"])["done"], []any{"custom-ready"}) {
		t.Fatal("effective overrides did not generate the Wings process contract")
	}
	for _, call := range f.calls {
		if strings.Contains(call, "/install") || strings.Contains(call, "/power") || strings.Contains(call, "/files/") {
			t.Fatal("saving performed installation/power/file mutation")
		}
	}
	f.mu.Unlock()
	logs, err := a.query(ctx, "SELECT properties FROM activity_logs WHERE server_id=$1", first["id"])
	if err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(logs)
	if len(logs) != 1 || strings.Contains(string(encoded), "private-fixture-value") || strings.Contains(string(encoded), "printf") {
		t.Fatal("audit omitted update or exposed values")
	}
	reset := asMap(infraExpect(t, mux, admin, "PUT", configurationEndpoint(first), M{"revision": saved["revision"], "overrides": M{}}, 200)["attributes"])
	if len(asMap(reset["overrides"])) != 0 || !reflect.DeepEqual(reset["effective"], reset["defaults"]) {
		t.Fatal("reset did not inherit defaults")
	}
	// Both process and installation inheritance must precede local overrides.
	parent, err := a.insert(ctx, "eggs", M{"uuid": newUUID(), "nest_id": egg["nest_id"], "name": "Parent", "author": "fixture@example.invalid", "config_stop": "parent-stop", "script_install": "parent-script", "script_entry": "bash", "script_container": "alpine:3.23"})
	if err != nil {
		t.Fatal(err)
	}
	if err = a.exec(ctx, "UPDATE eggs SET config_from=$2,config_stop=NULL,copy_script_from=$2,script_install=NULL WHERE id=$1", egg["id"], parent["id"]); err != nil {
		t.Fatal(err)
	}
	inherited := configurationGet(t, mux, admin, first)
	if str(asMap(inherited["defaults"])["config_stop"]) != "parent-stop" || str(asMap(inherited["defaults"])["script_install"]) != "parent-script" {
		t.Fatal("inherited defaults were lost")
	}
	infraExpect(t, mux, admin, "PUT", configurationEndpoint(first), M{"revision": reset["revision"], "overrides": M{}}, 409)
}

func TestServerConfigurationActualAdminAndClientAuthorization(t *testing.T) {
	a, mux, admin, server, _, _ := configurationFixture(t)
	ctx := context.Background()
	view := configurationGet(t, mux, admin, server)
	for _, role := range []string{"owner", "subuser", "disabled-admin"} {
		u, err := a.insert(ctx, "users", M{"uuid": newUUID(), "username": role, "email": role + "@example.invalid", "root_admin": role == "disabled-admin", "disabled": role == "disabled-admin"})
		if err != nil {
			t.Fatal(err)
		}
		if role == "owner" {
			if err = a.exec(ctx, "UPDATE servers SET owner_id=$2 WHERE id=$1", server["id"], u["id"]); err != nil {
				t.Fatal(err)
			}
		}
		if role == "subuser" {
			if _, err = a.insert(ctx, "subusers", M{"server_id": server["id"], "user_id": u["id"], "permissions": []string{"startup.read", "startup.update", "settings.reinstall"}}); err != nil {
				t.Fatal(err)
			}
		}
		infraExpect(t, mux, num(u["id"]), "GET", configurationEndpoint(server), nil, 403)
		infraExpect(t, mux, num(u["id"]), "PUT", configurationEndpoint(server), M{"revision": view["revision"], "overrides": M{}}, 403)
	}
	infraExpect(t, mux, 0, "GET", configurationEndpoint(server), nil, 401)
	for _, kind := range []string{"client", "application"} {
		r := WithUser(httptest.NewRequest("GET", configurationEndpoint(server), nil), admin)
		r = r.WithContext(context.WithValue(r.Context(), apiKeyContextKey{}, M{"type": kind, "permissions": M{"servers": int64(3)}}))
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, r)
		want := 200
		if kind == "application" {
			want = 403
		}
		if w.Code != want {
			t.Fatalf("%s key status=%d expected=%d", kind, w.Code, want)
		}
	}
}

func TestServerConfigurationStoppedLeaseAndValidation(t *testing.T) {
	a, mux, admin, server, _, f := configurationFixture(t)
	ctx := context.Background()
	for _, state := range []string{"running", "starting", "stopping", "unknown", ""} {
		view := configurationGet(t, mux, admin, server)
		f.mu.Lock()
		f.state = state
		f.mu.Unlock()
		infraExpect(t, mux, admin, "PUT", configurationEndpoint(server), M{"revision": view["revision"], "overrides": M{"config_stop": "safe"}}, 409)
	}
	f.mu.Lock()
	f.state = "offline"
	f.badState = true
	f.mu.Unlock()
	view := configurationGet(t, mux, admin, server)
	input := M{"revision": view["revision"], "overrides": M{"config_stop": "safe"}}
	infraExpect(t, mux, admin, "PUT", configurationEndpoint(server), input, 502)
	f.mu.Lock()
	f.badState = false
	f.mu.Unlock()
	for _, invalid := range []M{{"revision": view["revision"]}, {"revision": view["revision"], "overrides": nil}, {"revision": "bad", "overrides": M{}}, {"revision": view["revision"], "overrides": M{"image": "injected"}}, {"revision": view["revision"], "overrides": M{}, "egg_id": 2}} {
		infraExpect(t, mux, admin, "PUT", configurationEndpoint(server), invalid, 422)
	}
	for _, status := range []string{"queued", "running"} {
		if err := a.exec(ctx, "INSERT INTO steam_jobs(id,server_id,operation,status,lease_until) VALUES($1,$2,'verify',$3,now()+interval '1 minute')", newUUID(), server["id"], status); err != nil {
			t.Fatal(err)
		}
		infraExpect(t, mux, admin, "PUT", configurationEndpoint(server), input, 409)
		if err := a.exec(ctx, "DELETE FROM steam_jobs WHERE server_id=$1", server["id"]); err != nil {
			t.Fatal(err)
		}
	}
	if err := a.exec(ctx, "INSERT INTO steam_game_provisions(actor_id,request_id,game,input_hash,server_id,stage) VALUES($1,$2,'fixture','hash',$3,'created')", admin, newUUID(), server["id"]); err != nil {
		t.Fatal(err)
	}
	infraExpect(t, mux, admin, "PUT", configurationEndpoint(server), input, 409)
	if err := a.exec(ctx, "DELETE FROM steam_game_provisions WHERE server_id=$1", server["id"]); err != nil {
		t.Fatal(err)
	}
	for _, status := range []string{"installing", "suspended", "restoring_backup"} {
		if err := a.exec(ctx, "UPDATE servers SET status=$2 WHERE id=$1", server["id"], status); err != nil {
			t.Fatal(err)
		}
		infraExpect(t, mux, admin, "PUT", configurationEndpoint(server), input, 409)
	}
	if err := a.exec(ctx, "UPDATE servers SET status=NULL WHERE id=$1", server["id"]); err != nil {
		t.Fatal(err)
	}
	view = configurationGet(t, mux, admin, server)
	if len(asMap(view["overrides"])) != 0 {
		t.Fatal("rejected changes persisted")
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(f.snapshots) != 0 {
		t.Fatal("rejected update reached daemon sync")
	}
}

func TestServerConfigurationManagedInstallersAndJavaFiles(t *testing.T) {
	a, mux, admin, server, _, _ := configurationFixture(t)
	ctx := context.Background()
	for _, managed := range []string{"java", "steam"} {
		if managed == "java" {
			if err := a.exec(ctx, "UPDATE eggs SET java_config=$2 WHERE id=$1", server["egg_id"], M{"enabled": true, "args_file": "custom-args.txt"}); err != nil {
				t.Fatal(err)
			}
		} else {
			if err := a.exec(ctx, "UPDATE eggs SET java_config='{}' WHERE id=$1", server["egg_id"]); err != nil {
				t.Fatal(err)
			}
			if err := a.configureSteamServer(ctx, num(server["id"]), "satisfactory", 1690800, "public"); err != nil {
				t.Fatal(err)
			}
		}
		view := configurationGet(t, mux, admin, server)
		if !boolean(view["managed"]) {
			t.Fatal("managed installer was not identified")
		}
		for key, value := range (M{"script_install": "", "script_entry": "sh", "script_container": "alpine:3.21"}) {
			_, body, _ := infraRequest(t, mux, admin, "PUT", configurationEndpoint(server), M{"revision": view["revision"], "overrides": M{key: value}})
			if str(asMap(asSlice(body["errors"])[0])["code"]) != "ManagedInstallerConfiguration" {
				t.Fatalf("managed %s installer override did not fail explicitly", managed)
			}
		}
		for _, file := range []string{"run.sh", "server.jar", "user_jvm_args.txt"} {
			infraExpect(t, mux, admin, "PUT", configurationEndpoint(server), M{"revision": view["revision"], "overrides": M{"config_files": M{file: M{"parser": "file", "find": M{"old": "new"}}}}}, 422)
		}
		if managed == "java" {
			infraExpect(t, mux, admin, "PUT", configurationEndpoint(server), M{"revision": view["revision"], "overrides": M{"config_files": M{"custom-args.txt": M{"parser": "file", "find": M{"old": "new"}}}}}, 422)
		}
		infraExpect(t, mux, admin, "PUT", configurationEndpoint(server), M{"revision": view["revision"], "overrides": M{"config_startup": M{"done": "safe-ready"}, "config_stop": "^C"}}, 200)
	}
	// Runtime consumers fail closed on persisted installer overrides as well.
	server["configuration_overrides"] = M{"script_install": "injected"}
	if _, err := a.serverEffectiveEgg(ctx, server); err == nil {
		t.Fatal("runtime helper accepted a managed installer override")
	}
}

func TestServerConfigurationSyncFailureCompensates(t *testing.T) {
	a, mux, admin, server, _, f := configurationFixture(t)
	view := configurationGet(t, mux, admin, server)
	f.mu.Lock()
	f.reject = 1
	f.mu.Unlock()
	infraExpect(t, mux, admin, "PUT", configurationEndpoint(server), M{"revision": view["revision"], "overrides": M{"config_stop": "private-failed-stop"}}, 502)
	restored := configurationGet(t, mux, admin, server)
	if len(asMap(restored["overrides"])) != 0 || str(asMap(restored["effective"])["config_stop"]) != "stop" {
		t.Fatal("database was not compensated")
	}
	f.mu.Lock()
	if len(f.snapshots) != 2 || str(asMap(f.snapshots[0]["effective"])["config_stop"]) != "private-failed-stop" || str(asMap(f.snapshots[1]["effective"])["config_stop"]) != "stop" {
		t.Fatal("daemon callback did not observe committed update then rollback")
	}
	f.mu.Unlock()
	logs, err := a.query(context.Background(), "SELECT event,properties FROM activity_logs WHERE server_id=$1", server["id"])
	if err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(logs)
	if len(logs) != 1 || str(logs[0]["event"]) != "server:configuration.sync-failed" || !boolean(asMap(logs[0]["properties"])["restored"]) || strings.Contains(string(encoded), "private-failed-stop") {
		t.Fatal("failure audit is unsafe or inaccurate")
	}
}

func TestServerConfigurationConcurrentRevisionAndSharedLocks(t *testing.T) {
	a, mux, admin, server, _, f := configurationFixture(t)
	ctx := context.Background()
	for _, kind := range []string{"mutation", "java"} {
		view := configurationGet(t, mux, admin, server)
		lock, err := a.DB.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		if kind == "mutation" {
			_, err = lock.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "voltra:server-mutation:"+str(server["uuid"]))
		} else {
			_, err = lock.Exec(ctx, "SELECT pg_advisory_xact_lock($1)", server["id"])
		}
		if err != nil {
			t.Fatal(err)
		}
		done := make(chan int, 1)
		go func() {
			code, _, _ := infraRequest(t, mux, admin, "PUT", configurationEndpoint(server), M{"revision": view["revision"], "overrides": M{"config_stop": kind}})
			done <- code
		}()
		select {
		case <-done:
			t.Fatal("save bypassed " + kind + " lock")
		case <-time.After(100 * time.Millisecond):
		}
		if err = lock.Rollback(ctx); err != nil {
			t.Fatal(err)
		}
		select {
		case code := <-done:
			if code != 200 {
				t.Fatalf("save after %s unlock: %d", kind, code)
			}
		case <-time.After(5 * time.Second):
			t.Fatal("save did not resume")
		}
	}
	view := configurationGet(t, mux, admin, server)
	codes := make(chan int, 2)
	for _, value := range []string{"one", "two"} {
		go func(value string) {
			code, _, _ := infraRequest(t, mux, admin, "PUT", configurationEndpoint(server), M{"revision": view["revision"], "overrides": M{"config_stop": value}})
			codes <- code
		}(value)
	}
	first, second := <-codes, <-codes
	if first+second != 609 || first != 200 && second != 200 {
		t.Fatalf("concurrent statuses: %d %d", first, second)
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(f.snapshots) != 3 {
		t.Fatal("stale concurrent writer synced its values")
	}
}

func TestServerConfigurationRemoteRuntimeAndInstallerConsumers(t *testing.T) {
	a, mux, admin, server, _, _ := configurationFixture(t)
	ctx := context.Background()
	allocation, err := a.insert(ctx, "allocations", M{"node_id": server["node_id"], "server_id": server["id"], "ip": "127.0.0.1", "port": 25565})
	if err != nil {
		t.Fatal(err)
	}
	if err = a.exec(ctx, "UPDATE servers SET allocation_id=$2 WHERE id=$1", server["id"], allocation["id"]); err != nil {
		t.Fatal(err)
	}
	a.registerLifecycle(mux)
	view := configurationGet(t, mux, admin, server)
	script := "#!/bin/sh\n  echo installation-only  \n"
	infraExpect(t, mux, admin, "PUT", configurationEndpoint(server), M{"revision": view["revision"], "overrides": M{"config_stop": "^C", "config_startup": M{"done": "custom-ready"}, "script_install": script, "script_entry": "sh", "script_container": "alpine:3.22", "config_files": M{"server.properties": M{"parser": "properties", "find": M{"port": "{{server.build.default.port}}"}}}}}, 200)
	readRemote := func(suffix string) M {
		t.Helper()
		r := httptest.NewRequest("GET", "/api/remote/servers/"+str(server["uuid"])+suffix, nil)
		r.Header.Set("Authorization", "Bearer identifier.configuration-fixture-token")
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, r)
		if w.Code != 200 {
			t.Fatalf("remote %s status=%d body=%s", suffix, w.Code, w.Body.String())
		}
		var body M
		if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		return body
	}
	runtime := readRemote("")
	process := asMap(runtime["process_configuration"])
	if str(asMap(process["stop"])["value"]) != "SIGINT" || !reflect.DeepEqual(asMap(process["startup"])["done"], []any{"custom-ready"}) {
		t.Fatal("remote runtime ignored server process overrides")
	}
	configs := asSlice(process["configs"])
	if len(configs) != 1 || str(asMap(asSlice(asMap(configs[0])["replace"])[0])["replace_with"]) != "25565" {
		t.Fatal("remote process file override did not resolve the server allocation")
	}
	installer := readRemote("/install")
	if str(installer["script"]) != script || str(installer["entrypoint"]) != "sh" || str(installer["container_image"]) != "alpine:3.22" {
		t.Fatal("remote installer ignored server overrides")
	}
}

func TestServerConfigurationRollbackAndResyncFailuresAreExplicit(t *testing.T) {
	for _, failure := range []string{"resync", "database-restore"} {
		t.Run(failure, func(t *testing.T) {
			a, mux, admin, server, _, f := configurationFixture(t)
			if failure == "database-restore" {
				// This trigger exists only inside infraTestApp's disposable schema.
				if err := a.exec(context.Background(), `CREATE FUNCTION reject_configuration_restore() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.configuration_overrides='{}'::jsonb AND OLD.configuration_overrides<>'{}'::jsonb THEN RAISE EXCEPTION 'fixture restore failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_configuration_restore BEFORE UPDATE ON servers FOR EACH ROW EXECUTE FUNCTION reject_configuration_restore()`); err != nil {
					t.Fatal(err)
				}
			}
			view := configurationGet(t, mux, admin, server)
			f.mu.Lock()
			f.reject = 2
			f.mu.Unlock()
			code, body, _ := infraRequest(t, mux, admin, "PUT", configurationEndpoint(server), M{"revision": view["revision"], "overrides": M{"config_stop": "private-failure-value"}})
			want := "ServerConfigurationResyncFailed"
			if failure == "database-restore" {
				want = "ServerConfigurationRollbackFailed"
			}
			if code != 502 || str(asMap(asSlice(body["errors"])[0])["code"]) != want {
				t.Fatalf("rollback outcome status=%d body=%v", code, body)
			}
			logs, err := a.query(context.Background(), "SELECT properties FROM activity_logs WHERE server_id=$1", server["id"])
			if err != nil {
				t.Fatal(err)
			}
			if len(logs) != 1 || boolean(asMap(logs[0]["properties"])["restored"]) != (failure == "resync") || boolean(asMap(logs[0]["properties"])["daemon_restored"]) {
				t.Fatal("rollback outcome audit was inaccurate")
			}
			encoded, _ := json.Marshal(logs)
			if strings.Contains(string(encoded), "private-failure-value") {
				t.Fatal("rollback audit leaked a configuration value")
			}
		})
	}
}
