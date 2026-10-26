package steamexec

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"voltra/internal/steamapi"
)

func TestSteamConsoleFramesSplitCRLFSanitizesAndFlushesTail(t *testing.T) {
	var events []steamapi.Event
	w := &consoleOutput{captured: &cappedOutput{max: 100}, emit: func(e steamapi.Event) error { events = append(events, e); return nil }}
	for _, chunk := range []string{"Starting\r\nUpdate state 10", "%\rUpdate state 20%\npass", "word=secret\nfinal tail"} {
		if _, err := io.WriteString(w, chunk); err != nil {
			t.Fatal(err)
		}
	}
	if err := w.finish(); err != nil {
		t.Fatal(err)
	}
	var lines []string
	for _, e := range events {
		lines = append(lines, e.Lines...)
	}
	if strings.Join(lines, "|") != "Starting|Update state 10%|Update state 20%|[credential-related Steam output redacted]|final tail" {
		t.Fatal(lines)
	}
}

func TestSteamConsoleBoundsBatchesAndDoesNotLeakOversizedRemainder(t *testing.T) {
	count := 0
	w := &consoleOutput{captured: &cappedOutput{max: 64}, emit: func(e steamapi.Event) error {
		b, _ := json.Marshal(e)
		if len(e.Lines) > steamapi.ConsoleBatchLines || len(b) >= 64<<10 {
			t.Fatal("unbounded batch")
		}
		for _, line := range e.Lines {
			if len(line) > steamapi.ConsoleLineBytes {
				t.Fatal("unbounded line")
			}
		}
		count += len(e.Lines)
		return nil
	}}
	if _, err := io.WriteString(w, strings.Repeat(strings.Repeat("\\", 9000)+"\n", 100)); err != nil {
		t.Fatal(err)
	}
	if count != 100 || len(w.pending) != 0 {
		t.Fatal(count, len(w.pending))
	}
	if _, truncated := w.captured.text(); !truncated {
		t.Fatal("diagnostics not bounded")
	}
}

func TestSteamConsoleStreamFailurePropagates(t *testing.T) {
	w := &consoleOutput{captured: &cappedOutput{max: 10}, emit: func(steamapi.Event) error { return errors.New("disconnected") }}
	if _, err := io.WriteString(w, "line\n"); err == nil {
		t.Fatal("stream failure ignored")
	}
}

func TestSteamConsoleSeparatesClientUpdatesFromMetadataAndGameDownloads(t *testing.T) {
	for _, metadata := range []bool{true, false} {
		var events []steamapi.Event
		w := &consoleOutput{captured: &cappedOutput{max: 8192}, metadata: metadata, emit: func(e steamapi.Event) error { events = append(events, e); return nil }}
		_, err := io.WriteString(w, "[ 0%] Downloading update (1 of 41429 KB)...\r[----] Applying update...\nSteam Console Client (c) Valve Corporation\nLoading Steam API...OK\n")
		if err != nil {
			t.Fatal(err)
		}
		if !metadata {
			_, _ = io.WriteString(w, "Update state (0x61) downloading, progress: 25%\nSuccess! App fully installed.\n")
		}
		if err = w.finish(); err != nil {
			t.Fatal(err)
		}
		if len(events) < 2 || events[0].Stage != "steamcmd" || events[0].FilesChanged {
			t.Fatal("client downloads mislabeled", events)
		}
		want := "executing"
		if metadata {
			want = "metadata"
		}
		if events[1].Stage != want {
			t.Fatal("ready phase lost", events)
		}
		if !metadata && events[len(events)-1].Stage != "executing" {
			t.Fatal("game download mislabeled", events)
		}
	}
}

func TestSteamExecutorOutputIsOptInAndStillCompletes(t *testing.T) {
	for _, enabled := range []bool{false, true} {
		t.Run(map[bool]string{false: "legacy", true: "streaming"}[enabled], func(t *testing.T) {
			e, d := fixture(t)
			d.mutate = func(_ context.Context, out io.Writer) error {
				if _, err := io.WriteString(out, "Update state (0x61) downloading, progress: 25%\rSuccess! App fully installed.\n"); err != nil {
					return err
				}
				return os.WriteFile(filepath.Join(d.dir, "steamapps", "appmanifest_2394010.acf"), []byte(manifest("200")), 0600)
			}
			r := req("update")
			r.StreamOutput = enabled
			events := execute(e, r)
			last := terminal(t, events)
			if last.Type != "result" {
				t.Fatal(last)
			}
			count := 0
			for _, event := range events {
				if event.Type == "output" {
					count += len(event.Lines)
				}
			}
			if enabled && count != 3 || !enabled && count != 0 {
				t.Fatal("wrong output count", count)
			}
		})
	}
}
