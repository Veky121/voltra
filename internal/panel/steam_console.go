package panel

import (
	"context"
	"errors"
	"log/slog"
	"strings"
	"voltra/internal/steamapi"
)

func (a *App) steamConsoleAvailable(nodeID int64) bool {
	h := a.connectors()
	h.mu.Lock()
	defer h.mu.Unlock()
	c := h.controls[nodeID]
	return c != nil && c.capabilities[steamapi.ConsoleCapability]
}

func steamConsoleLines(stage string, lines []string) []consoleLogEntry {
	entries := []consoleLogEntry{}
	label := "Steam"
	if stage == "steamcmd" {
		label = "SteamCMD"
	} else if stage == "metadata" {
		label = "Steam check"
	} else if stage == "executing" {
		label = "Steam game"
	}
	for _, raw := range lines {
		line := steamapi.ConsoleLine(raw)
		if line == "" {
			continue
		}
		color := "0"
		lower := strings.ToLower(line)
		switch {
		case stage == "failed" || stage == "error" || strings.Contains(lower, "error!") || strings.Contains(lower, "failed"):
			color = "91"
		case stage == "complete" || strings.Contains(lower, "success!") || strings.Contains(lower, "fully installed") || strings.HasPrefix(lower, "game is up to date"):
			color = "92"
		case strings.Contains(lower, "warning"):
			color = "93"
		case strings.Contains(lower, "update state") || strings.Contains(lower, "progress:"):
			color = "94"
		}
		entries = append(entries, consoleLogEntry{"steam output", "\x1b[0m\x1b[96m[" + label + "]: \x1b[" + color + "m" + line + "\x1b[0m"})
	}
	return entries
}

func (a *App) recordSteamConsole(ctx context.Context, serverID int64, stage string, lines []string) error {
	return a.appendConsoleLogs(ctx, serverID, "", steamConsoleLines(stage, lines))
}

func (a *App) steamConsoleOutput(ctx context.Context, job M, token, stage string, lines []string) error {
	if stage != "steamcmd" && stage != "metadata" && stage != "executing" {
		return errors.New("Invalid Steam console stage.")
	}
	if len(lines) == 0 || len(lines) > steamapi.ConsoleBatchLines {
		return errors.New("Invalid Steam console batch.")
	}
	for _, line := range lines {
		if len(line) > steamapi.ConsoleLineBytes {
			return errors.New("Invalid Steam console line.")
		}
	}
	row, err := a.one(ctx, "SELECT server_id FROM steam_jobs WHERE id=$1 AND lease_token=$2 AND status='running' AND lease_until>now()", job["id"], token)
	if err != nil {
		return errors.New("Steam console job lease was lost.")
	}
	return a.recordSteamConsole(ctx, num(row["server_id"]), stage, lines)
}

func (a *App) steamConsoleProgress(ctx context.Context, jobID, stage, detail string) {
	row, err := a.one(ctx, "SELECT server_id FROM steam_jobs WHERE id=$1", jobID)
	if err == nil {
		err = a.recordSteamConsole(ctx, num(row["server_id"]), stage, []string{detail})
	}
	if err != nil {
		slog.Warn("could not retain Steam console progress", "job_id", jobID)
	}
}
