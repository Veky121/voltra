package panel

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func TestConsoleNewRunRequiresObservedTransition(t *testing.T) {
	for _, pair := range [][2]string{{"offline", "starting"}, {"offline", "running"}, {"stopping", "starting"}, {"running", "starting"}} {
		if !consoleNewRun(pair[0], pair[1]) {
			t.Fatal("missed run boundary", pair)
		}
	}
	for _, pair := range [][2]string{{"", "starting"}, {"", "running"}, {"starting", "running"}, {"running", "running"}, {"running", "offline"}, {"stopping", "offline"}, {"starting", "offline"}} {
		if consoleNewRun(pair[0], pair[1]) {
			t.Fatal("rotated at attachment, duplicate, or stop", pair)
		}
	}
}

func TestConsoleRunCollectorFlushesShutdownBeforeRotation(t *testing.T) {
	f := operationsFixtureNew(t)
	a, ctx, id := f.a, context.Background(), num(f.server["id"])
	if ok, err := a.consoleLogLease(ctx, id, "owner"); err != nil || !ok {
		t.Fatal(ok, err)
	}
	entries := make([]consoleLogEntry, 600)
	for i := range entries {
		entries[i] = consoleLogEntry{"console output", fmt.Sprintf("old %d", i)}
	}
	if err := a.appendConsoleLogs(ctx, id, "owner", entries); err != nil {
		t.Fatal(err)
	}
	wings := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := (&websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}).Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		var request M
		if conn.ReadJSON(&request) != nil {
			return
		}
		for _, message := range [][2]string{{"auth success", ""}, {"console output", "final crash diagnostic"}, {"status", "offline"}, {"console output", "late shutdown output"}, {"status", "starting"}, {"status", "starting"}, {"console output", "fresh startup"}, {"status", "running"}} {
			if conn.WriteJSON(M{"event": message[0], "args": []string{message[1]}}) != nil {
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
	bounded, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	_ = a.consoleLogSessionWithState(bounded, f.server, "owner", &consoleCaptureState{serverState: "running"})
	response := operationsExpect(t, f.request("GET", f.serverPath("/console-history"), nil, f.owner), 200)
	rows := asSlice(response["data"])
	if len(rows) != 254 {
		t.Fatal("duplicate start rotated twice or shutdown data was not flushed", len(rows))
	}
	var text []string
	for _, row := range rows {
		text = append(text, str(asMap(row)["line"]))
	}
	all := strings.Join(text, "\n")
	if !strings.Contains(all, "final crash diagnostic") || !strings.Contains(all, "late shutdown output") || strings.Count(all, "New run.") != 1 || strings.Index(all, "late shutdown output") > strings.Index(all, "New run.") || strings.Index(all, "New run.") > strings.Index(all, "fresh startup") {
		t.Fatal("run boundary lost or reordered final output", all)
	}
}

func TestConsoleRunRetainsCrashTailAndPublishesBoundary(t *testing.T) {
	f := operationsFixtureNew(t)
	a, ctx, id := f.a, context.Background(), num(f.server["id"])
	if ok, err := a.consoleLogLease(ctx, id, "owner"); err != nil || !ok {
		t.Fatal(ok, err)
	}
	entries := make([]consoleLogEntry, 600)
	for i := range entries {
		entries[i] = consoleLogEntry{"console output", fmt.Sprintf("old %d", i)}
	}
	entries[599].Line = "[ERROR] final crash diagnostic"
	if err := a.appendConsoleLogs(ctx, id, "owner", entries); err != nil {
		t.Fatal(err)
	}
	state := consoleLogEntry{"panel message", "\x1b[0m\x1b[94m[Voltra]: Server is starting. Preparing the container and launching the process.\x1b[0m"}
	if err := a.beginConsoleRun(ctx, id, "wrong-owner", state); err == nil {
		t.Fatal("unowned collector trimmed history")
	}
	before := operationsExpect(t, f.request("GET", f.serverPath("/console-history"), nil, f.owner), 200)
	if len(asSlice(before["data"])) != 600 {
		t.Fatal("failed rotation lost crash history")
	}
	if err := a.beginConsoleRun(ctx, id, "owner", state); err != nil {
		t.Fatal(err)
	}
	if err := a.appendConsoleLogs(ctx, id, "owner", consoleLogLines("console output", "fresh startup")); err != nil {
		t.Fatal(err)
	}
	after := operationsExpect(t, f.request("GET", f.serverPath("/console-history"), nil, f.owner), 200)
	rows := asSlice(after["data"])
	if len(rows) != 253 || str(asMap(rows[0])["line"]) != "old 350" || str(asMap(rows[249])["line"]) != "[ERROR] final crash diagnostic" || !strings.Contains(str(asMap(rows[250])["line"]), "New run.") || str(asMap(rows[252])["line"]) != "fresh startup" {
		t.Fatal("wrong retained tail, marker, or startup ordering", len(rows))
	}
	if str(after["run_start"]) != str(asMap(rows[250])["id"]) || str(after["run_start"]) == str(before["run_start"]) {
		t.Fatal("missing durable run boundary")
	}
	delta := operationsExpect(t, f.request("GET", f.serverPath("/console-history?after="+str(before["cursor"])), nil, f.owner), 200)
	if str(delta["run_start"]) != str(after["run_start"]) {
		t.Fatal("connected clients cannot detect rotation")
	}
	if err := a.beginConsoleRun(ctx, id, "owner", state); err != nil {
		t.Fatal(err)
	}
	second := operationsExpect(t, f.request("GET", f.serverPath("/console-history"), nil, f.owner), 200)
	if len(asSlice(second["data"])) != 252 || str(second["run_start"]) == str(after["run_start"]) {
		t.Fatal("short repeated runs grow history or reuse a marker")
	}
}
