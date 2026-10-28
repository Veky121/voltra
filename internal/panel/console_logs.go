package panel

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/jackc/pgx/v5"
)

const consoleLogBytes = 8 << 20
const consoleLogLineBytes = 16 << 10

type consoleLogEntry struct{ Event, Line string }

func (a *App) consoleLogLimit() int {
	if a.Config.ConsoleHistoryLines < 1 {
		return 5000
	}
	if a.Config.ConsoleHistoryLines > 50000 {
		return 50000
	}
	return a.Config.ConsoleHistoryLines
}

func consoleLogLines(event, text string) []consoleLogEntry {
	if event != "console output" && event != "daemon message" && event != "install output" && event != "panel message" && event != "steam output" {
		return nil
	}
	text = strings.ReplaceAll(strings.ToValidUTF8(text, "�"), "\x00", "�")
	parts := strings.Split(strings.TrimSuffix(strings.ReplaceAll(text, "\r\n", "\n"), "\n"), "\n")
	entries := make([]consoleLogEntry, 0, len(parts))
	for _, line := range parts {
		if len(line) > consoleLogLineBytes {
			line = line[:consoleLogLineBytes]
			for !utf8.ValidString(line) {
				line = line[:len(line)-1]
			}
			line += " [line truncated by Voltra]"
		}
		entries = append(entries, consoleLogEntry{event, line})
	}
	return entries
}

// Serialize writers before allocating sequence IDs, so a cursor never skips a
// concurrently committing power request. A collector lease fences old workers.
func (a *App) appendConsoleLogs(ctx context.Context, serverID int64, owner string, entries []consoleLogEntry) error {
	if len(entries) == 0 {
		return nil
	}
	tx, err := a.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtextextended('voltra:console-history:'||$1::bigint::text,0))", serverID); err != nil {
		return err
	}
	if owner != "" {
		var valid bool
		if err = tx.QueryRow(ctx, "SELECT lease_owner=$2 AND lease_until>now() FROM console_log_collectors WHERE server_id=$1 FOR UPDATE", serverID, owner).Scan(&valid); err != nil {
			return err
		}
		if !valid {
			return fmt.Errorf("console capture lease expired")
		}
	}
	events, lines := make([]string, len(entries)), make([]string, len(entries))
	for i, entry := range entries {
		events[i], lines[i] = entry.Event, entry.Line
	}
	if _, err = tx.Exec(ctx, `INSERT INTO console_log_entries(server_id,event,line)
 SELECT $1,event,line FROM unnest($2::text[],$3::text[]) WITH ORDINALITY AS e(event,line,position) ORDER BY position`, serverID, events, lines); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `DELETE FROM console_log_entries WHERE server_id=$1 AND id <= (
 SELECT max(id) FROM (SELECT id,row_number() OVER(ORDER BY id DESC) AS n,
 sum(octet_length(line)) OVER(ORDER BY id DESC) AS bytes FROM console_log_entries WHERE server_id=$1) tail
 WHERE n>$2 OR bytes>$3)`, serverID, a.consoleLogLimit(), consoleLogBytes); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, "UPDATE console_log_collectors SET last_event_at=now() WHERE server_id=$1", serverID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (a *App) recordConsolePower(ctx context.Context, serverID int64, signal, stage string) {
	name := map[string]string{"start": "Start", "stop": "Stop", "restart": "Restart", "kill": "Force stop"}[signal]
	if name == "" {
		return
	}
	color, message := "94", name+" requested."
	if stage == "accepted" {
		message = name + " request accepted by the node. Waiting for a state update."
	}
	if stage == "failed" {
		color, message = "91", "Could not confirm the "+strings.ToLower(name)+" request. Check server state before retrying."
	}
	if stage == "requested" {
		switch signal {
		case "stop":
			color, message = "93", message+" Waiting for graceful shutdown; the game may need time to save."
		case "restart":
			color, message = "93", message+" Waiting for shutdown, then startup."
		case "kill":
			color, message = "91", message+" Unsaved data may be lost."
		}
	}
	writeCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 2*time.Second)
	defer cancel()
	if err := a.appendConsoleLogs(writeCtx, serverID, "", consoleLogLines("panel message", "\x1b[0m\x1b["+color+"m[Voltra]: "+message+"\x1b[0m")); err != nil {
		slog.Warn("could not retain console power event", "server_id", serverID)
	}
}

func (a *App) clientConsoleHistory(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	s, err := a.server(r, "websocket.connect")
	if err != nil {
		fail(w, err)
		return
	}
	u, err := a.user(r)
	if err != nil {
		fail(w, err)
		return
	}
	after := int64(0)
	if raw := r.URL.Query().Get("after"); raw != "" {
		after, err = strconv.ParseInt(raw, 10, 64)
		if err != nil || after < 0 {
			fail(w, bad("after must be a nonnegative console cursor"))
			return
		}
	}
	tx, err := a.DB.BeginTx(r.Context(), pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		fail(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	var oldest, newest int64
	if err = tx.QueryRow(r.Context(), "SELECT coalesce(min(id),0),coalesce(max(id),0) FROM console_log_entries WHERE server_id=$1", s["id"]).Scan(&oldest, &newest); err != nil {
		fail(w, err)
		return
	}
	reset := after > newest
	if reset {
		after = 0
	}
	limit := 500
	if after == 0 {
		limit = a.consoleLogLimit()
	}
	rows, err := tx.Query(r.Context(), `SELECT id::text AS id,event,line,created_at FROM console_log_entries
 WHERE server_id=$1 AND id>$2 AND id<=$3 AND ($4 OR event<>'install output') ORDER BY console_log_entries.id LIMIT $5`, s["id"], after, newest, boolean(u["root_admin"]), limit+1)
	if err != nil {
		fail(w, err)
		return
	}
	data, err := pgx.CollectRows(rows, pgx.RowToMap)
	if err != nil {
		fail(w, err)
		return
	}
	more := len(data) > limit
	if more {
		data = data[:limit]
	}
	cursor := newest
	if more {
		cursor, _ = strconv.ParseInt(str(data[len(data)-1]["id"]), 10, 64)
	}
	var connected bool
	var lastEvent *time.Time
	err = tx.QueryRow(r.Context(), "SELECT connected AND lease_until>now(),last_event_at FROM console_log_collectors WHERE server_id=$1", s["id"]).Scan(&connected, &lastEvent)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		fail(w, err)
		return
	}
	if err = tx.Commit(r.Context()); err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, 200, M{"data": data, "cursor": strconv.FormatInt(cursor, 10), "more": more, "reset": reset,
		"truncated": after > 0 && oldest > after, "limits": M{"lines": a.consoleLogLimit(), "bytes": consoleLogBytes},
		"capture": M{"connected": connected, "last_event_at": lastEvent}})
}

// One read-only Wings connection per server continues collecting with no browser
// open. Short DB leases prevent duplicate collectors across panel processes.
func (a *App) RunConsoleLogs(ctx context.Context) {
	type worker struct {
		cancel context.CancelFunc
		node   int64
	}
	workers := map[int64]worker{}
	var wg sync.WaitGroup
	defer func() {
		for _, w := range workers {
			w.cancel()
		}
		wg.Wait()
	}()
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	for {
		servers, err := a.query(ctx, `SELECT id,uuid,node_id FROM servers s WHERE status IS DISTINCT FROM 'suspended'
 AND NOT EXISTS(SELECT 1 FROM server_transfers t WHERE t.server_id=s.id AND t.successful IS NULL)`)
		if err == nil {
			wanted := map[int64]bool{}
			for _, server := range servers {
				id, node := num(server["id"]), num(server["node_id"])
				wanted[id] = true
				if old, exists := workers[id]; exists {
					if old.node == node {
						continue
					}
					old.cancel()
				}
				workerCtx, cancel := context.WithCancel(ctx)
				workers[id] = worker{cancel, node}
				wg.Add(1)
				go func(s M) { defer wg.Done(); a.collectConsoleLogs(workerCtx, s) }(server)
			}
			for id, w := range workers {
				if !wanted[id] {
					w.cancel()
					delete(workers, id)
				}
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (a *App) consoleLogLease(ctx context.Context, id int64, owner string) (bool, error) {
	var claimed string
	err := a.DB.QueryRow(ctx, `INSERT INTO console_log_collectors(server_id,lease_owner,lease_until) VALUES($1,$2,now()+interval '45 seconds')
 ON CONFLICT(server_id) DO UPDATE SET lease_owner=$2,lease_until=now()+interval '45 seconds'
 WHERE console_log_collectors.lease_until<now() OR console_log_collectors.lease_owner=$2 RETURNING lease_owner`, id, owner).Scan(&claimed)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}

// Reasons are fixed categories: never include remote close text, URLs, tokens,
// JSON payloads, or database error details in diagnostics or saved history.
type consoleCaptureFailure struct {
	reason string
	cause  error
}

func (e *consoleCaptureFailure) Error() string { return e.reason }
func (e *consoleCaptureFailure) Unwrap() error { return e.cause }

func consoleCaptureReason(err error) string {
	if errors.Is(err, context.Canceled) {
		return "capture canceled"
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return "capture deadline exceeded"
	}
	var failure *consoleCaptureFailure
	if errors.As(err, &failure) {
		return failure.reason
	}
	var closed *websocket.CloseError
	if errors.As(err, &closed) {
		return fmt.Sprintf("websocket closed (code %d)", closed.Code)
	}
	var network net.Error
	if errors.As(err, &network) {
		if network.Timeout() {
			return "network timeout"
		}
		return "network connection failed"
	}
	for _, reason := range []string{"console capture authentication timed out", "console capture authentication rejected", "console capture lease lost", "console capture lease expired"} {
		if err != nil && err.Error() == reason {
			return reason
		}
	}
	return "capture session failed"
}

type consoleCaptureState struct {
	disconnectedAt time.Time
	reason         string
	lastDiagnostic time.Time
	suppressed     int
	serverState    string
}

func (s *consoleCaptureState) diagnose(now time.Time, err error) bool {
	if err == nil || errors.Is(err, context.Canceled) {
		return false
	}
	if !s.lastDiagnostic.IsZero() && now.Sub(s.lastDiagnostic) < time.Minute {
		s.suppressed++
		return false
	}
	s.lastDiagnostic = now
	return true
}

func (a *App) collectConsoleLogs(ctx context.Context, server M) {
	id, owner := num(server["id"]), randomToken(24)
	capture := &consoleCaptureState{}
	for ctx.Err() == nil {
		claimed, err := a.consoleLogLease(ctx, id, owner)
		if err == nil && claimed {
			err = a.consoleLogSessionWithState(ctx, server, owner, capture)
			if ctx.Err() == nil && err != nil {
				if capture.disconnectedAt.IsZero() {
					capture.disconnectedAt = time.Now()
					capture.reason = consoleCaptureReason(err)
				}
			}
			cleanup, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			_, _ = a.DB.Exec(cleanup, "UPDATE console_log_collectors SET connected=false,lease_until=now() WHERE server_id=$1 AND lease_owner=$2", id, owner)
			cancel()
		}
		if ctx.Err() == nil && capture.diagnose(time.Now(), err) {
			slog.Warn("console history capture disconnected", "server_id", id, "node_id", num(server["node_id"]), "reason", consoleCaptureReason(err), "suppressed", capture.suppressed)
			capture.suppressed = 0
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(5 * time.Second):
		}
	}
}

// Wings revocation checks require a nonempty UUID even for read-only service sockets.
// This identity is scoped to the server and never receives command/power permissions.
func (a *App) consoleLogToken(node, server M) (string, error) {
	identity := uuid.NewSHA1(uuid.NameSpaceURL, []byte("voltra:console-history:"+str(server["uuid"]))).String()
	return a.nodeJWT(node, M{"uuid": identity}, M{"server_uuid": server["uuid"], "permissions": []string{"websocket.connect", "admin.websocket.install"}}, "websocket", 10*time.Minute)
}

func (a *App) consoleLogSession(ctx context.Context, server M, owner string) error {
	return a.consoleLogSessionWithState(ctx, server, owner, &consoleCaptureState{})
}

// Only panel-generated state messages count as a remembered process state.
func consoleHistoryServerState(line string) string {
	line = strings.TrimSuffix(line, "\x1b[0m")
	for state, messages := range map[string][]string{
		"offline":  {"Current server state: offline.", "Server is now offline. The process exited or was stopped.", "Server stopped. The container is offline.", "Server went offline during startup. Check the output above."},
		"running":  {"Current server state: running.", "Server entered the running state."},
		"starting": {"Current server state: starting.", "Server is starting. Preparing the container and launching the process."},
		"stopping": {"Current server state: stopping.", "Server is stopping. Waiting for the process to exit."},
	} {
		for _, message := range messages {
			if strings.HasSuffix(line, "m[Voltra]: "+message) {
				return state
			}
		}
	}
	return ""
}

func (a *App) consoleLogSessionWithState(ctx context.Context, server M, owner string, capture *consoleCaptureState) error {
	if capture.serverState == "" {
		rows, err := a.query(ctx, "SELECT line FROM console_log_entries WHERE server_id=$1 AND event='panel message' ORDER BY id DESC LIMIT 256", server["id"])
		if err != nil {
			return err
		}
		for _, row := range rows {
			if state := consoleHistoryServerState(str(row["line"])); state != "" {
				capture.serverState = state
				break
			}
		}
	}
	node, err := a.node(ctx, num(server["node_id"]))
	if err != nil {
		return err
	}
	target := strings.Replace(strings.Replace(opNodeAddress(node), "http://", "ws://", 1), "https://", "wss://", 1) + "/api/servers/" + url.PathEscape(str(server["uuid"])) + "/ws"
	dialer := *websocket.DefaultDialer
	dialer.HandshakeTimeout = 10 * time.Second
	if str(node["connection_mode"]) == "outbound" {
		dialer.NetDialContext = func(ctx context.Context, network, address string) (net.Conn, error) {
			return a.dialNodeConnector(ctx, num(node["id"]))
		}
	}
	headers := http.Header{"Origin": []string{a.consoleUpstreamOrigin(ctx, node)}}
	conn, resp, err := dialer.DialContext(ctx, target, headers)
	if resp != nil && resp.Body != nil {
		resp.Body.Close()
	}
	if err != nil {
		if resp != nil {
			return &consoleCaptureFailure{fmt.Sprintf("websocket handshake rejected (HTTP %d)", resp.StatusCode), err}
		}
		return err
	}
	defer conn.Close()
	conn.SetReadLimit(256 << 10)
	_ = conn.SetReadDeadline(time.Now().Add(45 * time.Second))
	conn.SetPongHandler(func(string) error { return conn.SetReadDeadline(time.Now().Add(45 * time.Second)) })
	sessionCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	go func() { <-sessionCtx.Done(); conn.Close() }()
	sendAuth := func() error {
		token, err := a.consoleLogToken(node, server)
		if err != nil {
			return err
		}
		_ = conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
		return conn.WriteJSON(M{"event": "auth", "args": []string{token}})
	}
	if err = sendAuth(); err != nil {
		return err
	}
	type message struct {
		Event     string            `json:"event"`
		Args      []json.RawMessage `json:"args"`
		readError error
	}
	incoming := make(chan message, 64)
	go func() {
		for {
			var m message
			if err := conn.ReadJSON(&m); err != nil {
				select {
				case incoming <- message{readError: err}:
				case <-sessionCtx.Done():
				}
				return
			}
			_ = conn.SetReadDeadline(time.Now().Add(45 * time.Second))
			select {
			case incoming <- m:
			case <-sessionCtx.Done():
				return
			}
		}
	}()
	batch := []consoleLogEntry{}
	batchBytes := 0
	flush := func(ctx context.Context) error {
		if len(batch) == 0 {
			return nil
		}
		err := a.appendConsoleLogs(ctx, num(server["id"]), owner, batch)
		if err == nil {
			batch = nil
			batchBytes = 0
		}
		return err
	}
	defer func() {
		finalCtx, finalCancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer finalCancel()
		_ = flush(finalCtx)
	}()
	add := func(event, text string) {
		for _, entry := range consoleLogLines(event, text) {
			batch = append(batch, entry)
			batchBytes += len(entry.Line)
		}
	}
	// Authentication alone says nothing about the process state. Wait for a
	// status (or real output) before deciding whether to warn about continuity.
	attachPending := true
	attach := func(offline bool) {
		if !attachPending {
			return
		}
		attachPending = false
		if !offline {
			message := "\x1b[0m\x1b[94m[Voltra]: Console history capture connected. Saved history is retained; continuity during panel downtime cannot be verified.\x1b[0m"
			if !capture.disconnectedAt.IsZero() {
				gap := time.Since(capture.disconnectedAt).Round(time.Second)
				if gap < time.Second {
					gap = time.Second
				}
				message = fmt.Sprintf("\x1b[0m\x1b[93m[Voltra]: Console history capture reconnected after approximately %s (%s). Output during this capture gap may be missing.\x1b[0m", gap, capture.reason)
			}
			add("panel message", message)
		}
		capture.disconnectedAt = time.Time{}
		capture.reason = ""
	}
	tick := time.NewTicker(250 * time.Millisecond)
	defer tick.Stop()
	heartbeat := time.NewTicker(15 * time.Second)
	defer heartbeat.Stop()
	authenticated, state := false, capture.serverState
	authDeadline := time.NewTimer(15 * time.Second)
	defer authDeadline.Stop()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-authDeadline.C:
			return fmt.Errorf("console capture authentication timed out")
		case <-tick.C:
			if err = flush(ctx); err != nil {
				return err
			}
		case <-heartbeat.C:
			claimed, e := a.consoleLogLease(ctx, num(server["id"]), owner)
			if e != nil {
				return e
			}
			if !claimed {
				return fmt.Errorf("console capture lease lost")
			}
			if err = conn.WriteControl(websocket.PingMessage, nil, time.Now().Add(5*time.Second)); err != nil {
				return err
			}
		case m := <-incoming:
			if m.readError != nil {
				return m.readError
			}
			text := ""
			if len(m.Args) > 0 {
				_ = json.Unmarshal(m.Args[0], &text)
			}
			switch m.Event {
			case "auth success":
				if !authenticated {
					authenticated = true
					authDeadline.Stop()
					if _, err = a.DB.Exec(ctx, "UPDATE console_log_collectors SET connected=true WHERE server_id=$1 AND lease_owner=$2", server["id"], owner); err != nil {
						return err
					}
					// Seed an empty archive from Wings' retained tail. Reconnects to an
					// existing archive must not repeatedly append the same old output.
					var hasOutput bool
					if err = a.DB.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM console_log_entries WHERE server_id=$1 AND event='console output')", server["id"]).Scan(&hasOutput); err != nil {
						return err
					}
					if !hasOutput {
						_ = conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
						if err = conn.WriteJSON(M{"event": "send logs", "args": []string{}}); err != nil {
							return err
						}
					}
				}
			case "token expiring", "token expired":
				if err = sendAuth(); err != nil {
					return err
				}
			case "jwt error":
				return fmt.Errorf("console capture authentication rejected")
			case "console output", "daemon message", "install output":
				if authenticated {
					attach(false)
					add(m.Event, text)
				}
			case "status":
				if authenticated {
					attach(text == "offline" && state == "offline")
				}
				if authenticated && text != state {
					color, message := "94", ""
					switch text {
					case "starting":
						message = "Server is starting. Preparing the container and launching the process."
					case "running":
						color, message = "92", "Server entered the running state."
					case "stopping":
						color, message = "93", "Server is stopping. Waiting for the process to exit."
					case "offline":
						color, message = "93", "Server is now offline. The process exited or was stopped."
						if state == "stopping" {
							color, message = "92", "Server stopped. The container is offline."
						}
						if state == "starting" {
							color, message = "91", "Server went offline during startup. Check the output above."
						}
					}
					if message != "" {
						if state == "" {
							color, message = "94", "Current server state: "+text+"."
						}
						add("panel message", "\x1b[0m\x1b["+color+"m[Voltra]: "+message+"\x1b[0m")
						state = text
						capture.serverState = text
					}
				}
			}
			if len(batch) >= 128 || batchBytes >= 256<<10 {
				if err = flush(ctx); err != nil {
					return err
				}
			}
		}
	}
}
