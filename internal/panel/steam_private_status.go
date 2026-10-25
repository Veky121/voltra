package panel

import (
	"bytes"
	"context"
	"encoding/json"
	"net"
	"net/http"
	"time"
	"voltra/internal/steamapi"
)

func (a *App) privateScopedJob(r *http.Request) (M, M, M, error) {
	s, u, e := a.privateServer(r)
	if e != nil {
		return nil, nil, nil, e
	}
	job, e := a.one(r.Context(), "SELECT j.*,p.actor_id,p.actor_auth_kind,p.actor_auth_id,p.cancel_requested FROM steam_jobs j JOIN steam_private_jobs p ON p.job_id=j.id WHERE j.id=$1 AND j.server_id=$2 AND j.executor='steamkit-depot-v1'", r.PathValue("job"), s["id"])
	return s, u, job, e
}
func (a *App) privateJobs(w http.ResponseWriter, r *http.Request) {
	s, _, e := a.privateServer(r)
	if e != nil {
		fail(w, e)
		return
	}
	rows, e := a.query(r.Context(), "SELECT * FROM steam_jobs WHERE server_id=$1 AND executor='steamkit-depot-v1' ORDER BY created_at DESC LIMIT 20", s["id"])
	if e != nil {
		fail(w, e)
		return
	}
	out := []M{}
	for _, row := range rows {
		out = append(out, steamJobPublic(row))
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, 200, collection("steam_private_job", out))
}
func (a *App) privateJobStatus(w http.ResponseWriter, r *http.Request) {
	s, u, job, e := a.privateScopedJob(r)
	if e != nil {
		fail(w, e)
		return
	}
	controls, e := privateServerSteamControls(r.Context(), a.DB, s)
	if e != nil {
		fail(w, e)
		return
	}
	out := steamJobPublic(job)
	h := a.privateHub()
	kind, authID, _ := a.privateAuthBinding(r, num(u["id"]))
	h.mu.Lock()
	g := h.guards[str(job["id"])]
	if g != nil && g.actor == num(u["id"]) && g.authKind == kind && g.authID == authID && g.ctx.Err() == nil && !g.claimed && time.Now().Before(g.expires) {
		out["guard"] = M{"challenge_id": g.challenge.ChallengeID, "kind": g.challenge.Kind, "expires_at": g.expires, "code_controls": controls["guard"]}
	}
	h.mu.Unlock()
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, 200, item("steam_private_job", out))
}
func (a *App) privateJobCancel(w http.ResponseWriter, r *http.Request) {
	s, u, job, e := a.privateScopedJob(r)
	if e != nil {
		fail(w, e)
		return
	}
	if num(job["actor_id"]) != num(u["id"]) && num(s["owner_id"]) != num(u["id"]) && !boolean(u["root_admin"]) {
		fail(w, forbidden())
		return
	}
	var body struct{}
	if e = privateDecode(r, &body); e != nil {
		fail(w, e)
		return
	}
	tx, e := a.DB.Begin(r.Context())
	if e != nil {
		fail(w, e)
		return
	}
	defer tx.Rollback(r.Context())
	_, e = tx.Exec(r.Context(), "UPDATE steam_private_jobs SET cancel_requested=true,input_cipher='',updated_at=now() WHERE job_id=$1", job["id"])
	if e == nil {
		_, e = tx.Exec(r.Context(), "UPDATE steam_jobs SET status='cancelled',stage='cancelled',detail='Private Steam authorization was cancelled.',completed_at=now(),updated_at=now() WHERE id=$1 AND status='queued'", job["id"])
	}
	if e == nil {
		e = tx.Commit(r.Context())
	}
	if e != nil {
		fail(w, e)
		return
	}
	h := a.privateHub()
	h.mu.Lock()
	cancel := h.active[str(job["id"])]
	if cancel != nil {
		cancel()
	}
	delete(h.guards, str(job["id"]))
	h.mu.Unlock()
	a.opAudit(r, s, "server:steam.private.job.cancelled", M{"job_id": job["id"]})
	w.WriteHeader(204)
}

type privateGuardInput struct {
	ChallengeID string  `json:"challenge_id"`
	Kind        string  `json:"kind"`
	Code        *string `json:"code,omitempty"`
	Accepted    *bool   `json:"accepted,omitempty"`
}

func (a *App) privateJobGuard(w http.ResponseWriter, r *http.Request) {
	s, u, job, e := a.privateScopedJob(r)
	if e != nil {
		fail(w, e)
		return
	}
	kind, authID, e := a.privateAuthBinding(r, num(u["id"]))
	if e != nil || num(job["actor_id"]) != num(u["id"]) || str(job["actor_auth_kind"]) != kind || str(job["actor_auth_id"]) != authID {
		fail(w, forbidden())
		return
	}
	row, e := a.privateJobRow(r.Context(), str(job["id"]))
	if e != nil || a.privateJobAllowed(r.Context(), row, str(row["lease_token"])) != nil {
		fail(w, APIError{409, "PrivateSteamGuardExpired", "The private Steam job is no longer authorized."})
		return
	}
	var in privateGuardInput
	if e = privateDecode(r, &in); e != nil {
		fail(w, e)
		return
	}
	controls, e := privateServerSteamControls(r.Context(), a.DB, s)
	if e != nil {
		fail(w, e)
		return
	}
	if in.Kind != "device_confirmation" && in.Code != nil {
		if e = validatePrivateOriginal(controls, "guard", *in.Code); e != nil {
			fail(w, e)
			return
		}
	}
	h := a.privateHub()
	h.mu.Lock()
	g := h.guards[str(job["id"])]
	if g == nil || g.claimed || g.ctx.Err() != nil || !time.Now().Before(g.expires) || g.actor != num(u["id"]) || g.authKind != kind || g.authID != authID || g.challenge.ChallengeID != in.ChallengeID || g.challenge.Kind != in.Kind || in.Kind == "device_confirmation" && (in.Accepted == nil || in.Code != nil) || in.Kind != "device_confirmation" && (in.Code == nil || in.Accepted != nil) {
		h.mu.Unlock()
		fail(w, APIError{409, "PrivateSteamGuardExpired", "The Guard challenge is stale, expired or already answered."})
		return
	}
	g.claimed = true
	copy := *g
	h.mu.Unlock()
	reply := steamapi.PrivateReply{PrivateChallenge: copy.challenge, Code: in.Code, Accepted: in.Accepted}
	payload, e := json.Marshal(reply)
	defer clear(payload)
	if e != nil || len(payload) > 65536 {
		fail(w, bad("Invalid Guard response."))
		return
	}
	grant := steamapi.PrivateStreamGrant{Server: copy.server, Owner: copy.owner, Job: copy.challenge.Job, Nonce: copy.challenge.Nonce, Action: "reply"}
	ctx, cancel := context.WithDeadline(r.Context(), copy.expires)
	defer cancel()
	stopJobCancellation := context.AfterFunc(copy.ctx, cancel)
	defer stopJobCancellation()
	transport := &http.Transport{DialContext: func(c context.Context, _, _ string) (net.Conn, error) { return a.privateDial(c, copy.nodeID, grant) }, DisableKeepAlives: true, ResponseHeaderTimeout: 5 * time.Second}
	defer transport.CloseIdleConnections()
	request, e := http.NewRequestWithContext(ctx, "POST", "http://private-node/reply", bytes.NewReader(payload))
	if e != nil {
		fail(w, bad("Guard delivery failed."))
		return
	}
	request.Header.Set("Content-Type", "application/json")
	response, e := (&http.Client{Transport: transport}).Do(request)
	if response != nil {
		response.Body.Close()
	}
	if e != nil || response.StatusCode != 204 {
		_, _ = a.DB.Exec(r.Context(), "UPDATE steam_private_jobs SET cancel_requested=true,input_cipher='' WHERE job_id=$1", job["id"])
		h.mu.Lock()
		if stop := h.active[str(job["id"])]; stop != nil {
			stop()
		}
		h.mu.Unlock()
		fail(w, APIError{409, "PrivateSteamGuardDeliveryUncertain", "Guard delivery was not confirmed; create a new authorized job."})
		return
	}
	a.opAudit(r, s, "server:steam.private.guard.answered", M{"job_id": job["id"], "kind": in.Kind})
	w.WriteHeader(204)
}
