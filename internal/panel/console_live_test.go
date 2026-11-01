package panel

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestConsoleLiveBatchesAndRevocationPostgres(t *testing.T) {
	f := operationsFixtureNew(t)
	a, ctx, id := f.a, context.Background(), num(f.server["id"])
	defer a.liveSnapshots.close()
	appendLine := func(event, line string) {
		t.Helper()
		if err := a.appendConsoleLogs(ctx, id, "", consoleLogLines(event, line)); err != nil {
			t.Fatal(err)
		}
	}
	appendLine("console output", "saved before subscription")
	server := httptest.NewServer(a.Handler())
	defer server.Close()
	a.Config.PublicURL = server.URL
	conn := liveTestConnect(t, a, server, num(f.sub["id"]))
	path := f.serverPath("/console-history")
	if err := conn.WriteJSON(M{"type": "subscribe", "revision": 1, "paths": []string{path}}); err != nil {
		t.Fatal(err)
	}
	first := liveRead(t, conn, func(m M) bool { return m["event"] == "console.entries" })
	if num(first["status"]) != 200 || len(asSlice(asMap(first["data"])["data"])) != 0 {
		t.Fatal("stream must start at head", first)
	}
	cursor := str(asMap(first["data"])["cursor"])
	for i := 0; i < 25; i++ {
		appendLine("console output", fmt.Sprintf("burst %d", i))
	}
	appendLine("install output", "private installer credential")
	appendLine("panel message", "panel lifecycle message")
	seen := map[string]bool{}
	for len(seen) < 26 {
		packet := liveRead(t, conn, func(m M) bool { return m["event"] == "console.entries" && m["data"] != nil })
		data := asMap(packet["data"])
		if str(data["after"]) != cursor {
			t.Fatalf("cursor skipped: %v -> %v", cursor, data)
		}
		batch := asSlice(data["data"])
		if len(batch) > 8 {
			t.Fatal("unbounded batch")
		}
		for _, raw := range batch {
			row := asMap(raw)
			line := str(row["line"])
			if seen[line] || strings.Contains(line, "credential") {
				t.Fatal("duplicate or private output", line)
			}
			seen[line] = true
		}
		cursor = str(data["cursor"])
	}
	if !seen["burst 24"] || !seen["panel lifecycle message"] {
		t.Fatal("lost burst or panel output", seen)
	}
	if err := a.exec(ctx, "UPDATE subusers SET permissions='[]'::jsonb WHERE user_id=$1", f.sub["id"]); err != nil {
		t.Fatal(err)
	}
	a.liveSnapshots.invalidate(num(f.sub["id"]))
	denied := liveRead(t, conn, func(m M) bool { return num(m["status"]) == 403 })
	if asMap(denied["data"])["data"] != nil {
		t.Fatal("logs exposed after revocation")
	}
}

func TestConsoleLiveFrameBoundAndResetPostgres(t *testing.T) {
	f := operationsFixtureNew(t)
	a, ctx, id := f.a, context.Background(), num(f.server["id"])
	if err := a.appendConsoleLogs(ctx, id, "", consoleLogLines("console output", "initial")); err != nil {
		t.Fatal(err)
	}
	topic, ok := a.liveTopic(f.serverPath("/console-history"))
	if !ok {
		t.Fatal("console topic unavailable")
	}
	decode := func() M {
		t.Helper()
		sample := a.loadLiveSample(ctx, topic, num(f.admin["id"]))
		if sample.status != 200 {
			t.Fatalf("sample status %d: %s", sample.status, sample.data)
		}
		var body M
		if err := json.Unmarshal(sample.data, &body); err != nil {
			t.Fatal(err)
		}
		return body
	}
	body := decode()
	topic.consoleAfter = str(body["cursor"])
	for i := 0; i < 10; i++ {
		if err := a.appendConsoleLogs(ctx, id, "", consoleLogLines("console output", strings.Repeat("\x01", 16000))); err != nil {
			t.Fatal(err)
		}
	}
	body = decode()
	if len(asSlice(body["data"])) != 8 || !boolean(body["more"]) {
		t.Fatal("escaped lines exceed frame or pagination broke", body["more"])
	}
	topic.consoleAfter = str(body["cursor"])
	body = decode()
	if len(asSlice(body["data"])) != 2 || boolean(body["more"]) {
		t.Fatal("tail missing")
	}
	if err := a.exec(ctx, "DELETE FROM console_log_entries WHERE server_id=$1", id); err != nil {
		t.Fatal(err)
	}
	topic.consoleAfter = str(body["cursor"])
	body = decode()
	if !boolean(body["reset"]) || str(body["head"]) != "0" {
		t.Fatal("reset missing")
	}
}
