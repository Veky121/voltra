package panel

import (
	"context"
	"strings"
	"testing"
)

func TestSteamConsoleColorsAndSanitization(t *testing.T) {
	lines := steamConsoleLines("executing", []string{"Update state (0x61) downloading, progress: 25%", "Success! App fully installed.", "ERROR! Failed to install", "password=secret", "\x1b[2Jplain"})
	for i, color := range []string{"94", "92", "91", "0", "0"} {
		if !strings.Contains(lines[i].Line, "\x1b["+color+"m") || !strings.Contains(lines[i].Line, "[Steam game]:") {
			t.Fatal(lines[i])
		}
	}
	if strings.Contains(lines[3].Line, "secret") || strings.Contains(lines[4].Line, "\x1b[2J") {
		t.Fatal("unsafe console output")
	}
}

func TestSteamConsolePhaseLabelsAndValidation(t *testing.T) {
	for stage, label := range map[string]string{"steamcmd": "SteamCMD", "metadata": "Steam check", "executing": "Steam game"} {
		entries := steamConsoleLines(stage, []string{"Downloading update (1 of 41429 KB)..."})
		if len(entries) != 1 || !strings.Contains(entries[0].Line, "["+label+"]:") {
			t.Fatal(stage, entries)
		}
	}
	a := &App{}
	for _, stage := range []string{"", "game", "complete", "\x1b[31m"} {
		if err := a.steamConsoleOutput(context.Background(), M{}, "", stage, []string{"line"}); err == nil {
			t.Fatal("untrusted phase accepted", stage)
		}
	}
}

func TestSteamConsolePersistsThroughDisconnectedCaptureAndReload(t *testing.T) {
	f := operationsFixtureNew(t)
	ctx := context.Background()
	// Existing installations retain all console rows through the additive enum update.
	if _, err := f.a.DB.Exec(ctx, `ALTER TABLE console_log_entries DROP CONSTRAINT console_log_entries_event_check; ALTER TABLE console_log_entries ADD CONSTRAINT console_log_entries_event_check CHECK(event IN ('console output','daemon message','install output','panel message'))`); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		if _, err := f.a.DB.Exec(ctx, schema); err != nil {
			t.Fatal(err)
		}
	}
	if err := f.a.recordSteamConsole(ctx, num(f.server["id"]), "executing", []string{"Download 25%", "Download 50%", "Success! App fully installed."}); err != nil {
		t.Fatal(err)
	}
	for _, user := range []M{f.owner, f.sub} {
		data := operationsExpect(t, f.request("GET", f.serverPath("/console-history"), nil, user), 200)
		entries := asSlice(data["data"])
		if len(entries) != 3 || str(asMap(entries[0])["event"]) != "steam output" || !strings.Contains(str(asMap(entries[2])["line"]), "fully installed") {
			t.Fatal("Steam console history missing", data)
		}
		cursor := str(data["cursor"])
		again := operationsExpect(t, f.request("GET", f.serverPath("/console-history?after="+cursor), nil, user), 200)
		if len(asSlice(again["data"])) != 0 {
			t.Fatal("duplicated Steam output")
		}
	}
	if err := f.a.steamConsoleOutput(ctx, M{"id": newUUID()}, "lost", "executing", []string{"must not appear"}); err == nil {
		t.Fatal("unowned job output accepted")
	}
}
