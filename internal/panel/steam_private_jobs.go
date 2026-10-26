package panel

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"io"
	"net"
	"net/http"
	"slices"
	"time"
	"voltra/internal/steamapi"
)

func (a *App) privateJobRow(ctx context.Context, id string) (M, error) {
	return a.one(ctx, `SELECT p.*,j.server_id,j.status AS job_status,j.lease_token,j.lease_until,j.lease_until>now() AS lease_valid,s.uuid AS current_server,s.node_id AS current_node,s.owner_id AS current_owner,s.egg_id AS current_egg,COALESCE(s.installation_id,'') AS current_installation,COALESCE(s.status,'') AS server_status,u.disabled AS actor_disabled,u.root_admin AS actor_admin,pf.generation AS current_generation,pf.revoked,n.maintenance_mode,EXISTS(SELECT 1 FROM server_transfers WHERE server_id=s.id AND successful IS NULL) AS transferring,CASE p.actor_auth_kind WHEN 'session' THEN EXISTS(SELECT 1 FROM browser_sessions bs WHERE bs.token_hash=p.actor_auth_id AND bs.user_id=p.actor_id AND bs.expires_at>now()) ELSE EXISTS(SELECT 1 FROM api_keys k WHERE k.id::text=p.actor_auth_id AND k.user_id=p.actor_id AND k.type='client' AND (k.expires_at IS NULL OR k.expires_at>now())) END AS auth_live FROM steam_private_jobs p JOIN steam_jobs j ON j.id=p.job_id JOIN servers s ON s.id=j.server_id JOIN users u ON u.id=p.actor_id JOIN nodes n ON n.id=s.node_id JOIN steam_private_authorizations pf ON pf.id=p.authorization_id WHERE p.job_id=$1`, id)
}
func (a *App) privateJobAllowed(ctx context.Context, row M, token string) error {
	if str(row["job_status"]) != "running" || str(row["lease_token"]) != token || !boolean(row["lease_valid"]) || boolean(row["cancel_requested"]) || boolean(row["actor_disabled"]) || !boolean(row["auth_live"]) || boolean(row["revoked"]) || str(row["authorization_generation"]) != str(row["current_generation"]) || num(row["node_id"]) != num(row["current_node"]) || num(row["server_owner_id"]) != num(row["current_owner"]) || num(row["egg_id"]) != num(row["current_egg"]) || str(row["installation_id"]) != str(row["current_installation"]) || str(row["server_status"]) != "" && str(row["server_status"]) != "reinstall_failed" || boolean(row["transferring"]) || boolean(row["maintenance_mode"]) {
		return errPrivateCancelled
	}
	actor := M{"id": row["actor_id"], "disabled": row["actor_disabled"], "root_admin": row["actor_admin"]}
	server := M{"id": row["server_id"], "owner_id": row["current_owner"]}
	if !a.can(ctx, actor, server, "startup.update") {
		return errPrivateCancelled
	}
	var request steamapi.PrivateRequest
	b, _ := json.Marshal(row["request"])
	if json.Unmarshal(b, &request) != nil || !a.privateReady(ctx, num(row["node_id"]), request.Selection.App) {
		return errPrivateCancelled
	}
	current, err := a.one(ctx, "SELECT * FROM servers WHERE id=$1", row["server_id"])
	if err != nil {
		return errPrivateCancelled
	}
	profile, _, err := privateContentProfile(ctx, a.DB, current)
	if err != nil || profile.AppID != request.Selection.App || profile.Platform != request.Selection.Platform || profile.Architecture != request.Selection.Architecture || !slices.Equal(profile.ProtectedPaths, request.Selection.Protected) {
		return errPrivateCancelled
	}
	return nil
}
func (a *App) privateWatch(ctx context.Context, row M, token string, cancel context.CancelFunc, done chan<- struct{}) {
	defer close(done)
	h := a.privateHub()
	h.mu.Lock()
	interval := h.poll
	h.mu.Unlock()
	if interval <= 0 {
		interval = time.Second
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	lastRenew := time.Now()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			check, stop := context.WithTimeout(ctx, 2*time.Second)
			latest, e := a.privateJobRow(check, str(row["job_id"]))
			if e == nil {
				e = a.privateJobAllowed(check, latest, token)
			}
			if e == nil && time.Since(lastRenew) >= 20*time.Second {
				var affected int64
				tag, err := a.DB.Exec(check, "UPDATE steam_jobs SET lease_until=now()+interval '90 seconds' WHERE id=$1 AND lease_token=$2 AND status='running' AND lease_until>now()", row["job_id"], token)
				if err == nil {
					affected = tag.RowsAffected()
				}
				if err != nil || affected != 1 {
					e = errPrivateCancelled
				} else {
					lastRenew = time.Now()
				}
			}
			stop()
			if e != nil {
				cancel()
				return
			}
		}
	}
}
func (a *App) privateJobProgress(ctx context.Context, id, token, stage, detail string, changed bool) error {
	tag, e := a.DB.Exec(ctx, "UPDATE steam_jobs SET stage=$3,detail=$4,files_changed=files_changed OR $5,updated_at=now() WHERE id=$1 AND lease_token=$2 AND status='running' AND lease_until>now()", id, token, stage, detail, changed)
	if e != nil || tag.RowsAffected() != 1 {
		return errPrivateCancelled
	}
	_, e = a.DB.Exec(ctx, "INSERT INTO steam_job_events(job_id,stage,detail) VALUES($1,$2,$3)", id, stage, detail)
	if e == nil {
		a.steamConsoleProgress(ctx, id, stage, detail)
	}
	return e
}
func (a *App) runPrivateSteamJob(parent context.Context, job M, token string) error {
	ctx, cancel := context.WithTimeout(parent, 2*time.Hour)
	defer cancel()
	row, e := a.privateJobRow(ctx, str(job["id"]))
	if errors.Is(e, pgx.ErrNoRows) {
		return errPrivateCancelled
	}
	if e != nil {
		return errPrivateCancelled
	}
	if e = a.privateJobAllowed(ctx, row, token); e != nil {
		return e
	}
	requestBytes, _ := json.Marshal(row["request"])
	var request steamapi.PrivateRequest
	if json.Unmarshal(requestBytes, &request) != nil || request.Validate() != nil || request.Server != str(row["current_server"]) {
		return errPrivateCancelled
	}
	if !a.privateReady(ctx, num(row["node_id"]), request.Selection.App) {
		return errors.New("private Steam node is not ready")
	}
	h := a.privateHub()
	h.mu.Lock()
	if h.closed || h.active[request.Job] != nil {
		h.mu.Unlock()
		return errPrivateCancelled
	}
	h.active[request.Job] = cancel
	h.wg.Add(1)
	h.mu.Unlock()
	defer func() {
		h.mu.Lock()
		delete(h.active, request.Job)
		delete(h.guards, request.Job)
		h.mu.Unlock()
		h.wg.Done()
	}()
	watchDone := make(chan struct{})
	go a.privateWatch(ctx, row, token, cancel, watchDone)
	defer func() { cancel(); <-watchDone }()
	connection, e := a.DB.Acquire(ctx)
	if e != nil {
		return errPrivateCancelled
	}
	if e = steamSessionLock(ctx, connection, "voltra:server-mutation:"+request.Server); e != nil {
		connection.Release()
		return errPrivateCancelled
	}
	defer steamUnlock(connection)
	row, e = a.privateJobRow(ctx, request.Job)
	if e != nil || a.privateJobAllowed(ctx, row, token) != nil {
		return errPrivateCancelled
	}
	if boolean(row["input_consumed"]) || str(row["input_cipher"]) == "" {
		return errPrivateResupply
	}
	binding := privateEnvelope{Purpose: "job", Server: request.Server, Actor: num(row["actor_id"]), Authorization: str(row["authorization_id"]), Generation: str(row["authorization_generation"]), Job: request.Job, Digest: request.Scope().RequestDigest}
	secret, e := a.openPrivate(str(row["input_cipher"]), binding)
	if e != nil {
		return e
	}
	tag, e := a.DB.Exec(ctx, "UPDATE steam_private_jobs SET input_cipher='',input_consumed=true,updated_at=now() WHERE job_id=$1 AND NOT input_consumed AND input_cipher=$2", request.Job, row["input_cipher"])
	if e != nil || tag.RowsAffected() != 1 {
		return errPrivateResupply
	}
	request.Username = secret.Username
	request.Password = secret.Password
	request.BetaPassword = secret.BetaPassword
	if request.Validate() != nil {
		return errPrivateResupply
	}
	grant := steamapi.PrivateStreamGrant{Server: request.Server, Owner: request.Owner, Job: request.Job, Nonce: request.Nonce, Action: "run"}
	transport := &http.Transport{DialContext: func(c context.Context, _, _ string) (net.Conn, error) {
		return a.privateDial(c, num(row["node_id"]), grant)
	}, DisableKeepAlives: true, ResponseHeaderTimeout: 15 * time.Second}
	defer transport.CloseIdleConnections()
	payload, e := json.Marshal(request)
	defer clear(payload)
	if e != nil || len(payload) > 65536 {
		return errPrivateResupply
	}
	httpRequest, e := http.NewRequestWithContext(ctx, "POST", "http://private-node/run", bytes.NewReader(payload))
	if e != nil {
		return errPrivateCancelled
	}
	httpRequest.Header.Set("Content-Type", "application/json")
	response, e := (&http.Client{Transport: transport}).Do(httpRequest)
	if e != nil {
		return errPrivateCancelled
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		return errors.New("private Steam node rejected the request")
	}
	scanner := bufio.NewScanner(response.Body)
	scanner.Buffer(make([]byte, 4096), 65536)
	stages := map[string]string{"worker_started": "Private Steam acquisition started.", "guard_required": "Steam Guard response required.", "validating_receipt": "Independently validating publisher files.", "publication_validated": "Publisher content validated."}
	count := 0
	for scanner.Scan() {
		count++
		if count > 1024 {
			return errors.New("private Steam node protocol rejected")
		}
		var event steamapi.PrivateEvent
		if json.Unmarshal(scanner.Bytes(), &event) != nil || event.Version != steamapi.PrivateVersion || event.NativeAcceptanceVerified {
			return errors.New("private Steam node protocol rejected")
		}
		switch event.Type {
		case "progress":
			detail, ok := stages[event.Stage]
			if !ok {
				return errors.New("private Steam node protocol rejected")
			}
			if e = a.privateJobProgress(ctx, request.Job, token, event.Stage, detail, event.Stage == "publication_validated" || event.Stage == "worker_started"); e != nil {
				return e
			}
		case "guard_required":
			c := event.Challenge
			if c == nil || c.Job != request.Job || c.Nonce != request.Nonce || !privateCodeID.MatchString(c.ChallengeID) || (c.Kind != "device_code" && c.Kind != "email_code" && c.Kind != "device_confirmation") {
				return errors.New("private Steam Guard protocol rejected")
			}
			h.mu.Lock()
			if old := h.guards[request.Job]; old != nil && !old.claimed {
				h.mu.Unlock()
				return errors.New("private Steam Guard protocol rejected")
			}
			h.guards[request.Job] = &privateGuardState{challenge: *c, actor: num(row["actor_id"]), authKind: str(row["actor_auth_kind"]), authID: str(row["actor_auth_id"]), expires: time.Now().Add(20 * time.Second), ctx: ctx, nodeID: num(row["node_id"]), server: request.Server, owner: request.Owner}
			h.mu.Unlock()
			if e = a.privateJobProgress(ctx, request.Job, token, "guard_required", "Steam Guard response required.", false); e != nil {
				return e
			}
		case "error":
			return errors.New("private Steam node operation failed")
		case "result":
			if event.Stage != "publication_validated" || request.CheckReceipt(event.Receipt) != nil {
				return errors.New("private Steam publisher receipt rejected")
			}
			latest, e := a.privateJobRow(ctx, request.Job)
			if e != nil || a.privateJobAllowed(ctx, latest, token) != nil || ctx.Err() != nil {
				return errPrivateCancelled
			}
			return a.recordPrivatePublication(ctx, request, event.Receipt, token)
		default:
			return errors.New("private Steam node protocol rejected")
		}
	}
	if ctx.Err() != nil {
		return errPrivateCancelled
	}
	return io.ErrUnexpectedEOF
}
func (a *App) finishPrivateSteamJob(ctx context.Context, job M, token string, result error) {
	if result == nil {
		row, e := a.privateJobRow(ctx, str(job["id"]))
		if e != nil || a.privateJobAllowed(ctx, row, token) != nil {
			result = errPrivateCancelled
		}
	}
	status, stage, detail := "completed", "completed", "Publisher content validated; native runtime setup is not verified."
	if result != nil {
		status, stage, detail = "failed", "failed", "Private Steam content failed. Review node readiness, game access and stopped-server state before creating a new job."
		if errors.Is(result, errPrivateCancelled) || errors.Is(result, context.Canceled) || errors.Is(result, context.DeadlineExceeded) {
			status, stage, detail = "cancelled", "cancelled", "Private Steam authorization was cancelled; create a new job to continue."
		}
		if errors.Is(result, errPrivateResupply) {
			detail = "Private Steam credentials were consumed or unavailable; supply them again in a new job."
		}
	}
	tx, e := a.DB.Begin(ctx)
	if e != nil {
		return
	}
	defer tx.Rollback(ctx)
	tag, e := tx.Exec(ctx, "UPDATE steam_jobs SET status=$3,stage=$4,detail=$5,error=CASE WHEN $3='completed' THEN '' ELSE $5 END,completed_at=now(),lease_until=NULL,updated_at=now() WHERE id=$1 AND lease_token=$2 AND status='running'", job["id"], token, status, stage, detail)
	if e != nil || tag.RowsAffected() != 1 {
		return
	}
	_, e = tx.Exec(ctx, "UPDATE steam_private_jobs SET input_cipher='',updated_at=now() WHERE job_id=$1", job["id"])
	if e == nil {
		_, e = tx.Exec(ctx, "INSERT INTO steam_job_events(job_id,stage,detail) VALUES($1,$2,$3)", job["id"], stage, detail)
	}
	if e == nil {
		_ = tx.Commit(ctx)
	}
}
