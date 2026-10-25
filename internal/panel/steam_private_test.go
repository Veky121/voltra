package panel

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"golang.org/x/crypto/bcrypt"
	"voltra/internal/nodeagent"
	"voltra/internal/steamapi"
)

// Browser authentication is real; node readiness is an explicit test composition,
// never a claim about a released worker or authenticated Steam account.
func privateBrowser(t *testing.T) (*steamTestRuntime, *http.Client, string) {
	t.Helper()
	rt := steamRuntime(t)
	a := rt.app
	a.Config.DevMode = false
	hash, e := bcrypt.GenerateFromPassword([]byte("private-test-password"), bcrypt.MinCost)
	if e != nil {
		t.Fatal(e)
	}
	if e = a.exec(context.Background(), "UPDATE users SET password_hash=$2 WHERE id=$1", rt.user, string(hash)); e != nil {
		t.Fatal(e)
	}
	server := httptest.NewServer(a.Handler())
	t.Cleanup(server.Close)
	if e = a.exec(context.Background(), `INSERT INTO settings(key,value) VALUES('panel:setup',$1)`, M{"completed": true, "public_url": server.URL, "access_mode": "local", "tls_mode": "proxy"}); e != nil {
		t.Fatal(e)
	}
	jar, _ := cookiejar.New(nil)
	client := &http.Client{Jar: jar, Timeout: 3 * time.Second}
	status, _, _ := setupHTTP(t, client, "POST", server.URL+"/api/auth/login", M{"username": "infra_admin", "password": "private-test-password"}, server.URL)
	if status != 200 {
		t.Fatalf("login status %d", status)
	}
	a.privateHub().ready = func(context.Context, int64, uint32) bool { return true }
	return rt, client, server.URL + "/api/client/servers/" + str(rt.server["identifier"]) + "/steam/private"
}

type privatePanelRunner func(context.Context, steamapi.PrivateRequest, func(steamapi.PrivateEvent) error, func(context.Context, steamapi.PrivateChallenge) (steamapi.PrivateReply, error)) error

func (f privatePanelRunner) Run(c context.Context, r steamapi.PrivateRequest, e func(steamapi.PrivateEvent) error, g func(context.Context, steamapi.PrivateChallenge) (steamapi.PrivateReply, error)) error {
	return f(c, r, e, g)
}

type privatePanelReadiness struct{}

func (privatePanelReadiness) ProductionReady(context.Context) error { return nil }
func (privatePanelReadiness) AppPolicyReady(app uint32) bool        { return app == 2394010 }

func TestPrivateSteamAuthenticatedConnectorGuardCancellation(t *testing.T) {
	for _, action := range []string{"reply", "cancel", "revoke-session"} {
		t.Run(action, func(t *testing.T) {
			rt, client, base, job, token := privateRunningFixture(t)
			a := rt.app
			ctx := context.Background()
			origin := strings.Split(base, "/api/")[0]
			machineToken := randomToken(32)
			if e := a.exec(ctx, "UPDATE node_connectors SET token_hash=$2 WHERE node_id=$1", rt.server["node_id"], pairingHash(machineToken)); e != nil {
				t.Fatal(e)
			}
			reaped := make(chan struct{})
			runner := privatePanelRunner(func(c context.Context, r steamapi.PrivateRequest, _ func(steamapi.PrivateEvent) error, guard func(context.Context, steamapi.PrivateChallenge) (steamapi.PrivateReply, error)) error {
				defer close(reaped)
				reply, e := guard(c, steamapi.PrivateChallenge{Job: r.Job, Nonce: r.Nonce, ChallengeID: strings.Repeat("c", 32), Kind: "device_code"})
				if action == "reply" && (e != nil || reply.Code == nil || *reply.Code != "synthetic-test-code") {
					return errors.New("fixture reply mismatch")
				}
				return errors.New("fixture ends without authenticated Steam or publisher receipt")
			})
			controlCtx, stopControl := context.WithCancel(ctx)
			defer stopControl()
			controlDone := make(chan error, 1)
			go func() {
				controlDone <- nodeagent.Run(controlCtx, nodeagent.Config{PanelURL: origin, Token: machineToken, WingsAddress: "127.0.0.1:1", PrivateSteam: &nodeagent.PrivateSteamConnectorConfig{Runner: runner, Readiness: privatePanelReadiness{}}})
			}()
			defer func() {
				stopControl()
				select {
				case <-controlDone:
				case <-time.After(4 * time.Second):
					t.Error("node control did not join")
				}
			}()
			deadline := time.Now().Add(4 * time.Second)
			for {
				h := a.connectors()
				h.mu.Lock()
				control := h.controls[num(rt.server["node_id"])]
				ready := control != nil && control.capabilities[steamapi.PrivateCapability]
				h.mu.Unlock()
				if ready {
					break
				}
				if time.Now().After(deadline) {
					t.Fatal("private connector not ready")
				}
				time.Sleep(5 * time.Millisecond)
			}
			a.privateHub().poll = 5 * time.Millisecond
			done := make(chan error, 1)
			go func() { done <- a.runPrivateSteamJob(ctx, job, token) }()
			for {
				h := a.privateHub()
				h.mu.Lock()
				g := h.guards[str(job["id"])]
				h.mu.Unlock()
				if g != nil {
					break
				}
				if time.Now().After(deadline) {
					t.Fatal("Guard not delivered over actual connector")
				}
				time.Sleep(5 * time.Millisecond)
			}
			switch action {
			case "reply":
				otherJar, _ := cookiejar.New(nil)
				otherClient := &http.Client{Jar: otherJar, Timeout: 3 * time.Second}
				loginStatus, _, _ := setupHTTP(t, otherClient, "POST", origin+"/api/auth/login", M{"username": "infra_admin", "password": "private-test-password"}, origin)
				if loginStatus != 200 {
					t.Fatal("second session login failed")
				}
				wrongStatus, _, _ := setupHTTP(t, otherClient, "POST", base+"/jobs/"+str(job["id"])+"/guard", M{"challenge_id": strings.Repeat("c", 32), "kind": "device_code", "code": "wrong-session-code"}, origin)
				if wrongStatus != 403 {
					t.Fatalf("different session Guard status %d", wrongStatus)
				}
				status, _, _ := setupHTTP(t, client, "POST", base+"/jobs/"+str(job["id"])+"/guard", M{"challenge_id": strings.Repeat("c", 32), "kind": "device_code", "code": "synthetic-test-code"}, origin)
				if status != 204 {
					t.Fatalf("Guard status %d", status)
				}
				status, _, _ = setupHTTP(t, client, "POST", base+"/jobs/"+str(job["id"])+"/guard", M{"challenge_id": strings.Repeat("c", 32), "kind": "device_code", "code": "duplicate-code"}, origin)
				if status != 409 {
					t.Fatalf("duplicate Guard status %d", status)
				}
			case "cancel":
				status, _, _ := setupHTTP(t, client, "POST", base+"/jobs/"+str(job["id"])+"/cancel", M{}, origin)
				if status != 204 {
					t.Fatalf("cancel status %d", status)
				}
			case "revoke-session":
				if e := a.exec(ctx, "DELETE FROM browser_sessions"); e != nil {
					t.Fatal(e)
				}
			}
			var result error
			select {
			case result = <-done:
			case <-time.After(4 * time.Second):
				t.Fatal("private run did not return")
			}
			select {
			case <-reaped:
			case <-time.After(4 * time.Second):
				t.Fatal("node Guard runner not reaped")
			}
			if action == "reply" && !errors.Is(a.runPrivateSteamJob(ctx, job, token), errPrivateResupply) {
				t.Fatal("consumed one-shot was implicitly replayed")
			}
			a.finishPrivateSteamJob(ctx, job, token, result)
			row, e := a.one(ctx, "SELECT j.*,p.input_cipher,p.input_consumed,p.receipt FROM steam_jobs j JOIN steam_private_jobs p ON p.job_id=j.id")
			if e != nil {
				t.Fatal(e)
			}
			if str(row["input_cipher"]) != "" || !boolean(row["input_consumed"]) || row["receipt"] != nil || str(row["status"]) == "completed" {
				t.Fatal("fixture was mistaken for authenticated publication or retained secret")
			}
			events, _ := a.query(ctx, "SELECT * FROM steam_job_events")
			raw, _ := json.Marshal(events)
			if strings.Contains(string(raw), "synthetic-test-code") {
				t.Fatal("Guard persisted")
			}
		})
	}
}

func TestPrivateSteamMutationLockCancellation(t *testing.T) {
	rt, _, _, job, token := privateRunningFixture(t)
	a := rt.app
	ctx := context.Background()
	lock, e := a.DB.Acquire(ctx)
	if e != nil {
		t.Fatal(e)
	}
	if e = steamSessionLock(ctx, lock, "voltra:server-mutation:"+str(rt.server["uuid"])); e != nil {
		lock.Release()
		t.Fatal(e)
	}
	defer steamUnlock(lock)
	work, cancel := context.WithCancel(ctx)
	done := make(chan error, 1)
	go func() { done <- a.runPrivateSteamJob(work, job, token) }()
	time.Sleep(50 * time.Millisecond)
	row, e := a.one(ctx, "SELECT input_consumed,input_cipher FROM steam_private_jobs WHERE job_id=$1", job["id"])
	if e != nil || boolean(row["input_consumed"]) || str(row["input_cipher"]) == "" {
		t.Fatal("secret consumed before mutation lock")
	}
	cancel()
	select {
	case e = <-done:
		if !errors.Is(e, errPrivateCancelled) {
			t.Fatal("lock cancellation unsafe")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("lock wait did not cancel")
	}
}

func TestPrivateSteamDefaultReadinessAndRotation(t *testing.T) {
	rt, client, base, job, token := privateRunningFixture(t)
	a := rt.app
	ctx := context.Background()
	origin := strings.Split(base, "/api/")[0]
	before, _ := a.one(ctx, "SELECT * FROM steam_private_authorizations")
	status, _, _ := setupHTTP(t, client, "PUT", base+"/authorizations/"+str(before["id"]), M{"username": "different-account", "password": "rotated-password", "save_password": true}, origin)
	if status != 200 {
		t.Fatal(status)
	}
	after, _ := a.one(ctx, "SELECT * FROM steam_private_authorizations")
	if str(before["owner_scope"]) == str(after["owner_scope"]) || str(before["generation"]) == str(after["generation"]) {
		t.Fatal("account rotation retained ownership identity")
	}
	row, _ := a.privateJobRow(ctx, str(job["id"]))
	if a.privateJobAllowed(ctx, row, token) == nil {
		t.Fatal("old account generation authorized")
	}
	a.finishPrivateSteamJob(ctx, job, token, errPrivateCancelled)
	a.privateHub().mu.Lock()
	a.privateHub().ready = nil
	a.privateHub().mu.Unlock()
	status, _, _ = setupHTTP(t, client, "POST", base+"/jobs", M{"authorization_id": after["id"], "operation": "install"}, origin)
	if status != 409 {
		t.Fatalf("unprovisioned capability accepted %d", status)
	}
}

func TestPrivateSteamSubuserPermissionAndGuardExpiry(t *testing.T) {
	rt, client, base, job, token := privateRunningFixture(t)
	a := rt.app
	ctx := context.Background()
	origin := strings.Split(base, "/api/")[0]
	owner, e := a.insert(ctx, "users", M{"uuid": newUUID(), "username": "guard_owner", "email": "guard-owner@example.invalid"})
	if e != nil {
		t.Fatal(e)
	}
	if e = a.exec(ctx, "UPDATE servers SET owner_id=$2 WHERE id=$1", rt.server["id"], owner["id"]); e != nil {
		t.Fatal(e)
	}
	if e = a.exec(ctx, "UPDATE steam_private_jobs SET server_owner_id=$1", owner["id"]); e != nil {
		t.Fatal(e)
	}
	if e = a.exec(ctx, "UPDATE users SET root_admin=false WHERE id=$1", rt.user); e != nil {
		t.Fatal(e)
	}
	if _, e = a.insert(ctx, "subusers", M{"user_id": rt.user, "server_id": rt.server["id"], "permissions": []string{"startup.update"}}); e != nil {
		t.Fatal(e)
	}
	row, e := a.privateJobRow(ctx, str(job["id"]))
	if e != nil || a.privateJobAllowed(ctx, row, token) != nil {
		t.Fatal("authorized subuser refused")
	}
	g := &privateGuardState{actor: rt.user, authKind: str(row["actor_auth_kind"]), authID: str(row["actor_auth_id"]), ctx: ctx, expires: time.Now().Add(-time.Millisecond), challenge: steamapi.PrivateChallenge{Job: str(job["id"]), ChallengeID: strings.Repeat("c", 32), Kind: "device_code"}}
	a.privateHub().mu.Lock()
	a.privateHub().guards[str(job["id"])] = g
	a.privateHub().mu.Unlock()
	status, _, _ := setupHTTP(t, client, "POST", base+"/jobs/"+str(job["id"])+"/guard", M{"challenge_id": strings.Repeat("c", 32), "kind": "device_code", "code": "not-sent"}, origin)
	if status != 409 || g.claimed {
		t.Fatal("expired challenge accepted")
	}
	if e = a.exec(ctx, "UPDATE subusers SET permissions='[]'"); e != nil {
		t.Fatal(e)
	}
	row, _ = a.privateJobRow(ctx, str(job["id"]))
	if a.privateJobAllowed(ctx, row, token) == nil {
		t.Fatal("revoked subuser permission accepted")
	}
	status, _, _ = setupHTTP(t, client, "GET", base+"/authorizations", nil, origin)
	if status != 403 {
		t.Fatalf("revoked permission route status %d", status)
	}
}

func TestPrivateSteamPublicQueueContention(t *testing.T) {
	rt, client, base := privateBrowser(t)
	a := rt.app
	ctx := context.Background()
	origin := strings.Split(base, "/api/")[0]
	status, _, _ := setupHTTP(t, client, "POST", base+"/authorizations", M{"username": "fixture", "password": "password", "save_password": true}, origin)
	if status != 201 {
		t.Fatal(status)
	}
	profile, _ := a.one(ctx, "SELECT * FROM steam_private_authorizations")
	if _, e := a.insert(ctx, "steam_jobs", M{"id": newUUID(), "server_id": rt.server["id"], "operation": "update", "executor": "steamcmd-v1"}); e != nil {
		t.Fatal(e)
	}
	status, _, _ = setupHTTP(t, client, "POST", base+"/jobs", M{"authorization_id": profile["id"], "operation": "install"}, origin)
	if status != 409 {
		t.Fatalf("public/private queue contention status %d", status)
	}
	rows, _ := a.query(ctx, "SELECT * FROM steam_private_jobs")
	if len(rows) != 0 {
		t.Fatal("contended private job/cipher persisted")
	}
}

func TestPrivateSteamAuthenticatedCustody(t *testing.T) {
	rt, client, base := privateBrowser(t)
	a := rt.app
	origin := strings.Split(base, "/api/")[0]
	status, _, _ := setupHTTP(t, http.DefaultClient, "GET", base+"/authorizations", nil, origin)
	if status != 401 {
		t.Fatalf("unauthenticated status %d", status)
	}
	secret := "literal secret + Unicode ž & --password"
	status, body, _ := setupHTTP(t, client, "POST", base+"/authorizations", M{"username": "fixture-user", "password": secret, "save_password": true}, origin)
	if status != 201 {
		t.Fatalf("create status %d: %v", status, body)
	}
	raw, _ := json.Marshal(body)
	if strings.Contains(string(raw), secret) || strings.Contains(string(raw), "fixture-user") {
		t.Fatal("profile response exposed identity")
	}
	rows, e := a.query(context.Background(), "SELECT * FROM steam_private_authorizations")
	if e != nil || len(rows) != 1 {
		t.Fatal("missing authorization")
	}
	row := rows[0]
	if !strings.HasPrefix(str(row["credential_cipher"]), "enc:v1:") || strings.Contains(str(row["credential_cipher"]), secret) {
		t.Fatal("credential not sealed")
	}
	want := privateEnvelope{Purpose: "profile", Server: str(rt.server["uuid"]), Actor: rt.user, Authorization: str(row["id"]), Generation: str(row["generation"])}
	// A ciphertext moved to another actor or generation must not decrypt for use.
	want.Actor++
	if _, e = a.openPrivate(str(row["credential_cipher"]), want); !errors.Is(e, errPrivateResupply) {
		t.Fatal("cross-actor envelope accepted")
	}
	status, body, _ = setupHTTP(t, client, "POST", base+"/jobs", M{"authorization_id": row["id"], "operation": "install"}, origin)
	if status != 202 {
		t.Fatalf("queue status %d: %v", status, body)
	}
	job, e := a.one(context.Background(), "SELECT j.*,p.input_cipher FROM steam_jobs j JOIN steam_private_jobs p ON p.job_id=j.id")
	if e != nil {
		t.Fatal(e)
	}
	if str(job["input_cipher"]) == "" || strings.Contains(str(job["input_cipher"]), secret) {
		t.Fatal("one-shot credential missing or plaintext")
	}
	status, _, _ = setupHTTP(t, client, "POST", base+"/jobs", M{"authorization_id": row["id"], "operation": "install"}, origin)
	if status != 409 {
		t.Fatalf("active queue contention status %d", status)
	}
	token := newUUID()
	if e = a.exec(context.Background(), "UPDATE steam_jobs SET status='running',lease_token=$2,lease_until=now()+interval '90 seconds' WHERE id=$1", job["id"], token); e != nil {
		t.Fatal(e)
	}
	a.finishPrivateSteamJob(context.Background(), job, token, errors.New(secret))
	finished, _ := a.one(context.Background(), "SELECT j.*,p.input_cipher FROM steam_jobs j JOIN steam_private_jobs p ON p.job_id=j.id")
	raw, _ = json.Marshal(finished)
	if strings.Contains(string(raw), secret) || str(finished["input_cipher"]) != "" || str(finished["status"]) != "failed" {
		t.Fatal("unsafe finish or retained one-shot")
	}
	if blockPublicSteamOwnership(context.Background(), a.DB, num(rt.server["id"])) == nil {
		t.Fatal("private history allowed public fallback")
	}
}

func TestPrivateSteamActorDeletionOrphan(t *testing.T) {
	rt, client, base := privateBrowser(t)
	a := rt.app
	ctx := context.Background()
	origin := strings.Split(base, "/api/")[0]
	owner, e := a.insert(ctx, "users", M{"uuid": newUUID(), "username": "remaining_owner", "email": "owner@example.invalid"})
	if e != nil {
		t.Fatal(e)
	}
	if e = a.exec(ctx, "UPDATE servers SET owner_id=$2 WHERE id=$1", rt.server["id"], owner["id"]); e != nil {
		t.Fatal(e)
	}
	status, _, _ := setupHTTP(t, client, "POST", base+"/authorizations", M{"username": "fixture-account", "password": "never-persist-plain", "save_password": true}, origin)
	if status != 201 {
		t.Fatal(status)
	}
	profile, _ := a.one(ctx, "SELECT * FROM steam_private_authorizations")
	status, _, _ = setupHTTP(t, client, "POST", base+"/jobs", M{"authorization_id": profile["id"], "operation": "install"}, origin)
	if status != 202 {
		t.Fatal(status)
	}
	job, _ := a.one(ctx, "SELECT * FROM steam_jobs")
	token := newUUID()
	if e = a.exec(ctx, "UPDATE steam_jobs SET status='running',lease_token=$2,lease_until=now()+interval '90 seconds' WHERE id=$1", job["id"], token); e != nil {
		t.Fatal(e)
	}
	if e = a.exec(ctx, "DELETE FROM users WHERE id=$1", rt.user); e != nil {
		t.Fatalf("account deletion blocked: %v", e)
	}
	for _, table := range []string{"steam_private_jobs", "steam_private_authorizations"} {
		rows, e := a.query(ctx, "SELECT * FROM "+table)
		if e != nil || len(rows) != 0 {
			t.Fatal("actor custody not deleted")
		}
	}
	if e = a.runPrivateSteamJob(ctx, job, token); !errors.Is(e, errPrivateCancelled) {
		t.Fatal("orphan job did not fail closed")
	}
	a.finishPrivateSteamJob(ctx, job, token, errPrivateCancelled)
	row, e := a.one(ctx, "SELECT * FROM steam_jobs WHERE id=$1", job["id"])
	if e != nil || str(row["status"]) != "cancelled" {
		t.Fatal("orphan parent not settled")
	}
	if blockPublicSteamOwnership(ctx, a.DB, num(rt.server["id"])) == nil {
		t.Fatal("actor deletion erased private content boundary")
	}
}

func TestPrivateSteamRealAPIKeyAndExpiry(t *testing.T) {
	rt, _, base := privateBrowser(t)
	a := rt.app
	ctx := context.Background()
	token := randomToken(32)
	key, e := a.insert(ctx, "api_keys", M{"user_id": rt.user, "identifier": randomToken(8), "token_hash": pairingHash(token), "type": "client"})
	if e != nil {
		t.Fatal(e)
	}
	call := func() int {
		req, _ := http.NewRequest("GET", base+"/authorizations", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		res, e := http.DefaultClient.Do(req)
		if e != nil {
			t.Fatal(e)
		}
		defer res.Body.Close()
		return res.StatusCode
	}
	if status := call(); status != 200 {
		t.Fatalf("actual client key auth %d", status)
	}
	if e = a.exec(ctx, "UPDATE api_keys SET expires_at=now()-interval '1 second' WHERE id=$1", key["id"]); e != nil {
		t.Fatal(e)
	}
	if status := call(); status != 401 {
		t.Fatalf("expired client key status %d", status)
	}
}

func TestPrivateSteamLosslessJSON(t *testing.T) {
	for _, raw := range []string{"{\"username\":\"\\ud800\"}", "{\"username\":\"\\udc00\"}", "{\"username\":\"" + string([]byte{0xff}) + "\"}"} {
		if privateStrictJSON([]byte(raw)) {
			t.Fatal("lossy credential JSON accepted")
		}
	}
	if !privateStrictJSON([]byte(`{"username":"ž\ud83d\ude00"}`)) {
		t.Fatal("valid Unicode pair refused")
	}
}

func privateRunningFixture(t *testing.T) (*steamTestRuntime, *http.Client, string, M, string) {
	t.Helper()
	rt, client, base := privateBrowser(t)
	ctx := context.Background()
	origin := strings.Split(base, "/api/")[0]
	status, _, _ := setupHTTP(t, client, "POST", base+"/authorizations", M{"username": "fixture-account", "password": "fixture-password", "save_password": true}, origin)
	if status != 201 {
		t.Fatal(status)
	}
	profile, _ := rt.app.one(ctx, "SELECT * FROM steam_private_authorizations")
	status, _, _ = setupHTTP(t, client, "POST", base+"/jobs", M{"authorization_id": profile["id"], "operation": "install"}, origin)
	if status != 202 {
		t.Fatal(status)
	}
	token := newUUID()
	job, e := rt.app.claimSteamJob(ctx, token)
	if e != nil {
		t.Fatal(e)
	}
	return rt, client, base, job, token
}

func TestPrivateSteamRevocationWatcher(t *testing.T) {
	cases := []struct{ name, sql string }{
		{"session", "DELETE FROM browser_sessions"},
		{"disabled", "UPDATE users SET disabled=true"},
		{"generation", "UPDATE steam_private_authorizations SET generation='rotated'"},
		{"profile-revoke", "UPDATE steam_private_authorizations SET revoked=true"},
		{"install-generation", "UPDATE servers SET installation_id='new-installation'"},
		{"suspended", "UPDATE servers SET status='suspended'"},
		{"node-maintenance", "UPDATE nodes SET maintenance_mode=true"},
		{"cancel", "UPDATE steam_private_jobs SET cancel_requested=true"},
		{"lease-expired", "UPDATE steam_jobs SET lease_until=now()-interval '1 second'"},
		{"lease-reassigned", "UPDATE steam_jobs SET lease_token='another-worker'"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			rt, _, _, job, token := privateRunningFixture(t)
			a := rt.app
			ctx := context.Background()
			row, e := a.privateJobRow(ctx, str(job["id"]))
			if e != nil || a.privateJobAllowed(ctx, row, token) != nil {
				t.Fatal("initial job authorization rejected")
			}
			a.privateHub().poll = 5 * time.Millisecond
			watch, cancel := context.WithCancel(ctx)
			defer cancel()
			done := make(chan struct{})
			go a.privateWatch(watch, row, token, cancel, done)
			if e = a.exec(ctx, c.sql); e != nil {
				t.Fatal(e)
			}
			select {
			case <-watch.Done():
			case <-time.After(2 * time.Second):
				t.Fatal("revocation did not cancel")
			}
			<-done
		})
	}
}
