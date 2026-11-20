package panel

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"reflect"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func TestConsoleInstallProgressFixtures(t *testing.T) {
	data, err := os.ReadFile("testdata/console-install-progress.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixtures []struct {
		Name, Phase, Runtime string
		Events               []consoleLogEntry
		Stages               []installProgressStage
	}
	if err := json.Unmarshal(data, &fixtures); err != nil {
		t.Fatal(err)
	}
	for _, fixture := range fixtures {
		t.Run(fixture.Name, func(t *testing.T) {
			var model installProgressModel
			for _, entry := range fixture.Events {
				model.readHistory(entry.Event, entry.Line)
			}
			if got := model.view(fixture.Phase, fixture.Runtime); !reflect.DeepEqual(got, fixture.Stages) {
				gotJSON, _ := json.Marshal(got)
				wantJSON, _ := json.Marshal(fixture.Stages)
				t.Fatalf("got %s, want %s", gotJSON, wantJSON)
			}
		})
	}
}

func TestConsoleInstallRetryCollectorAndFeedPermissions(t *testing.T) {
	f := operationsFixtureNew(t)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	id := num(f.server["id"])
	if err := f.a.appendConsoleLogs(ctx, id, "", []consoleLogEntry{
		{"console output", "Previous game output"},
		{"install output", "Installing Forge"},
		{"install output", "Installation failed: previous-attempt-secret"},
	}); err != nil {
		t.Fatal(err)
	}
	previous := operationsExpect(t, f.request("GET", f.serverPath("/console-history"), nil, f.admin), 200)
	if _, err := f.a.update(ctx, "servers", id, M{"status": "installing"}); err != nil {
		t.Fatal(err)
	}
	messages := []M{
		{"event": "auth success", "args": []string{}},
		{"event": "install started", "args": []string{"event-arg-secret"}},
		{"event": "install output", "args": []string{"### 37%"}},
		{"event": "install output", "args": []string{"installer-private-credential"}},
	}
	result := make(chan error, 1)
	wings := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		upgrader := websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			result <- err
			return
		}
		defer conn.Close()
		_ = conn.SetReadDeadline(time.Now().Add(3 * time.Second))
		var auth M
		if err := conn.ReadJSON(&auth); err != nil {
			result <- err
			return
		}
		for _, message := range messages {
			if err := conn.WriteJSON(message); err != nil {
				result <- err
				return
			}
		}
		result <- nil
	}))
	defer wings.Close()
	u, _ := url.Parse(wings.URL)
	port, _ := strconv.Atoi(u.Port())
	if _, err := f.a.update(ctx, "nodes", num(f.node["id"]), M{"fqdn": u.Hostname(), "daemon_listen": port}); err != nil {
		t.Fatal(err)
	}
	if claimed, err := f.a.consoleLogLease(ctx, id, "test-retry"); err != nil || !claimed {
		t.Fatalf("claim capture lease: %t %v", claimed, err)
	}
	_ = f.a.consoleLogSession(ctx, f.server, "test-retry")
	select {
	case err := <-result:
		if err != nil {
			t.Fatal(err)
		}
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}

	path := f.serverPath("/install-progress")
	for _, user := range []M{f.owner, f.sub, f.admin} {
		response := f.request("GET", path, nil, user)
		body := response.Body.String()
		stages := asSlice(operationsExpect(t, response, 200)["stages"])
		if len(stages) != 2 {
			t.Fatalf("unexpected retry stages: %s", body)
		}
		stage := asMap(stages[0])
		if stage["id"] != "download" || stage["state"] != "running" || num(asMap(stage["progress"])["value"]) != 37 {
			t.Fatalf("retry did not replace failed attempt: %s", body)
		}
		if strings.Contains(body, "secret") || strings.Contains(body, "credential") || strings.Contains(body, "###") || strings.Contains(body, "\"line\"") {
			t.Fatalf("stage response exposed raw output: %s", body)
		}
	}

	for _, suffix := range []string{"/console-history", "/console-history?after=" + str(previous["cursor"])} {
		for _, user := range []M{f.admin, f.owner} {
			body := f.request("GET", f.serverPath(suffix), nil, user)
			operationsExpect(t, body, 200)
			text := body.Body.String()
			isAdmin := num(user["id"]) == num(f.admin["id"])
			if strings.Contains(text, "previous-attempt-secret") || strings.Contains(text, "event-arg-secret") ||
				!strings.Contains(text, consoleInstallBoundary) || strings.Contains(text, "installer-private-credential") != isAdmin {
				t.Fatalf("unexpected install history for admin=%t: %s", isAdmin, text)
			}
		}
	}

	if _, err := f.a.DB.Exec(ctx, "UPDATE subusers SET permissions='[]' WHERE user_id=$1", f.sub["id"]); err != nil {
		t.Fatal(err)
	}
	operationsExpect(t, f.request("GET", path, nil, f.sub), 403)
	outsider, err := f.a.insert(ctx, "users", M{"uuid": newUUID(), "username": "install-outsider", "email": "install-outsider@example.com"})
	if err != nil {
		t.Fatal(err)
	}
	operationsExpect(t, f.request("GET", path, nil, outsider), 404)
	if _, err := f.a.update(ctx, "servers", id, M{"status": "reinstall_failed"}); err != nil {
		t.Fatal(err)
	}
	failed := asSlice(operationsExpect(t, f.request("GET", path, nil, f.owner), 200)["stages"])
	if len(failed) != 1 || asMap(failed[0])["state"] != "failed" {
		t.Fatalf("replay omitted the Wings failure state: %#v", failed)
	}
}

// A warm installer can publish its entire output as soon as the script response
// arrives. Exercise that path while the discovery worker is between retries.
func TestConsoleInstallCaptureBeforeScriptResponse(t *testing.T) {
	f := operationsFixtureNew(t)
	f.a.registerLifecycle(f.mux)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	id := num(f.server["id"])
	tx, err := f.a.DB.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	cycle := "pending:initial:" + newUUID()
	if _, err := tx.Exec(ctx, "UPDATE servers SET status='installing',installed_at=NULL,installation_id=$2 WHERE id=$1", id, cycle); err != nil {
		t.Fatal(err)
	}
	if err := f.a.persistConsoleInstallStart(ctx, tx, id, cycle); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}

	var registered atomic.Bool
	var first sync.Once
	initialDial := make(chan struct{})
	statusAllowed := make(chan struct{})
	scriptReturned := make(chan struct{})
	outputSent := make(chan error, 1)
	wings := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !registered.Load() {
			w.WriteHeader(404)
			first.Do(func() { close(initialDial) })
			return
		}
		upgrader := websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			outputSent <- err
			return
		}
		defer conn.Close()
		_ = conn.SetReadDeadline(time.Now().Add(5 * time.Second))
		var auth M
		if err = conn.ReadJSON(&auth); err == nil {
			err = conn.WriteJSON(M{"event": "auth success"})
		}
		if err != nil {
			outputSent <- err
			return
		}
		select {
		case <-statusAllowed:
		case <-ctx.Done():
			return
		}
		if err = conn.WriteJSON(M{"event": "status", "args": []string{"offline"}}); err != nil {
			outputSent <- err
			return
		}
		select {
		case <-scriptReturned:
		case <-ctx.Done():
			return
		}
		// The install started event occurred before the node requested its script.
		outputSent <- conn.WriteJSON(M{"event": "install output", "args": []string{"Downloading warm archive"}})
		<-ctx.Done()
	}))
	defer wings.Close()
	defer cancel()
	u, _ := url.Parse(wings.URL)
	port, _ := strconv.Atoi(u.Port())
	if _, err := f.a.update(ctx, "nodes", num(f.node["id"]), M{"fqdn": u.Hostname(), "daemon_listen": port}); err != nil {
		t.Fatal(err)
	}
	collectorDone := make(chan struct{})
	go func() {
		defer close(collectorDone)
		f.a.RunConsoleLogs(ctx)
	}()
	defer func() { cancel(); <-collectorDone }()
	select {
	case <-initialDial:
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	registered.Store(true)
	scriptPath := "/api/remote/servers/" + str(f.server["uuid"]) + "/install"
	requestScript := make(chan *httptest.ResponseRecorder, 1)
	go func() {
		r := httptest.NewRequest("GET", scriptPath, nil).WithContext(ctx)
		r.Header.Set("Authorization", "Bearer operations-token.operations-daemon-secret")
		w := httptest.NewRecorder()
		f.mux.ServeHTTP(w, r)
		requestScript <- w
	}()
	select {
	case got := <-requestScript:
		t.Fatalf("script returned before collector was ready: %d", got.Code)
	case <-time.After(100 * time.Millisecond):
		close(statusAllowed)
	}
	select {
	case got := <-requestScript:
		operationsExpect(t, got, 200)
		close(scriptReturned)
	case <-time.After(2 * time.Second):
		t.Fatal("installer script did not return after the collector connected")
	}
	select {
	case err := <-outputSent:
		if err != nil {
			t.Fatal(err)
		}
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	for {
		got := operationsExpect(t, f.request("GET", f.serverPath("/install-progress"), nil, f.owner), 200)
		if stages := asSlice(got["stages"]); len(stages) == 2 && asMap(stages[0])["id"] == "download" {
			break
		}
		select {
		case <-ctx.Done():
			t.Fatalf("early install output was not captured: %v", got)
		case <-time.After(25 * time.Millisecond):
		}
	}
}

func TestConsoleInstallPersistedRetryWithoutWingsBoundary(t *testing.T) {
	f := operationsFixtureNew(t)
	f.a.registerLifecycle(f.mux)
	ctx := context.Background()
	id := num(f.server["id"])
	if _, err := f.a.update(ctx, "servers", id, M{"status": "reinstall_failed", "installation_id": "complete:reinstall:" + newUUID()}); err != nil {
		t.Fatal(err)
	}
	if err := f.a.appendConsoleLogs(ctx, id, "", []consoleLogEntry{
		{"panel message", consoleInstallBoundary},
		{"install output", "Installing Forge"},
		{"install output", "Installation failed: previous-attempt-secret"},
	}); err != nil {
		t.Fatal(err)
	}
	history := f.serverPath("/console-history")
	old := operationsExpect(t, f.request("GET", history, nil, f.admin), 200)
	operationsExpect(t, f.request("POST", f.serverPath("/settings/reinstall"), M{}, f.owner), 202)

	if err := f.a.appendConsoleLogs(ctx, id, "", []consoleLogEntry{
		{"install output", "Writing server.properties"},
		{"install output", "Installation complete."},
	}); err != nil {
		t.Fatal(err)
	}
	progress := f.serverPath("/install-progress")
	assertStages := func(state, next string) {
		t.Helper()
		stages := asSlice(operationsExpect(t, f.request("GET", progress, nil, f.owner), 200)["stages"])
		if len(stages) != 2 || asMap(stages[0])["id"] != "configure" ||
			asMap(stages[0])["state"] != state || asMap(stages[1])["label"] != next {
			t.Fatalf("unexpected lifecycle stages: %v", stages)
		}
	}
	assertStages("running", "Starting server")

	r := httptest.NewRequest("POST", "/api/remote/servers/"+str(f.server["uuid"])+"/install", strings.NewReader(`{"successful":true,"reinstall":true}`))
	r.Header.Set("Authorization", "Bearer operations-token.operations-daemon-secret")
	w := httptest.NewRecorder()
	f.mux.ServeHTTP(w, r)
	operationsExpect(t, w, 204)
	assertStages("done", "Ready to start")
	for _, path := range []string{history, history + "?after=" + str(old["cursor"])} {
		result := f.request("GET", path, nil, f.admin)
		operationsExpect(t, result, 200)
		body := result.Body.String()
		if !strings.Contains(body, "Writing server.properties") || !strings.Contains(body, consoleInstallBoundary) ||
			strings.Contains(body, "previous-attempt-secret") || strings.Contains(body, consoleInstallMarkerPrefix+"reinstall:") {
			t.Fatalf("unexpected archived attempt: %s", body)
		}
	}
}

// An admin reinstall and a console collector flush must not deadlock. The
// collector holds the console-history lock while its insert needs a key-share
// lock on the server row; the reinstall must take the history lock first.
func TestConsoleCollectorFlushDoesNotDeadlockAdminReinstall(t *testing.T) {
	f := operationsFixtureNew(t)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	id := num(f.server["id"])
	collector, err := f.a.DB.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer collector.Rollback(ctx)
	if _, err = collector.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtextextended('voltra:console-history:'||$1::bigint::text,0))", id); err != nil {
		t.Fatal(err)
	}
	reinstalled := make(chan error, 1)
	go func() {
		tx, err := f.a.DB.Begin(ctx)
		if err != nil {
			reinstalled <- err
			return
		}
		defer tx.Rollback(ctx)
		rows, err := lockServerForReinstall(ctx, tx, id)
		if err != nil {
			reinstalled <- err
			return
		}
		rows.Close()
		if err = f.a.persistConsoleInstallStart(ctx, tx, id, "pending:reinstall:"+newUUID()); err != nil {
			reinstalled <- err
			return
		}
		reinstalled <- tx.Commit(ctx)
	}()
	// Let the reinstall queue behind the collector, then flush its output.
	time.Sleep(300 * time.Millisecond)
	if _, err = collector.Exec(ctx, "INSERT INTO console_log_entries(server_id,event,line) VALUES($1,'console output','flushed while reinstalling')", id); err != nil {
		t.Fatalf("collector flush failed: %v", err)
	}
	if err = collector.Commit(ctx); err != nil {
		t.Fatalf("collector commit failed: %v", err)
	}
	if err = <-reinstalled; err != nil {
		t.Fatalf("reinstall failed: %v", err)
	}
}
