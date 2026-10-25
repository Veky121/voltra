package panel

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"time"

	"voltra/internal/steamapi"
)

func (a *App) privateRecoveryReady(ctx context.Context, node int64, app uint32) bool {
	h := a.privateHub()
	h.mu.Lock()
	ready, closed := h.recoveryReady, h.closed
	h.mu.Unlock()
	return !closed && ready != nil && ready(ctx, node, app)
}

func (a *App) privateRecoveryAllowed(ctx context.Context, q steamHistoryQuerier, serverID, actor int64, kind, authID, job string) (M, steamapi.PrivateRequest, error) {
	var empty steamapi.PrivateRequest
	u, err := queryRowMap(q.QueryRow(ctx, "SELECT row_to_json(u) FROM users u WHERE id=$1", actor))
	if err != nil || boolean(u["disabled"]) {
		return nil, empty, forbidden()
	}
	s, err := queryRowMap(q.QueryRow(ctx, "SELECT row_to_json(s) FROM servers s WHERE id=$1", serverID))
	if err != nil || !a.can(ctx, u, s, "startup.update") {
		return nil, empty, forbidden()
	}
	var live, blocked bool
	err = q.QueryRow(ctx, `SELECT CASE WHEN $1='session' THEN EXISTS(SELECT 1 FROM browser_sessions WHERE token_hash=$2 AND user_id=$3 AND expires_at>now())
	 WHEN $1='api_key' THEN EXISTS(SELECT 1 FROM api_keys WHERE id::text=$2 AND user_id=$3 AND type='client' AND (expires_at IS NULL OR expires_at>now())) ELSE false END`, kind, authID, actor).Scan(&live)
	if err != nil || !live {
		return nil, empty, forbidden()
	}
	err = q.QueryRow(ctx, `SELECT n.maintenance_mode OR EXISTS(SELECT 1 FROM server_transfers WHERE server_id=$1 AND successful IS NULL)
	 OR EXISTS(SELECT 1 FROM steam_jobs WHERE server_id=$1 AND status IN('queued','running')) FROM nodes n WHERE n.id=$2`, serverID, s["node_id"]).Scan(&blocked)
	if err != nil || blocked || str(s["status"]) != "" && str(s["status"]) != "reinstall_failed" {
		return nil, empty, APIError{409, "PrivateSteamRecoveryBusy", "Finish the current server operation before recovering private Steam content."}
	}
	request, err := privateRecoveryRequest(ctx, q, s, job)
	if err != nil {
		return nil, empty, err
	}
	if !a.privateRecoveryReady(ctx, num(s["node_id"]), request.Selection.App) {
		return nil, empty, APIError{409, "PrivateSteamRecoveryNotReady", "A separately reviewed receipt recovery worker and game policy are required on this node."}
	}
	return s, request, nil
}

func (a *App) privateJobRecover(w http.ResponseWriter, r *http.Request) {
	s, u, err := a.privateServer(r)
	if err != nil {
		fail(w, err)
		return
	}
	var body struct{}
	if err = privateDecode(r, &body); err != nil {
		fail(w, err)
		return
	}
	kind, authID, err := a.privateAuthBinding(r, num(u["id"]))
	if err != nil {
		fail(w, err)
		return
	}
	job := r.PathValue("job")
	_, original, err := a.privateRecoveryAllowed(r.Context(), a.DB, num(s["id"]), num(u["id"]), kind, authID, job)
	if err != nil {
		fail(w, err)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), time.Duration(original.DeadlineSeconds)*time.Second)
	defer cancel()
	h := a.privateHub()
	h.mu.Lock()
	if h.closed || h.active[job] != nil {
		h.mu.Unlock()
		fail(w, APIError{409, "PrivateSteamRecoveryBusy", "A private Steam operation is already active."})
		return
	}
	h.active[job] = cancel
	h.wg.Add(1)
	interval := h.poll
	h.mu.Unlock()
	defer func() { h.mu.Lock(); delete(h.active, job); h.mu.Unlock(); h.wg.Done() }()
	if interval <= 0 {
		interval = time.Second
	}
	done := make(chan struct{})
	go func() {
		defer close(done)
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				check, stop := context.WithTimeout(ctx, 2*time.Second)
				_, current, e := a.privateRecoveryAllowed(check, a.DB, num(s["id"]), num(u["id"]), kind, authID, job)
				stop()
				if e != nil || current.Scope() != original.Scope() {
					cancel()
					return
				}
			}
		}
	}()
	defer func() { cancel(); <-done }()
	conn, err := a.DB.Acquire(ctx)
	if err != nil {
		fail(w, errPrivateCancelled)
		return
	}
	if err = steamSessionLock(ctx, conn, "voltra:server-mutation:"+original.Server); err != nil {
		conn.Release()
		fail(w, errPrivateCancelled)
		return
	}
	defer steamUnlock(conn)
	_, current, err := a.privateRecoveryAllowed(ctx, a.DB, num(s["id"]), num(u["id"]), kind, authID, job)
	if err != nil || current.Scope() != original.Scope() {
		fail(w, errPrivateCancelled)
		return
	}
	receipt, err := a.privateRecoverReceipt(ctx, num(s["node_id"]), original)
	if err != nil {
		fail(w, APIError{409, "PrivateSteamRecoveryFailed", "The committed private Steam receipt could not be recovered and validated. No installation was started."})
		return
	}
	tx, err := a.DB.Begin(ctx)
	if err != nil {
		fail(w, err)
		return
	}
	defer tx.Rollback(ctx)
	var locked int64
	if err = tx.QueryRow(ctx, "SELECT id FROM servers WHERE id=$1 FOR UPDATE", s["id"]).Scan(&locked); err != nil {
		fail(w, errPrivateCancelled)
		return
	}
	_, current, err = a.privateRecoveryAllowed(ctx, tx, num(s["id"]), num(u["id"]), kind, authID, job)
	if err != nil || current.Scope() != original.Scope() || ctx.Err() != nil || original.CheckReceipt(receipt) != nil {
		fail(w, errPrivateCancelled)
		return
	}
	_, err = tx.Exec(ctx, `INSERT INTO steam_private_publications(server_id,job_id,node_id,server_owner_id,egg_id,installation_id,receipt)
	 SELECT server_id,job_id,node_id,server_owner_id,egg_id,installation_id,$2 FROM steam_private_attempts WHERE job_id=$1 AND server_id=$3
	 ON CONFLICT(server_id) DO UPDATE SET job_id=EXCLUDED.job_id,node_id=EXCLUDED.node_id,server_owner_id=EXCLUDED.server_owner_id,egg_id=EXCLUDED.egg_id,installation_id=EXCLUDED.installation_id,receipt=EXCLUDED.receipt,updated_at=now()`, job, receipt, s["id"])
	if err == nil {
		err = tx.Commit(ctx)
	}
	if err != nil {
		fail(w, err)
		return
	}
	a.opAudit(r, s, "server:steam.private.receipt.recovered", M{"job_id": job})
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, 200, item("steam_private_recovery", M{"job_id": job, "recovered": true, "native_acceptance_verified": false}))
}

func (a *App) privateRecoverReceipt(ctx context.Context, node int64, original steamapi.PrivateRequest) (json.RawMessage, error) {
	clean, err := steamapi.PrivateRecoveryOriginalFromRequest(original)
	if err != nil {
		return nil, err
	}
	envelope := steamapi.PrivateReceiptRecoveryRequest{Version: steamapi.PrivateRecoveryCapability, RecoveryID: newUUID(), Original: clean}
	grant := steamapi.PrivateStreamGrant{Server: original.Server, Owner: original.Owner, Job: original.Job, Nonce: original.Nonce, Action: "recover", RecoveryID: envelope.RecoveryID, RequestDigest: original.Scope().RequestDigest}
	transport := &http.Transport{DialContext: func(c context.Context, _, _ string) (net.Conn, error) { return a.privateDial(c, node, grant) }, DisableKeepAlives: true, ResponseHeaderTimeout: 15 * time.Second}
	defer transport.CloseIdleConnections()
	payload, err := json.Marshal(envelope)
	if err != nil || len(payload) > 65536 {
		return nil, errors.New("invalid private recovery request")
	}
	req, err := http.NewRequestWithContext(ctx, "POST", "http://private-node/recover", bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	response, err := (&http.Client{Transport: transport}).Do(req)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		return nil, errors.New("private recovery rejected")
	}
	scanner := bufio.NewScanner(response.Body)
	scanner.Buffer(make([]byte, 4096), 65536)
	for count := 0; scanner.Scan(); count++ {
		if count >= 1024 {
			return nil, errors.New("invalid private recovery response")
		}
		var event steamapi.PrivateEvent
		if json.Unmarshal(scanner.Bytes(), &event) != nil || event.Version != steamapi.PrivateVersion || event.NativeAcceptanceVerified {
			return nil, errors.New("invalid private recovery response")
		}
		switch event.Type {
		case "progress":
			if event.Stage != "worker_started" && event.Stage != "recovering_receipt" && event.Stage != "validating_receipt" && event.Stage != "receipt_recovered" {
				return nil, errors.New("invalid private recovery progress")
			}
		case "result":
			if event.Stage != "receipt_recovered" || original.CheckReceipt(event.Receipt) != nil || ctx.Err() != nil {
				return nil, errors.New("invalid recovered receipt")
			}
			if scanner.Scan() || scanner.Err() != nil {
				return nil, errors.New("invalid private recovery terminal response")
			}
			return event.Receipt, nil
		default:
			return nil, errors.New("private recovery failed")
		}
	}
	return nil, io.ErrUnexpectedEOF
}
