package panel

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

func TestConsoleLogLineBounds(t *testing.T) {
	entries := consoleLogLines("console output", "first\r\n"+strings.Repeat("界", 10000)+"\x00\n")
	if len(entries) != 2 || entries[0].Line != "first" || !utf8.ValidString(entries[1].Line) || len(entries[1].Line) > 17000 || !strings.Contains(entries[1].Line, "truncated") || strings.ContainsRune(entries[1].Line, 0) {
		t.Fatal("invalid bounded lines", len(entries))
	}
	if consoleLogLines("stats", "not a log") != nil {
		t.Fatal("captured non-log event")
	}
}

func TestConsoleLogsRetentionPermissionsAndReload(t *testing.T) {
	f := operationsFixtureNew(t)
	a, ctx, id := f.a, context.Background(), num(f.server["id"])
	a.Config.ConsoleHistoryLines = 5
	for i := 0; i < 10; i++ {
		if err := a.appendConsoleLogs(ctx, id, "", consoleLogLines("console output", fmt.Sprintf("line %d", i))); err != nil {
			t.Fatal(err)
		}
	}
	first := operationsExpect(t, f.request("GET", f.serverPath("/console-history"), nil, f.owner), 200)
	rows := asSlice(first["data"])
	if len(rows) != 5 || str(asMap(rows[0])["line"]) != "line 5" || str(asMap(rows[4])["line"]) != "line 9" {
		t.Fatal("tail not retained", first)
	}
	// A new App and handler have no browser buffer or collector memory.
	f.daemon.Close() // Cached history must not require a reachable daemon.
	f.a = &App{DB: a.DB, Config: a.Config, HTTP: a.HTTP}
	f.mux = http.NewServeMux()
	f.a.registerOperations(f.mux)
	second := operationsExpect(t, f.request("GET", f.serverPath("/console-history"), nil, f.owner), 200)
	if str(second["cursor"]) != str(first["cursor"]) || len(asSlice(second["data"])) != 5 {
		t.Fatal("history did not survive App replacement")
	}
	empty := operationsExpect(t, f.request("GET", f.serverPath("/console-history?after="+str(first["cursor"])), nil, f.owner), 200)
	if len(asSlice(empty["data"])) != 0 {
		t.Fatal("replayed duplicate lines", empty)
	}
	if err := a.appendConsoleLogs(ctx, id, "", consoleLogLines("install output", "private installer line")); err != nil {
		t.Fatal(err)
	}
	sub := operationsExpect(t, f.request("GET", f.serverPath("/console-history"), nil, f.sub), 200)
	for _, r := range asSlice(sub["data"]) {
		if str(asMap(r)["event"]) == "install output" {
			t.Fatal("installer logs leaked")
		}
	}
	admin := operationsExpect(t, f.request("GET", f.serverPath("/console-history"), nil, f.admin), 200)
	if len(asSlice(admin["data"])) != 5 {
		t.Fatal("admin install logs missing")
	}
	if err := a.exec(ctx, "UPDATE subusers SET permissions='[]'::jsonb WHERE user_id=$1", f.sub["id"]); err != nil {
		t.Fatal(err)
	}
	operationsExpect(t, f.request("GET", f.serverPath("/console-history"), nil, f.sub), 403)
	outsider, err := a.insert(ctx, "users", M{"uuid": newUUID(), "username": "outside", "email": "outside@example.test"})
	if err != nil {
		t.Fatal(err)
	}
	operationsExpect(t, f.request("GET", f.serverPath("/console-history"), nil, outsider), 404)
	if err = a.exec(ctx, "UPDATE servers SET status='install_failed' WHERE id=$1", id); err != nil {
		t.Fatal(err)
	}
	operationsExpect(t, f.request("GET", f.serverPath("/console-history"), nil, f.owner), 200)
	operationsExpect(t, f.request("GET", f.serverPath("/console-history?after=invalid"), nil, f.owner), 422)
	if err = a.exec(ctx, "DELETE FROM servers WHERE id=$1", id); err != nil {
		t.Fatal(err)
	}
	var count int
	if err = a.DB.QueryRow(ctx, "SELECT count(*) FROM console_log_entries WHERE server_id=$1", id).Scan(&count); err != nil || count != 0 {
		t.Fatal("history not cascaded", count, err)
	}
}

func TestConsoleLogsBytesAndLeaseFencing(t *testing.T) {
	f := operationsFixtureNew(t)
	a, ctx, id := f.a, context.Background(), num(f.server["id"])
	claimed, err := a.consoleLogLease(ctx, id, "first")
	if err != nil || !claimed {
		t.Fatal(claimed, err)
	}
	claimed, err = a.consoleLogLease(ctx, id, "second")
	if err != nil || claimed {
		t.Fatal("duplicate capture lease", claimed, err)
	}
	if err = a.exec(ctx, "UPDATE console_log_collectors SET lease_until=now()-interval '1 second' WHERE server_id=$1", id); err != nil {
		t.Fatal(err)
	}
	claimed, err = a.consoleLogLease(ctx, id, "second")
	if err != nil || !claimed {
		t.Fatal(claimed, err)
	}
	if err = a.appendConsoleLogs(ctx, id, "first", consoleLogLines("console output", "stale writer")); err == nil {
		t.Fatal("expired writer persisted logs")
	}
	entries := make([]consoleLogEntry, 600)
	for i := range entries {
		entries[i] = consoleLogEntry{"console output", strings.Repeat("x", consoleLogLineBytes)}
	}
	if err = a.appendConsoleLogs(ctx, id, "second", entries); err != nil {
		t.Fatal(err)
	}
	var bytes, count int
	if err = a.DB.QueryRow(ctx, "SELECT coalesce(sum(octet_length(line)),0),count(*) FROM console_log_entries WHERE server_id=$1", id).Scan(&bytes, &count); err != nil || bytes > consoleLogBytes || count != 512 {
		t.Fatal("byte budget not enforced", bytes, count, err)
	}
}

func TestConsoleLogsCursorCatchup(t *testing.T) {
	f := operationsFixtureNew(t)
	ctx := context.Background()
	id := num(f.server["id"])
	if err := f.a.appendConsoleLogs(ctx, id, "", consoleLogLines("console output", "before disconnect")); err != nil {
		t.Fatal(err)
	}
	first := operationsExpect(t, f.request("GET", f.serverPath("/console-history"), nil, f.owner), 200)
	entries := make([]consoleLogEntry, 600)
	for i := range entries {
		entries[i] = consoleLogEntry{"console output", fmt.Sprintf("catchup %d", i)}
	}
	if err := f.a.appendConsoleLogs(ctx, id, "", entries); err != nil {
		t.Fatal(err)
	}
	page := operationsExpect(t, f.request("GET", f.serverPath("/console-history?after="+str(first["cursor"])), nil, f.owner), 200)
	if len(asSlice(page["data"])) != 500 || !boolean(page["more"]) {
		t.Fatal("catchup page is not bounded", page)
	}
	tail := operationsExpect(t, f.request("GET", f.serverPath("/console-history?after="+str(page["cursor"])), nil, f.owner), 200)
	rows := asSlice(tail["data"])
	if len(rows) != 100 || boolean(tail["more"]) || str(asMap(rows[99])["line"]) != "catchup 599" {
		t.Fatal("cursor lost catchup output", tail)
	}
	reset := operationsExpect(t, f.request("GET", f.serverPath("/console-history?after=999999999"), nil, f.owner), 200)
	if !boolean(reset["reset"]) || len(asSlice(reset["data"])) != 601 {
		t.Fatal("future cursor did not reset")
	}
}

func TestConsoleLogsCollectWithoutBrowserAndFlushFinalCrashOutput(t *testing.T) {
	f := operationsFixtureNew(t)
	a, ctx, id := f.a, context.Background(), num(f.server["id"])
	authResult := make(chan error, 1)
	upgrader := websocket.Upgrader{CheckOrigin: func(r *http.Request) bool { return r.Header.Get("Origin") == a.Config.PublicURL }}
	wings := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			authResult <- err
			return
		}
		defer conn.Close()
		var auth struct {
			Event string   `json:"event"`
			Args  []string `json:"args"`
		}
		if err = conn.ReadJSON(&auth); err != nil {
			authResult <- err
			return
		}
		if auth.Event != "auth" || len(auth.Args) != 1 {
			authResult <- fmt.Errorf("missing auth")
			return
		}
		parsed, err := jwt.Parse(auth.Args[0], func(*jwt.Token) (any, error) { return []byte("operations-daemon-secret"), nil }, jwt.WithValidMethods([]string{"HS256"}))
		if err != nil {
			authResult <- err
			return
		}
		if _, err = uuid.Parse(str(parsed.Claims.(jwt.MapClaims)["user_uuid"])); err != nil {
			authResult <- fmt.Errorf("collector identity rejected by Wings revocation rules")
			return
		}
		permissions := asSlice(parsed.Claims.(jwt.MapClaims)["permissions"])
		if len(permissions) != 2 || str(permissions[0]) != "websocket.connect" || str(permissions[1]) != "admin.websocket.install" {
			authResult <- fmt.Errorf("collector permissions too broad")
			return
		}
		if err = conn.WriteJSON(M{"event": "auth success", "args": []string{}}); err != nil {
			authResult <- err
			return
		}
		_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
		var replay struct {
			Event string `json:"event"`
		}
		if err = conn.ReadJSON(&replay); err != nil || replay.Event != "send logs" {
			authResult <- fmt.Errorf("empty archive did not request Wings tail: %v", err)
			return
		}
		authResult <- nil
		for _, m := range []M{{"event": "status", "args": []string{"running"}}, {"event": "console output", "args": []string{"last game line"}}, {"event": "console output", "args": []string{"[ERROR] final crash diagnostic"}}, {"event": "status", "args": []string{"offline"}}} {
			if err = conn.WriteJSON(m); err != nil {
				return
			}
		}
	}))
	defer wings.Close()
	u, _ := url.Parse(wings.URL)
	port, _ := strconv.Atoi(u.Port())
	if _, err := a.update(ctx, "nodes", num(f.node["id"]), M{"fqdn": u.Hostname(), "daemon_listen": port}); err != nil {
		t.Fatal(err)
	}
	claimed, err := a.consoleLogLease(ctx, id, "capture")
	if err != nil || !claimed {
		t.Fatal(err)
	}
	bounded, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	_ = a.consoleLogSession(bounded, f.server, "capture")
	if err = <-authResult; err != nil {
		t.Fatal(err)
	}
	page := operationsExpect(t, f.request("GET", f.serverPath("/console-history"), nil, f.owner), 200)
	var lines []string
	for _, row := range asSlice(page["data"]) {
		lines = append(lines, str(asMap(row)["line"]))
	}
	all := strings.Join(lines, "\n")
	if !strings.Contains(all, "final crash diagnostic") || !strings.Contains(all, "Server is now offline") {
		t.Fatal("lost output at disconnect", all)
	}
}

func TestConsoleLogTokenHasReadOnlyRevocationIdentity(t *testing.T) {
	a := &App{Config: Config{PublicURL: "http://panel.test"}}
	node := M{"id": int64(1), "fqdn": "wings.test", "daemon_listen": int64(8080), "scheme": "http", "daemon_token": "test-console-key"}
	identity := ""
	for _, serverID := range []string{"server-one", "server-one", "server-two"} {
		encoded, err := a.consoleLogToken(node, M{"uuid": serverID})
		if err != nil {
			t.Fatal(err)
		}
		token, err := jwt.Parse(encoded, func(*jwt.Token) (any, error) { return []byte("test-console-key"), nil }, jwt.WithValidMethods([]string{"HS256"}))
		if err != nil || !token.Valid {
			t.Fatal("invalid collector token", err)
		}
		claims := token.Claims.(jwt.MapClaims)
		current := str(claims["user_uuid"])
		if _, err = uuid.Parse(current); err != nil {
			t.Fatal("collector fails Wings user identity requirement")
		}
		if identity != "" && ((serverID == "server-one") != (identity == current)) {
			t.Fatal("identity must be stable per server and distinct across servers")
		}
		if serverID == "server-one" {
			identity = current
		}
		if str(claims["scope"]) != "websocket" || str(claims["server_uuid"]) != serverID {
			t.Fatal("invalid collector scope")
		}
		permissions := asSlice(claims["permissions"])
		if len(permissions) != 2 || str(permissions[0]) != "websocket.connect" || str(permissions[1]) != "admin.websocket.install" {
			t.Fatal("collector must not gain command or power permissions")
		}
	}
}

func TestConsoleCaptureDiagnosticsSanitizedAndRateLimited(t *testing.T) {
	secret := "secret-token-and-remote-payload"
	for _, tc := range []struct {
		err  error
		want string
	}{
		{fmt.Errorf("%s", secret), "capture session failed"},
		{&websocket.CloseError{Code: 1008, Text: secret}, "websocket closed (code 1008)"},
		{context.Canceled, "capture canceled"},
		{&consoleCaptureFailure{"websocket handshake rejected (HTTP 403)", fmt.Errorf("%s", secret)}, "websocket handshake rejected (HTTP 403)"},
		{fmt.Errorf("console capture authentication rejected"), "console capture authentication rejected"},
	} {
		if got := consoleCaptureReason(tc.err); got != tc.want || strings.Contains(got, secret) {
			t.Fatalf("unsafe reason %q", got)
		}
	}
	s := &consoleCaptureState{}
	now := time.Now()
	if s.diagnose(now, context.Canceled) || s.diagnose(now, nil) {
		t.Fatal("normal cleanup logged")
	}
	if !s.diagnose(now, fmt.Errorf("failure")) || s.diagnose(now.Add(time.Second), fmt.Errorf("failure")) || s.suppressed != 1 || !s.diagnose(now.Add(time.Minute), fmt.Errorf("failure")) {
		t.Fatal("diagnostics are not bounded per worker")
	}
}

func TestConsoleCaptureRenewReconnectAndCancellation(t *testing.T) {
	for _, existing := range []bool{false, true} {
		t.Run(fmt.Sprintf("existing_history_%t", existing), func(t *testing.T) {
			testConsoleCaptureRenewReconnectAndCancellation(t, existing)
		})
	}
}

func testConsoleCaptureRenewReconnectAndCancellation(t *testing.T, existing bool) {
	f := operationsFixtureNew(t)
	ctx := context.Background()
	id := num(f.server["id"])
	const owner = "capture-regression"
	if existing {
		if err := f.a.appendConsoleLogs(ctx, id, "", consoleLogLines("console output", "quiet saved history")); err != nil {
			t.Fatal(err)
		}
		if err := f.a.exec(ctx, "UPDATE console_log_entries SET created_at=now()-interval '30 days' WHERE server_id=$1", id); err != nil {
			t.Fatal(err)
		}
	}

	if ok, err := f.a.consoleLogLease(ctx, id, owner); err != nil || !ok {
		t.Fatal(ok, err)
	}
	results := make(chan error, 2)
	release := make(chan struct{})
	var sessions atomic.Int32
	wings := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := (&websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}).Upgrade(w, r, nil)
		if err != nil {
			results <- err
			return
		}
		defer conn.Close()
		_ = conn.SetReadDeadline(time.Now().Add(5 * time.Second))
		var request struct {
			Event string `json:"event"`
		}
		if err = conn.ReadJSON(&request); err != nil || request.Event != "auth" {
			results <- fmt.Errorf("initial auth: %v", err)
			return
		}
		n := sessions.Add(1)
		send := func(event, text string) error { return conn.WriteJSON(M{"event": event, "args": []string{text}}) }
		if err = send("auth success", ""); err != nil {
			results <- err
			return
		}
		if n == 1 && !existing {
			if err = conn.ReadJSON(&request); err != nil || request.Event != "send logs" {
				results <- fmt.Errorf("initial tail: %v", err)
				return
			}
		}
		if err = send("token expiring", ""); err != nil {
			results <- err
			return
		}
		if err = conn.ReadJSON(&request); err != nil || request.Event != "auth" {
			results <- fmt.Errorf("renewal requested tail or missed auth: %v (%s)", err, request.Event)
			return
		}
		if err = send("auth success", ""); err != nil {
			results <- err
			return
		}
		if err = send("console output", fmt.Sprintf("session %d final output", n)); err != nil {
			results <- err
			return
		}
		results <- nil
		if n == 1 {
			_ = conn.WriteControl(websocket.CloseMessage, websocket.FormatCloseMessage(1012, "private upstream text"), time.Now().Add(time.Second))
			return
		}
		// Keep the socket open until client context cancellation closes it.
		close(release)
		_ = conn.ReadJSON(&request)
	}))
	defer wings.Close()
	u, _ := url.Parse(wings.URL)
	port, _ := strconv.Atoi(u.Port())
	if _, err := f.a.update(ctx, "nodes", num(f.node["id"]), M{"fqdn": u.Hostname(), "daemon_listen": port}); err != nil {
		t.Fatal(err)
	}
	capture := &consoleCaptureState{}
	bounded, cancel := context.WithTimeout(ctx, 5*time.Second)
	err := f.a.consoleLogSessionWithState(bounded, f.server, owner, capture)
	cancel()
	if err == nil {
		t.Fatal("disconnect was hidden")
	}
	if e := <-results; e != nil {
		t.Fatal(e)
	}
	capture.disconnectedAt = time.Now().Add(-2 * time.Second)
	capture.reason = consoleCaptureReason(err)
	bounded, cancel = context.WithTimeout(ctx, 5*time.Second)
	done := make(chan error, 1)
	go func() { done <- f.a.consoleLogSessionWithState(bounded, f.server, owner, capture) }()
	<-release
	if e := <-results; e != nil {
		cancel()
		t.Fatal(e)
	}
	// Await persistence so cancellation tests cleanup without racing wire delivery.
	deadline := time.Now().Add(3 * time.Second)
	for {
		var exists bool
		if e := f.a.DB.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM console_log_entries WHERE server_id=$1 AND line='session 2 final output')", id).Scan(&exists); e != nil {
			cancel()
			t.Fatal(e)
		}
		if exists {
			break
		}
		if time.Now().After(deadline) {
			cancel()
			t.Fatal("second session output missing")
		}
		time.Sleep(10 * time.Millisecond)
	}
	cancel()
	select {
	case err = <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("cancellation: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("capture did not clean up")
	}
	rows, err := f.a.query(ctx, "SELECT line FROM console_log_entries WHERE server_id=$1 ORDER BY id", id)
	if err != nil {
		t.Fatal(err)
	}
	var lines []string
	for _, row := range rows {
		lines = append(lines, str(row["line"]))
	}
	all := strings.Join(lines, "\n")
	if strings.Count(all, "capture connected.") != 1 || strings.Count(all, "capture reconnected") != 1 || !strings.Contains(all, "approximately 2s") || !strings.Contains(all, "code 1012") || strings.Contains(all, "private upstream") || strings.Count(all, "session 1 final output") != 1 || strings.Count(all, "session 2 final output") != 1 {
		t.Fatal("incorrect capture continuity", all)
	}
	for _, line := range lines {
		if strings.Contains(line, "capture connected.") && (strings.Contains(line, "\x1b[93m") || strings.Contains(line, "may be missing") || strings.Contains(line, "ago") || !strings.Contains(line, "Saved history is retained")) {
			t.Fatal("initial attachment warns of a gap or log age", line)
		}
	}
	if existing && strings.Count(all, "quiet saved history") != 1 {
		t.Fatal("saved history lost", all)
	}
}
