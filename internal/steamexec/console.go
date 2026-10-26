package steamexec

import (
	"strings"
	"sync"
	"voltra/internal/steamapi"
)

// Keep draining the process and retain bounded private diagnostics, while
// framing stdout/stderr chunks into console lines. A partial line is bounded.
type consoleOutput struct {
	mu           sync.Mutex
	captured     *cappedOutput
	emit         func(steamapi.Event) error
	pending      []byte
	discard      bool
	err          error
	metadata     bool
	metadataDone bool
	clientReady  bool
}

func (w *consoleOutput) line() string {
	line := steamapi.ConsoleLine(string(w.pending))
	// The bootstrap updater runs before Steam's command interface is ready.
	// Never infer game downloads merely from the words "Downloading update".
	if strings.Contains(line, "Steam Console Client") || strings.Contains(line, "Loading Steam API...") || strings.HasPrefix(line, "Update state ") || strings.HasPrefix(line, "Success! App ") {
		w.clientReady = true
	}
	// app_info_print's VDF is configuration metadata, not maintenance progress.
	if w.metadata && (w.metadataDone || strings.HasPrefix(line, "\"")) {
		w.metadataDone = true
		return ""
	}
	return line
}

func (w *consoleOutput) stage() string {
	if !w.clientReady {
		return "steamcmd"
	}
	if w.metadata {
		return "metadata"
	}
	return "executing"
}

func (w *consoleOutput) event(stage string, lines []string) steamapi.Event {
	return steamapi.Event{Type: "output", Stage: stage, Lines: lines, FilesChanged: stage == "executing"}
}

func (w *consoleOutput) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	_, _ = w.captured.Write(p)
	if w.err != nil {
		return len(p), w.err
	}
	lines := []string{}
	batchStage := ""
	batchBytes := 0
	flush := func() {
		if len(lines) == 0 || w.err != nil {
			return
		}
		w.err = w.emit(w.event(batchStage, lines))
		lines = nil
		batchBytes = 0
	}
	for _, b := range p {
		if w.err != nil {
			break
		}
		if b == '\r' || b == '\n' {
			if line := w.line(); line != "" {
				stage := w.stage()
				if batchStage != stage || batchBytes+len(line) > 16<<10 {
					flush()
				}
				batchStage = stage
				lines = append(lines, line)
				batchBytes += len(line)
			}
			w.pending = w.pending[:0]
			w.discard = false
			if len(lines) == steamapi.ConsoleBatchLines {
				flush()
			}
		} else if !w.discard {
			if len(w.pending) < steamapi.ConsoleLineBytes {
				w.pending = append(w.pending, b)
			} else {
				w.discard = true
			}
		}
	}
	flush()
	return len(p), w.err
}

func (w *consoleOutput) finish() error {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.err == nil {
		if line := w.line(); line != "" {
			w.err = w.emit(w.event(w.stage(), []string{line}))
		}
	}
	w.pending = nil
	return w.err
}
