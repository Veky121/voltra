package panel

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"voltra/internal/steamapi"
)

func (a *App) registerSteam(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/client/servers/{server}/steam", a.clientSteamStatus)
	mux.HandleFunc("PATCH /api/client/servers/{server}/steam", a.clientSteamSettings)
	mux.HandleFunc("POST /api/client/servers/{server}/steam/{operation}", a.clientSteamOperation)
}

func clientGameID(egg M) string {
	if game := steamGameID(egg); game != "" {
		return game
	}
	if javaMinecraftEgg(egg) {
		return "minecraft"
	}
	return ""
}

func (a *App) steamNodeAvailable(ctx context.Context, nodeID int64, appIDs ...int64) bool {
	h := a.connectors()
	h.mu.Lock()
	defer h.mu.Unlock()
	c := h.controls[nodeID]
	if c == nil || !c.capabilities[steamapi.Capability] {
		return false
	}
	if len(appIDs) == 0 {
		return true
	}
	profile, ok := steamapi.Profile(appIDs[0])
	if !ok {
		return false
	}
	return c.capabilities[steamapi.AppCapability(appIDs[0])] || (!c.capabilities[steamapi.ProfileCapability] && profile.LegacyV1)
}

func (a *App) configureSteamServer(ctx context.Context, serverID int64, game string, appID int64, branch string) error {
	if branch == "" {
		branch = "public"
	}
	spec, supported := steamGameSpecFor(game)
	if !supported || appID != spec.AppID {
		return bad("Choose a supported Steam game.")
	}
	_, err := a.DB.Exec(ctx, `INSERT INTO steam_servers(server_id,game,app_id,branch) VALUES($1,$2,$3,$4) ON CONFLICT(server_id) DO NOTHING`, serverID, game, appID, branch)
	return err
}

func steamJobPublic(job M) M {
	out := M{}
	for _, key := range []string{"id", "operation", "status", "stage", "detail", "error", "created_at", "started_at", "completed_at", "files_changed", "restart"} {
		out[key] = job[key]
	}
	if str(out["operation"]) == "start" {
		out["operation"] = "start"
	}
	return out
}

func (a *App) clientSteamStatus(w http.ResponseWriter, r *http.Request) {
	server, err := a.server(r, "startup.read")
	if err != nil {
		fail(w, err)
		return
	}
	state, err := a.one(r.Context(), "SELECT * FROM steam_servers WHERE server_id=$1", server["id"])
	if errors.Is(err, pgx.ErrNoRows) {
		writeJSON(w, 200, item("steam_status", M{"supported": false}))
		return
	}
	if err != nil {
		fail(w, err)
		return
	}
	jobs, err := a.query(r.Context(), "SELECT * FROM steam_jobs WHERE server_id=$1 ORDER BY created_at DESC LIMIT 12", server["id"])
	if err != nil {
		fail(w, err)
		return
	}
	out := M{"supported": true, "node_available": a.steamNodeAvailable(r.Context(), num(server["node_id"]), num(state["app_id"])), "jobs": []M{}}
	for _, key := range []string{"game", "app_id", "branch", "mode", "check_interval_seconds", "last_checked_at", "last_attempt_at", "last_failed_at", "last_error", "installed_build", "latest_build", "update_available", "needs_repair", "validate_on_start"} {
		out[key] = state[key]
	}
	out["beta_password_configured"] = str(state["beta_password_encrypted"]) != ""
	out["console_password_configured"] = str(state["console_password_encrypted"]) != ""
	public := []M{}
	for _, job := range jobs {
		j := steamJobPublic(job)
		logs, logErr := a.query(r.Context(), "SELECT stage,detail,created_at FROM (SELECT id,stage,detail,created_at FROM steam_job_events WHERE job_id=$1 ORDER BY id DESC LIMIT 50) e ORDER BY id", job["id"])
		if logErr != nil {
			fail(w, logErr)
			return
		}
		if logs == nil {
			logs = []M{}
		}
		j["logs"] = logs
		public = append(public, j)
		if str(job["status"]) == "queued" || str(job["status"]) == "running" {
			out["current_job"] = j
		}
	}
	out["jobs"] = public
	writeJSON(w, 200, item("steam_status", out))
}

func (a *App) clientSteamSettings(w http.ResponseWriter, r *http.Request) {
	server, err := a.server(r, "startup.update")
	if err != nil {
		fail(w, err)
		return
	}
	input, err := decodeRaw(r)
	if err != nil {
		fail(w, err)
		return
	}
	for k := range input {
		if k != "mode" && k != "check_interval_seconds" && k != "environment" && k != "branch" && k != "beta_password" && k != "validate_on_start" {
			fail(w, bad("Unsupported Steam setting."))
			return
		}
	}
	state, err := a.one(r.Context(), "SELECT * FROM steam_servers WHERE server_id=$1", server["id"])
	if err != nil {
		fail(w, err)
		return
	}
	mode := str(state["mode"])
	interval := num(state["check_interval_seconds"])
	if v, ok := input["mode"]; ok {
		mode = trimInput(str(v))
	}
	if mode != "on_start" && mode != "scheduled" && mode != "off" {
		fail(w, bad("Choose on_start, scheduled or off."))
		return
	}
	if v, ok := input["check_interval_seconds"]; ok {
		var valid bool
		interval, valid = applicationInteger(v)
		if !valid || interval < 300 || interval > 86400 {
			fail(w, bad("Choose a check interval between 5 minutes and 24 hours."))
			return
		}
	}
	controls := M{}
	if value, present := input["environment"]; present {
		environment, ok := value.(map[string]any)
		if !ok {
			fail(w, bad("Steam environment must be an object."))
			return
		}
		for key, value := range environment {
			controls[key] = value
		}
	}
	for alias, key := range map[string]string{"branch": "SRCDS_BETAID", "beta_password": "SRCDS_BETAPASS", "validate_on_start": "VALIDATE"} {
		if value, present := input[alias]; present {
			if _, duplicate := controls[key]; duplicate {
				fail(w, bad("Provide each Steam control only once."))
				return
			}
			controls[key] = value
		}
	}
	if len(controls) > 0 {
		settings := M{"check_interval_seconds": interval}
		if _, present := input["mode"]; present {
			settings["mode"] = mode
		}
		handled, updateErr := a.steamCatalogUpdateControls(r.Context(), server, controls, settings)
		if updateErr != nil {
			fail(w, updateErr)
			return
		}
		if !handled {
			fail(w, bad("Advanced Steam controls are not supported for this game."))
			return
		}
		// AUTO_UPDATE may have changed the mode inside the same transaction.
		updated, readErr := a.one(r.Context(), "SELECT mode FROM steam_servers WHERE server_id=$1", server["id"])
		if readErr != nil {
			fail(w, readErr)
			return
		}
		mode = str(updated["mode"])
	} else {
		err = a.exec(r.Context(), "UPDATE steam_servers SET mode=$2,check_interval_seconds=$3,updated_at=now() WHERE server_id=$1", server["id"], mode, interval)
	}
	if err != nil {
		fail(w, err)
		return
	}
	a.opAudit(r, server, "server:steam.settings", M{"mode": mode, "check_interval_seconds": interval})
	writeJSON(w, 200, item("steam_settings", M{"mode": mode, "check_interval_seconds": interval}))
}

func (a *App) clientSteamOperation(w http.ResponseWriter, r *http.Request) {
	operation := r.PathValue("operation")
	if operation != "check" && operation != "update" && operation != "verify" {
		fail(w, notFound())
		return
	}
	server, err := a.server(r, "startup.update")
	if err != nil {
		fail(w, err)
		return
	}
	input, err := decode(r)
	if err != nil {
		fail(w, err)
		return
	}
	if len(input) != 0 {
		fail(w, bad("This operation takes no additional parameters."))
		return
	}
	job, err := a.queueSteamJob(r.Context(), server, operation, false, true)
	if err != nil {
		fail(w, err)
		return
	}
	a.opAudit(r, server, "server:steam."+operation, M{"job_id": job["id"]})
	writeJSON(w, 202, item("steam_job", steamJobPublic(job)))
}

// Successful checks and failed attempts have independent persistent cooldowns.
func steamCheckDue(state M, at time.Time) bool {
	if state["last_failed_at"] != nil {
		failed := steamTime(state["last_failed_at"])
		checked := steamTime(state["last_checked_at"])
		if failed.After(checked) && at.Sub(failed) < 5*time.Minute {
			return false
		}
	}
	checked := steamTime(state["last_checked_at"])
	interval := time.Duration(num(state["check_interval_seconds"])) * time.Second
	if interval < 5*time.Minute {
		interval = time.Hour
	}
	return checked.IsZero() || !at.Before(checked.Add(interval))
}
func steamTime(v any) time.Time {
	if t, ok := v.(time.Time); ok {
		return t
	}
	t, _ := time.Parse(time.RFC3339Nano, str(v))
	return t
}

func (a *App) steamServerState(ctx context.Context, server M) (string, error) {
	response, err := a.daemonServerRaw(ctx, server, "GET", "", nil)
	if err != nil {
		return "", err
	}
	defer response.Body.Close()
	var data M
	if err = json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&data); err != nil {
		return "", err
	}
	state := str(data["state"])
	if state == "" {
		state = str(asMap(data["attributes"])["state"])
	}
	if state != "offline" && state != "running" && state != "starting" && state != "stopping" {
		return "", errors.New("Wings did not report a recognized server state")
	}
	return state, nil
}

func (a *App) queueSteamJob(ctx context.Context, server M, operation string, startAfter, force bool) (M, error) {
	return a.queueSteamJobWithRestart(ctx, server, operation, startAfter, force, false)
}
func (a *App) queueSteamJobWithRestart(ctx context.Context, server M, operation string, startAfter, force, restart bool) (M, error) {
	return a.queueSteamJobPolicy(ctx, server, operation, startAfter, force, restart, false)
}

func (a *App) queueSteamJobPolicy(ctx context.Context, server M, operation string, startAfter, force, restart, reinstall bool) (M, error) {
	if !a.steamNodeAvailable(ctx, num(server["node_id"])) {
		return nil, APIError{409, "SteamNodeUnavailable", "Update and reconnect the node agent to enable Steam maintenance."}
	}
	tx, err := a.DB.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	var id int64
	if err = tx.QueryRow(ctx, "SELECT id FROM servers WHERE id=$1 FOR UPDATE", server["id"]).Scan(&id); err != nil {
		return nil, err
	}
	if reinstall {
		current, e := queryRowMap(tx.QueryRow(ctx, "SELECT row_to_json(s) FROM servers s WHERE id=$1", id))
		if e != nil {
			return nil, e
		}
		if status := str(current["status"]); status != "" && status != "reinstall_failed" || strings.HasPrefix(str(current["installation_id"]), "pending:") {
			return nil, APIError{409, "ServerStateConflict", "Finish the current server operation before reinstalling."}
		}
		var transferring bool
		if e = tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM server_transfers WHERE server_id=$1 AND successful IS NULL)", id).Scan(&transferring); e != nil {
			return nil, e
		}
		if transferring {
			return nil, APIError{409, "ServerStateConflict", "Finish the server transfer before reinstalling."}
		}
		server = current
	}
	var repair bool
	var appID int64
	if err = tx.QueryRow(ctx, "SELECT needs_repair,app_id FROM steam_servers WHERE server_id=$1 FOR UPDATE", id).Scan(&repair, &appID); err != nil {
		return nil, err
	}
	if !a.steamNodeAvailable(ctx, num(server["node_id"]), appID) {
		return nil, APIError{409, "SteamGameUnsupported", "Update the node agent to enable maintenance for this game."}
	}
	if reinstall {
		current, e := a.steamServerState(ctx, server)
		if e != nil {
			return nil, e
		}
		if current != "offline" {
			return nil, APIError{409, "SteamServerRunning", "Stop the server before reinstalling files."}
		}
	}
	active, err := queryRowMap(tx.QueryRow(ctx, "SELECT row_to_json(j) FROM steam_jobs j WHERE server_id=$1 AND status IN ('queued','running')", id))
	if err == nil {
		if reinstall && (str(active["operation"]) != "install" || !boolean(active["force"]) || boolean(active["start_after"]) || boolean(active["restart"])) {
			return nil, APIError{409, "SteamJobActive", "A different Steam maintenance job is already in progress."}
		}
		if operation != str(active["operation"]) && operation != "start" {
			return nil, APIError{409, "SteamJobActive", "A Steam maintenance job is already in progress."}
		}
		if startAfter {
			if _, err = tx.Exec(ctx, "UPDATE steam_jobs SET start_after=true,restart=restart OR $2,updated_at=now() WHERE id=$1", active["id"], restart); err != nil {
				return nil, err
			}
			active["start_after"] = true
		}
		return active, tx.Commit(ctx)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}
	if operation == "start" && repair {
		return nil, APIError{409, "SteamRepairRequired", "Verify and repair files before starting this server."}
	}
	if operation == "update" || operation == "verify" {
		state, e := a.steamServerState(ctx, server)
		if e != nil {
			return nil, e
		}
		if state != "offline" {
			return nil, APIError{409, "SteamServerRunning", "Stop the server before updating or verifying files."}
		}
	}
	jobID := newUUID()
	job, err := queryRowMap(tx.QueryRow(ctx, `INSERT INTO steam_jobs(id,server_id,operation,start_after,force,restart) VALUES($1,$2,$3,$4,$5,$6) RETURNING row_to_json(steam_jobs)`, jobID, id, operation, startAfter, force, restart))
	if err != nil {
		return nil, err
	}
	return job, tx.Commit(ctx)
}

func queryRowMap(row pgx.Row) (M, error) { var m M; err := row.Scan(&m); return m, err }

func (a *App) managedServerPower(ctx context.Context, server M, action string) (*http.Response, error) {
	state, err := a.one(ctx, "SELECT * FROM steam_servers WHERE server_id=$1", server["id"])
	if errors.Is(err, pgx.ErrNoRows) {
		return a.unmanagedServerPower(ctx, server, action)
	}
	if err != nil {
		return nil, err
	}
	if action == "stop" || action == "kill" {
		tx, e := a.DB.Begin(ctx)
		if e != nil {
			return nil, e
		}
		defer tx.Rollback(ctx)
		var id int64
		if e = tx.QueryRow(ctx, "SELECT id FROM servers WHERE id=$1 FOR UPDATE", server["id"]).Scan(&id); e != nil {
			return nil, e
		}
		if _, e = tx.Exec(ctx, `UPDATE steam_jobs SET start_after=false,status=CASE WHEN status='queued' AND operation='start' THEN 'cancelled' ELSE status END,updated_at=now() WHERE server_id=$1 AND status IN ('queued','running')`, id); e != nil {
			return nil, e
		}
		response, e := a.daemonServerRaw(ctx, server, "POST", "/power", M{"action": action})
		if e != nil {
			return nil, e
		}
		if e = tx.Commit(ctx); e != nil {
			response.Body.Close()
			return nil, e
		}
		return response, nil
	}
	if action != "start" && action != "restart" {
		return nil, bad("Unsupported power action.")
	}
	// Even when automatic updates are off, queue startup so it cannot race maintenance.
	_ = state
	_, err = a.queueSteamJobWithRestart(ctx, server, "start", true, false, action == "restart")
	if err != nil {
		return nil, err
	}
	return &http.Response{StatusCode: 204, Body: io.NopCloser(strings.NewReader("")), Header: make(http.Header)}, nil
}

// Quick setup is also available to Minecraft, whose normal power path must use
// the same mutation lock even though it has no Steam maintenance configuration.
func (a *App) unmanagedServerPower(ctx context.Context, server M, action string) (*http.Response, error) {
	if action != "start" && action != "restart" {
		return a.daemonServerRaw(ctx, server, "POST", "/power", M{"action": action})
	}
	tx, err := a.DB.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "voltra:server-mutation:"+str(server["uuid"])); err != nil {
		return nil, err
	}
	response, err := a.daemonServerRaw(ctx, server, "POST", "/power", M{"action": action})
	if err != nil {
		return nil, err
	}
	if err = tx.Commit(ctx); err != nil {
		response.Body.Close()
		return nil, err
	}
	return response, nil
}

func (a *App) steamSocketPower(ctx context.Context, user, server M, raw []byte) (bool, error) {
	var message struct {
		Event string   `json:"event"`
		Args  []string `json:"args"`
	}
	if json.Unmarshal(raw, &message) != nil || message.Event != "set state" {
		return false, nil
	}
	var managed bool
	if err := a.DB.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM steam_servers WHERE server_id=$1)", server["id"]).Scan(&managed); err != nil {
		return true, err
	}
	if !managed {
		return false, nil
	}
	if len(message.Args) != 1 {
		return true, bad("A single power action is required.")
	}
	action := message.Args[0]
	permission := "control." + action
	if action == "kill" {
		permission = "control.stop"
	}
	if action != "start" && action != "stop" && action != "restart" && action != "kill" {
		return true, bad("Unsupported power action.")
	}
	if !a.can(ctx, user, server, permission) {
		return true, forbidden()
	}
	// Recheck stale WebSocket sessions against current suspension, transfer and maintenance.
	fresh, err := a.one(ctx, `SELECT s.*,n.maintenance_mode FROM servers s JOIN nodes n ON n.id=s.node_id WHERE s.id=$1`, server["id"])
	if err != nil {
		return true, err
	}
	if str(fresh["status"]) != "" || boolean(fresh["maintenance_mode"]) {
		return true, APIError{409, "ServerStateConflict", "The server is unavailable during installation, maintenance or suspension."}
	}
	response, err := a.managedServerPower(ctx, fresh, action)
	if response != nil {
		response.Body.Close()
	}
	if err == nil {
		_ = a.audit(ctx, num(user["id"]), num(server["id"]), "server:power."+action, M{"transport": "websocket"})
	}
	return true, err
}

// RunSteamJobs has a bounded number of workers; leases recover after Panel failure.
func (a *App) RunSteamJobs(ctx context.Context) {
	for range 4 {
		go a.steamWorker(ctx)
	}
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	for {
		a.steamSchedule(ctx)
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}
func (a *App) steamWorker(ctx context.Context) {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		if ctx.Err() != nil {
			return
		}
		if !a.processSteamJob(ctx) {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
		}
	}
}

func (a *App) steamSchedule(ctx context.Context) {
	states, err := a.query(ctx, `SELECT st.*,s.node_id FROM steam_servers st JOIN servers s ON s.id=st.server_id WHERE st.mode='scheduled' AND st.initialized AND NOT st.needs_repair AND s.status IS NULL AND NOT EXISTS(SELECT 1 FROM steam_jobs j WHERE j.server_id=s.id AND j.status IN ('queued','running'))`)
	if err != nil {
		return
	}
	for _, state := range states {
		if !steamCheckDue(state, time.Now()) || !a.steamNodeAvailable(ctx, num(state["node_id"]), num(state["app_id"])) {
			continue
		}
		server, e := a.one(ctx, "SELECT * FROM servers WHERE id=$1", state["server_id"])
		if e != nil {
			continue
		}
		// A scheduled check never stops a running game. Offline updates are selected by the worker.
		_, _ = a.queueSteamJob(ctx, server, "check", false, false)
	}
}

func (a *App) processSteamJob(ctx context.Context) bool {
	token := newUUID()
	job, err := a.claimSteamJob(ctx, token)
	if err != nil {
		return false
	}
	// A prior mutation may have changed files before losing its ACK. Never assume it succeeded.
	if str(job["stage"]) == "installing" || str(job["stage"]) == "updating" || str(job["stage"]) == "verifying" || boolean(job["files_changed"]) {
		_ = a.exec(ctx, "UPDATE steam_servers SET needs_repair=true WHERE server_id=$1", job["server_id"])
		a.finishSteamJob(ctx, job, token, errors.New("Maintenance was interrupted. Verify and repair files before starting."))
		return true
	}
	workCtx, cancel := context.WithTimeout(ctx, 3*time.Hour)
	defer cancel()
	done := make(chan struct{})
	defer close(done)
	go func() {
		ticker := time.NewTicker(20 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-done:
				return
			case <-workCtx.Done():
				return
			case <-ticker.C:
				tag, e := a.DB.Exec(workCtx, "UPDATE steam_jobs SET lease_until=now()+interval '90 seconds' WHERE id=$1 AND lease_token=$2 AND status='running'", job["id"], token)
				if e != nil || tag.RowsAffected() != 1 {
					cancel()
					return
				}
			}
		}
	}()
	err = a.runSteamJob(workCtx, job, token)
	finishCtx, finishCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer finishCancel()
	a.finishSteamJob(finishCtx, job, token, err)
	return true
}

func (a *App) claimSteamJob(ctx context.Context, token string) (M, error) {
	tx, err := a.DB.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	var job M
	var nodeID int64
	err = tx.QueryRow(ctx, `SELECT row_to_json(j),s.node_id FROM steam_jobs j JOIN servers s ON s.id=j.server_id
 WHERE (j.status='queued' OR (j.status='running' AND j.lease_until<now()))
 AND (SELECT count(*) FROM steam_jobs active JOIN servers owner ON owner.id=active.server_id WHERE owner.node_id=s.node_id AND active.status='running' AND active.lease_until>now())<2
 ORDER BY j.created_at FOR UPDATE OF j SKIP LOCKED LIMIT 1`).Scan(&job, &nodeID)
	if err != nil {
		return nil, err
	}
	// Match the node executor's two maintenance slots. Serialize only the brief
	// claim, rather than failing simultaneous installations with capacity errors.
	var locked bool
	if err = tx.QueryRow(ctx, "SELECT pg_try_advisory_xact_lock(hashtextextended($1,0))", fmt.Sprintf("voltra:steam-claim:%d", nodeID)).Scan(&locked); err != nil {
		return nil, err
	}
	if !locked {
		return nil, pgx.ErrNoRows
	}
	var active int
	if err = tx.QueryRow(ctx, `SELECT count(*) FROM steam_jobs j JOIN servers s ON s.id=j.server_id WHERE s.node_id=$1 AND j.status='running' AND j.lease_until>now()`, nodeID).Scan(&active); err != nil {
		return nil, err
	}
	if active >= 2 {
		return nil, pgx.ErrNoRows
	}
	job, err = queryRowMap(tx.QueryRow(ctx, `UPDATE steam_jobs SET status='running',lease_token=$2,lease_until=now()+interval '90 seconds',started_at=COALESCE(started_at,now()),updated_at=now() WHERE id=$1 RETURNING row_to_json(steam_jobs)`, job["id"], token))
	if err != nil {
		return nil, err
	}
	return job, tx.Commit(ctx)
}

func (a *App) steamProgress(ctx context.Context, job M, token, stage, detail string, changed bool) error {
	tag, err := a.DB.Exec(ctx, "UPDATE steam_jobs SET stage=$3,detail=$4,files_changed=files_changed OR $5,updated_at=now() WHERE id=$1 AND lease_token=$2 AND status='running'", job["id"], token, stage, detail, changed)
	if err == nil && tag.RowsAffected() != 1 {
		return errors.New("maintenance lease was lost")
	}
	if err == nil {
		a.steamLog(ctx, str(job["id"]), stage, detail)
	}
	return err
}

func (a *App) steamLog(ctx context.Context, jobID, stage, detail string) {
	// Repeated heartbeats are not separate log entries. Keep a bounded useful history.
	_, _ = a.DB.Exec(ctx, `INSERT INTO steam_job_events(job_id,stage,detail) SELECT $1,$2,$3 WHERE NOT EXISTS(SELECT 1 FROM (SELECT stage,detail FROM steam_job_events WHERE job_id=$1 ORDER BY id DESC LIMIT 1) e WHERE e.stage=$2 AND e.detail=$3)`, jobID, stage, detail)
	_, _ = a.DB.Exec(ctx, `DELETE FROM steam_job_events WHERE job_id=$1 AND id NOT IN (SELECT id FROM steam_job_events WHERE job_id=$1 ORDER BY id DESC LIMIT 200)`, jobID)
}

func (a *App) runSteamJob(ctx context.Context, job M, token string) error {
	server, err := a.one(ctx, "SELECT * FROM servers WHERE id=$1", job["server_id"])
	if err != nil {
		return err
	}
	state, err := a.one(ctx, "SELECT * FROM steam_servers WHERE server_id=$1", server["id"])
	if err != nil {
		return err
	}
	if boolean(server["suspended"]) || str(server["status"]) == "suspended" {
		return errors.New("The server is suspended.")
	}
	operation := str(job["operation"])
	if operation == "install" {
		if err = a.steamProgress(ctx, job, token, "preparing", "Preparing the server directory.", false); err != nil {
			return err
		}
		deadline := time.NewTimer(3 * time.Minute)
		defer deadline.Stop()
		for !serverInstalled(server) {
			if str(server["status"]) == "install_failed" {
				return errors.New("Wings could not prepare the server directory. Retry installation after checking the node.")
			}
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-deadline.C:
				return errors.New("Wings did not finish preparing the server directory.")
			case <-time.After(time.Second):
			}
			server, err = a.one(ctx, "SELECT * FROM servers WHERE id=$1", server["id"])
			if err != nil {
				return err
			}
		}
	}
	current, err := a.steamServerState(ctx, server)
	if err != nil {
		return err
	}
	if operation == "start" {
		latest, e := a.one(ctx, "SELECT * FROM steam_jobs WHERE id=$1", job["id"])
		if e != nil {
			return e
		}
		job["restart"] = latest["restart"]
		if current != "offline" {
			if !boolean(job["restart"]) {
				return nil
			}
			if err = a.steamProgress(ctx, job, token, "stopping", "Stopping the server before restart.", false); err != nil {
				return err
			}
			response, e := a.daemonServerRaw(ctx, server, "POST", "/power", M{"action": "stop"})
			if e != nil {
				return e
			}
			response.Body.Close()
			for i := 0; i < 120; i++ {
				current, err = a.steamServerState(ctx, server)
				if err != nil {
					return err
				}
				if current == "offline" {
					break
				}
				select {
				case <-ctx.Done():
					return ctx.Err()
				case <-time.After(time.Second):
				}
			}
			if current != "offline" {
				return errors.New("The server did not stop. Steam files were not changed.")
			}
		}
		if boolean(state["needs_repair"]) {
			return errors.New("Verify and repair files before starting this server.")
		}
	}
	validatedBeforeStart := false
	shouldCheck := operation == "check" || operation == "start" && str(state["mode"]) != "off" && steamCheckDue(state, time.Now())
	if shouldCheck {
		result, e := a.executeSteam(ctx, server, state, job, token, "check")
		if e != nil {
			_ = a.exec(ctx, "UPDATE steam_servers SET last_failed_at=now(),last_error=$2 WHERE server_id=$1", server["id"], e.Error())
			if operation != "start" {
				return e
			}
			if err = a.steamProgress(ctx, job, token, "starting", "Steam check failed; starting the installed version.", false); err != nil {
				return err
			}
		} else {
			if err = a.recordSteamResult(ctx, server, result); err != nil {
				return err
			}
			// Scheduled mode can update an already stopped server; checking never stops players.
			if result.UpdateAvailable && (operation == "start" || !boolean(job["force"]) && str(state["mode"]) == "scheduled" && current == "offline") {
				if _, err = a.executeSteamMutation(ctx, server, state, job, token, "update"); err != nil {
					return err
				}
				validatedBeforeStart = operation == "start" && boolean(state["validate_on_start"])
			}
		}
	}
	// Explicit automatic-start validation also applies when metadata is current or cached.
	if operation == "start" && boolean(state["validate_on_start"]) && (str(state["mode"]) == "on_start" || str(state["mode"]) == "scheduled") && !validatedBeforeStart {
		if _, err = a.executeSteamMutation(ctx, server, state, job, token, "verify"); err != nil {
			return err
		}
	}
	if operation == "install" || operation == "update" || operation == "verify" {
		if current != "offline" {
			return errors.New("Stop the server before modifying Steam files.")
		}
		if _, err = a.executeSteamMutation(ctx, server, state, job, token, operation); err != nil {
			return err
		}
	}
	// Prepare native settings once, after installation, before allowing the first start.
	state, err = a.one(ctx, "SELECT * FROM steam_servers WHERE server_id=$1", server["id"])
	if err != nil {
		return err
	}
	if operation != "check" && !boolean(state["initialized"]) && !boolean(state["needs_repair"]) {
		if err = a.steamGameAfterInstall(ctx, server); err != nil {
			return err
		}
		if err = a.exec(ctx, "UPDATE steam_servers SET initialized=true WHERE server_id=$1", server["id"]); err != nil {
			return err
		}
	}
	if operation == "install" && str(server["status"]) == "reinstall_failed" {
		if err = a.exec(ctx, "UPDATE servers SET status=NULL,updated_at=now() WHERE id=$1 AND status='reinstall_failed' AND installation_id IS NOT DISTINCT FROM $2", server["id"], server["installation_id"]); err != nil {
			return err
		}
	}
	return a.steamStartAfter(ctx, server, job, token)
}

func (a *App) executeSteamMutation(ctx context.Context, server, state, job M, token, operation string) (steamapi.Event, error) {
	// The same advisory key protects Quick setup writes and the final power start.
	connection, err := a.DB.Acquire(ctx)
	if err != nil {
		return steamapi.Event{}, err
	}
	defer connection.Release()
	lockKey := "voltra:server-mutation:" + str(server["uuid"])
	if _, err = connection.Exec(ctx, "SELECT pg_advisory_lock(hashtextextended($1,0))", lockKey); err != nil {
		return steamapi.Event{}, err
	}
	defer func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_, _ = connection.Exec(cleanup, "SELECT pg_advisory_unlock(hashtextextended($1,0))", lockKey)
	}()
	current, err := a.steamServerState(ctx, server)
	if err != nil {
		return steamapi.Event{}, err
	}
	if current != "offline" {
		return steamapi.Event{}, errors.New("Stop the server before modifying Steam files.")
	}
	if err := a.exec(ctx, "UPDATE steam_servers SET needs_repair=true WHERE server_id=$1", server["id"]); err != nil {
		return steamapi.Event{}, err
	}
	result, err := a.executeSteam(ctx, server, state, job, token, operation)
	if err != nil {
		// An authenticated terminal error can prove that no files changed. A
		// disconnect or lost result cannot, so those retain the repair guard.
		if result.Type == "error" && !result.FilesChanged && !boolean(state["needs_repair"]) {
			_ = a.exec(ctx, "UPDATE steam_servers SET needs_repair=false WHERE server_id=$1", server["id"])
		}
		return result, err
	}
	if err = a.recordSteamResult(ctx, server, result); err != nil {
		return result, err
	}
	err = a.exec(ctx, "UPDATE steam_servers SET needs_repair=false,last_error='' WHERE server_id=$1", server["id"])
	return result, err
}

func (a *App) recordSteamResult(ctx context.Context, server M, result steamapi.Event) error {
	// Every successful executor operation fetches and verifies branch metadata,
	// so installation/repair also starts the normal successful-check cooldown.
	return a.exec(ctx, `UPDATE steam_servers SET installed_build=$2,latest_build=$3,update_available=$4,last_checked_at=now(),last_error='',updated_at=now() WHERE server_id=$1`, server["id"], result.InstalledBuild, result.LatestBuild, result.UpdateAvailable)
}

func (a *App) executeSteam(ctx context.Context, server, state, job M, token, operation string) (steamapi.Event, error) {
	request := steamapi.Request{JobID: str(job["id"]), Operation: operation, ServerUUID: str(server["uuid"]), AppID: num(state["app_id"]), Branch: str(state["branch"]), Validate: operation != "check" && boolean(state["validate_on_start"])}
	if cipher := str(state["beta_password_encrypted"]); cipher != "" {
		secret, err := a.unseal(cipher)
		if err != nil {
			return steamapi.Event{Type: "error"}, errors.New("The private branch credential could not be unlocked.")
		}
		request.BetaPassword = secret
	}
	if request.Validate && !a.steamCatalogOptionsAvailable(num(server["node_id"])) || request.BetaPassword != "" && !a.steamCatalogPrivateBranchAvailable(num(server["node_id"])) {
		return steamapi.Event{Type: "error"}, APIError{409, "SteamNodeUpgradeRequired", "Upgrade and reconnect the node to use validation or private branch credentials."}
	}
	stage := map[string]string{"check": "checking", "install": "installing", "update": "updating", "verify": "verifying"}[operation]
	mutation := operation != "check"
	if err := a.steamProgress(ctx, job, token, stage, map[string]string{"check": "Checking Steam for updates.", "install": "Installing game files.", "update": "Updating game files.", "verify": "Verifying and repairing game files."}[operation], mutation); err != nil {
		return steamapi.Event{}, err
	}
	_ = a.exec(ctx, "UPDATE steam_servers SET last_attempt_at=now() WHERE server_id=$1", server["id"])
	encoded, err := json.Marshal(request)
	if err != nil {
		return steamapi.Event{}, err
	}
	transport := &http.Transport{DialContext: func(ctx context.Context, network, address string) (net.Conn, error) {
		return a.dialNodeService(ctx, num(server["node_id"]), "steam")
	}, DisableKeepAlives: true, ResponseHeaderTimeout: 30 * time.Second}
	defer transport.CloseIdleConnections()
	req, err := http.NewRequestWithContext(ctx, "POST", "http://node-steam/run", bytes.NewReader(encoded))
	if err != nil {
		return steamapi.Event{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	response, err := (&http.Client{Transport: transport}).Do(req)
	if err != nil {
		return steamapi.Event{}, errors.New("The node's Steam connection was interrupted. Check the node and retry.")
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		return steamapi.Event{}, fmt.Errorf("The node could not start Steam maintenance (HTTP %d).", response.StatusCode)
	}
	scanner := bufio.NewScanner(response.Body)
	scanner.Buffer(make([]byte, 4096), 64*1024)
	for scanner.Scan() {
		var event steamapi.Event
		if err = json.Unmarshal(scanner.Bytes(), &event); err != nil {
			return event, errors.New("The node returned invalid Steam job data.")
		}
		switch event.Type {
		case "result":
			latest, e := strconv.ParseUint(event.LatestBuild, 10, 64)
			if e != nil || latest == 0 {
				return event, errors.New("The node returned invalid Steam branch build metadata.")
			}
			if event.InstalledBuild != "" {
				installed, e := strconv.ParseUint(event.InstalledBuild, 10, 64)
				if e != nil || installed == 0 {
					return event, errors.New("The node returned invalid installed Steam build metadata.")
				}
			}
			if event.UpdateAvailable != (event.InstalledBuild != event.LatestBuild) || mutation && (event.InstalledBuild == "" || event.UpdateAvailable) {
				return event, errors.New("The node did not confirm a complete Steam installation.")
			}
			return event, nil
		case "error":
			// Node exposes fixed messages only, never raw command or credential output.
			detail := event.Error
			if detail == "" {
				detail = event.Detail
			}
			if detail == "" || len(detail) > 512 {
				detail = "Steam maintenance failed. Check node connectivity and available disk space."
			}
			return event, errors.New(detail)
		case "progress":
			detail := event.Detail
			if len(detail) > 512 {
				detail = detail[:512]
			}
			if err = a.steamProgress(ctx, job, token, stage, detail, mutation || event.FilesChanged); err != nil {
				return event, err
			}
		default:
			return event, errors.New("The node returned an unknown Steam job event.")
		}
	}
	return steamapi.Event{}, errors.New("Steam maintenance ended without a completion result. Check the node and retry.")
}

func (a *App) steamStartAfter(ctx context.Context, server, job M, token string) (err error) {
	connection, err := a.DB.Acquire(ctx)
	if err != nil {
		return err
	}
	key := "voltra:server-mutation:" + str(server["uuid"])
	defer steamPowerUnlock(connection, key)
	if err = steamSessionLock(ctx, connection, key); err != nil {
		return err
	}
	tx, err := connection.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = tx.Rollback(cleanup)
	}()
	server, err = queryRowMap(tx.QueryRow(ctx, "SELECT row_to_json(s) FROM servers s WHERE id=$1 FOR UPDATE", server["id"]))
	if err != nil {
		return err
	}
	var start, repair, initialized bool
	if err = tx.QueryRow(ctx, `SELECT j.start_after,st.needs_repair,st.initialized FROM steam_jobs j JOIN steam_servers st ON st.server_id=j.server_id WHERE j.id=$1 AND j.lease_token=$2 AND j.status='running'`, job["id"], token).Scan(&start, &repair, &initialized); err != nil {
		return err
	}
	if !start {
		return tx.Commit(ctx)
	}
	if repair || !initialized {
		return errors.New("Game files or initial settings need repair before starting.")
	}
	startup, err := a.steamSatisfactoryStartup(ctx, server)
	if err != nil {
		return err
	}
	changed := startup != str(server["startup"])
	if changed {
		if _, err = tx.Exec(ctx, "UPDATE servers SET startup=$2,updated_at=now() WHERE id=$1", server["id"], startup); err != nil {
			return err
		}
	}
	if _, err = tx.Exec(ctx, "UPDATE steam_jobs SET stage='starting',detail='Starting the server.',updated_at=now() WHERE id=$1", job["id"]); err != nil {
		return err
	}
	// Wings /sync fetches configuration through another database connection.
	// Publish before syncing, while retaining the session mutation lock.
	defer func() {
		if err != nil && changed {
			cleanup, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			_ = tx.Rollback(cleanup)
			cancel()
			if restoreErr := a.steamRestoreStartup(server, startup); restoreErr != nil {
				cleanup, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				defer cancel()
				_ = a.exec(cleanup, "UPDATE steam_servers SET needs_repair=true WHERE server_id=$1", server["id"])
				err = errors.Join(err, restoreErr)
			}
		}
	}()
	if err = tx.Commit(ctx); err != nil {
		return err
	}
	if changed {
		if err = a.syncServer(ctx, server); err != nil {
			return err
		}
	}
	var allowed bool
	if err = connection.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM steam_jobs j JOIN steam_servers st ON st.server_id=j.server_id JOIN servers s ON s.id=j.server_id WHERE j.id=$1 AND j.lease_token=$2 AND j.status='running' AND j.lease_until>now() AND j.start_after AND NOT st.needs_repair AND st.initialized AND s.id=$3 AND s.node_id=$4 AND s.startup=$5 AND s.installation_id IS NOT DISTINCT FROM $6 AND COALESCE(s.status,'') NOT IN ('suspended','installing','install_failed','reinstall_failed') AND NOT EXISTS(SELECT 1 FROM server_transfers t WHERE t.server_id=s.id AND t.successful IS NULL))`, job["id"], token, server["id"], server["node_id"], startup, server["installation_id"]).Scan(&allowed); err != nil {
		return err
	}
	if !allowed {
		return errors.New("Server state or Steam job ownership changed before starting.")
	}
	// Wings reports offline before its asynchronous stop releases the power
	// lock. Queue this start on that supported lock instead of losing a restart.
	response, err := a.daemonServerRaw(ctx, server, "POST", "/power", M{"action": "start", "wait_seconds": 30})
	if err != nil {
		return err
	}
	response.Body.Close()
	return nil
}

func (a *App) finishSteamJob(ctx context.Context, job M, token string, err error) {
	status, stage, detail, errorText := "completed", "complete", "Steam maintenance completed.", ""
	if err != nil {
		status, stage, detail, errorText = "failed", "error", err.Error(), err.Error()
		if len(errorText) > 512 {
			errorText = "Steam maintenance failed."
			detail = errorText
		}
	}
	_, _ = a.DB.Exec(ctx, "UPDATE steam_jobs SET status=$3,stage=$4,detail=$5,error=$6,completed_at=now(),lease_until=NULL,updated_at=now() WHERE id=$1 AND lease_token=$2 AND status='running'", job["id"], token, status, stage, detail, errorText)
	a.steamLog(ctx, str(job["id"]), stage, detail)
}
