package panel

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

func TestRevocationBackoff(t *testing.T) {
	for _, tt := range []struct {
		attempt int64
		want    time.Duration
	}{{1, 30 * time.Second}, {2, time.Minute}, {3, 2 * time.Minute}, {6, 15 * time.Minute}, {1000, 15 * time.Minute}} {
		if got := revocationBackoff(tt.attempt); got != tt.want {
			t.Fatalf("attempt %d got %v want %v", tt.attempt, got, tt.want)
		}
	}
}

func TestRevocationsOfflineSubuserChangesAndRecovery(t *testing.T) {
	a, ctx := collabTestApp(t)
	var available atomic.Bool
	var requests atomic.Int64
	var targetServer, targetUser string
	daemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		if r.URL.Path != "/api/deauthorize-user" {
			t.Errorf("wrong daemon route %s", r.URL.Path)
		}
		var payload struct {
			User    string   `json:"user"`
			Servers []string `json:"servers"`
		}
		if e := json.NewDecoder(r.Body).Decode(&payload); e != nil {
			t.Error(e)
		}
		if payload.User != targetUser || len(payload.Servers) != 1 || payload.Servers[0] != targetServer {
			t.Errorf("revocation target mismatch %v", payload)
		}
		if !available.Load() {
			http.Error(w, "daemon unavailable", 500)
			return
		}
		w.WriteHeader(204)
	}))
	defer daemon.Close()
	owner, s := collabFixture(t, a, ctx, daemon.URL)
	targetServer = str(s["uuid"])
	base := "/api/client/servers/" + str(s["uuid_short"]) + "/users"
	code, out := collabRequest(t, a, num(owner["id"]), "POST", base, M{"email": "offline@example.test", "permissions": []string{"file.read"}})
	if code != 200 {
		t.Fatal("offline invite failed", code, out)
	}
	user := asMap(out["attributes"])
	targetUser = str(user["uuid"])
	if requests.Load() != 0 {
		t.Fatal("mutation synchronously contacted Wings")
	}
	if !a.can(ctx, user, s, "file.read") {
		t.Fatal("initial grant missing")
	}
	job, e := a.one(ctx, "SELECT * FROM daemon_revocations WHERE server_uuid=$1 AND user_uuid=$2", targetServer, targetUser)
	if e != nil || job["completed_at"] != nil {
		t.Fatal("revocation not persisted", job, e)
	}
	if ran, e := a.processRevocation(ctx); e != nil || !ran {
		t.Fatal(ran, e)
	}
	job, e = a.one(ctx, "SELECT * FROM daemon_revocations WHERE id=$1", job["id"])
	if e != nil || num(job["attempts"]) != 1 || str(job["last_error"]) == "" || job["lease_until"] != nil || job["completed_at"] != nil {
		t.Fatal("offline retry not persisted", job, e)
	}
	code, out = collabRequest(t, a, num(owner["id"]), "POST", base+"/"+targetUser, M{"permissions": []string{"control.console"}})
	if code != 200 {
		t.Fatal("offline permission update failed", code, out)
	}
	if a.can(ctx, user, s, "file.read") {
		t.Fatal("revoked file permission remains active while Wings offline")
	}
	code, out = collabRequest(t, a, num(owner["id"]), "DELETE", base+"/"+targetUser, nil)
	if code != 204 {
		t.Fatal("offline removal failed", code, out)
	}
	if a.can(ctx, user, s, "control.console") || a.can(ctx, user, s, "") {
		t.Fatal("removed subuser still has panel permissions")
	}
	job, e = a.one(ctx, "SELECT * FROM daemon_revocations WHERE id=$1", job["id"])
	if e != nil || num(job["generation"]) != 3 || job["completed_at"] != nil {
		t.Fatal("coalesced revocation missing", job, e)
	}
	available.Store(true)
	restarted := &App{DB: a.DB, HTTP: a.HTTP, Config: a.Config}
	if ran, e := restarted.processRevocation(ctx); e != nil || !ran {
		t.Fatal("restarted worker did not resume pending revocation", ran, e)
	}
	job, e = a.one(ctx, "SELECT * FROM daemon_revocations WHERE id=$1", job["id"])
	if e != nil || job["completed_at"] == nil || job["lease_until"] != nil || str(job["last_error"]) != "" || num(job["attempts"]) != 2 {
		t.Fatal("recovered revocation not complete", job, e)
	}
	if requests.Load() != 2 {
		t.Fatal("unexpected daemon attempts", requests.Load())
	}
}

func TestRevocationsTransactionRollbackAndExpiredLease(t *testing.T) {
	a, ctx := collabTestApp(t)
	var calls atomic.Int64
	daemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls.Add(1); w.WriteHeader(204) }))
	defer daemon.Close()
	user, s := collabFixture(t, a, ctx, daemon.URL)
	tx, e := a.DB.Begin(ctx)
	if e != nil {
		t.Fatal(e)
	}
	if e = a.queueRevocationTx(ctx, tx, s, user); e != nil {
		t.Fatal(e)
	}
	if e = tx.Rollback(ctx); e != nil {
		t.Fatal(e)
	}
	var count int64
	if e = a.DB.QueryRow(ctx, "SELECT count(*) FROM daemon_revocations").Scan(&count); e != nil || count != 0 {
		t.Fatal("rolled-back permission change left a job", count, e)
	}
	tx, e = a.DB.Begin(ctx)
	if e != nil {
		t.Fatal(e)
	}
	if e = a.queueRevocationTx(ctx, tx, s, user); e != nil {
		t.Fatal(e)
	}
	if e = tx.Commit(ctx); e != nil {
		t.Fatal(e)
	}
	if e = a.exec(ctx, "UPDATE daemon_revocations SET lease_until=now()+interval '1 minute',lease_token='crashed-process'"); e != nil {
		t.Fatal(e)
	}
	if ran, e := a.processRevocation(ctx); e != nil || ran {
		t.Fatal("worker stole live lease", ran, e)
	}
	if e = a.exec(ctx, "UPDATE daemon_revocations SET lease_until=now()-interval '1 second'"); e != nil {
		t.Fatal(e)
	}
	restarted := &App{DB: a.DB, Config: a.Config, HTTP: a.HTTP}
	if ran, e := restarted.processRevocation(ctx); e != nil || !ran {
		t.Fatal("expired lease not recovered", ran, e)
	}
	if calls.Load() != 1 {
		t.Fatal("unexpected dispatch count", calls.Load())
	}
}

func TestRevocationsNewGenerationDuringDispatchSurvives(t *testing.T) {
	a, ctx := collabTestApp(t)
	started, release := make(chan struct{}), make(chan struct{})
	var calls atomic.Int64
	daemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if calls.Add(1) == 1 {
			close(started)
			<-release
		}
		w.WriteHeader(204)
	}))
	defer daemon.Close()
	user, s := collabFixture(t, a, ctx, daemon.URL)
	enqueue := func() {
		t.Helper()
		tx, e := a.DB.Begin(ctx)
		if e != nil {
			t.Fatal(e)
		}
		defer tx.Rollback(ctx)
		if e = a.queueRevocationTx(ctx, tx, s, user); e != nil {
			t.Fatal(e)
		}
		if e = tx.Commit(ctx); e != nil {
			t.Fatal(e)
		}
	}
	enqueue()
	done := make(chan error, 1)
	go func() { _, e := a.processRevocation(context.Background()); done <- e }()
	select {
	case <-started:
	case <-time.After(5 * time.Second):
		close(release)
		t.Fatal("worker did not dispatch")
	}
	enqueue()
	if ran, e := a.processRevocation(ctx); e != nil || ran {
		close(release)
		t.Fatal("concurrent worker stole active target", ran, e)
	}
	close(release)
	if e := <-done; e != nil {
		t.Fatal(e)
	}
	job, e := a.one(ctx, "SELECT * FROM daemon_revocations")
	if e != nil || num(job["generation"]) != 2 || job["completed_at"] != nil || job["lease_token"] != nil {
		t.Fatal("old generation erased newly queued mutation", job, e)
	}
	if ran, e := a.processRevocation(ctx); e != nil || !ran {
		t.Fatal("new generation not retried", ran, e)
	}
	job, e = a.one(ctx, "SELECT * FROM daemon_revocations")
	if e != nil || job["completed_at"] == nil || calls.Load() != 2 {
		t.Fatal("new generation not completed", job, e, calls.Load())
	}
}

func TestRevocationsEnqueueFailureRollsBackSubuserMutation(t *testing.T) {
	a, ctx := collabTestApp(t)
	daemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(204) }))
	defer daemon.Close()
	owner, s := collabFixture(t, a, ctx, daemon.URL)
	if e := a.exec(ctx, "ALTER TABLE daemon_revocations ADD CONSTRAINT reject_test_revocations CHECK(false) NOT VALID"); e != nil {
		t.Fatal(e)
	}
	code, out := collabRequest(t, a, num(owner["id"]), "POST", "/api/client/servers/"+str(s["uuid_short"])+"/users", M{"email": "mustrollback@example.test", "permissions": []string{"file.read"}})
	if code >= 200 && code < 300 {
		t.Fatal("mutation succeeded without durable revocation", code, out)
	}
	var users, grants, notifications int64
	if e := a.DB.QueryRow(ctx, "SELECT count(*) FROM users WHERE email='mustrollback@example.test'").Scan(&users); e != nil {
		t.Fatal(e)
	}
	if e := a.DB.QueryRow(ctx, "SELECT count(*) FROM subusers").Scan(&grants); e != nil {
		t.Fatal(e)
	}
	if e := a.DB.QueryRow(ctx, "SELECT count(*) FROM notification_jobs").Scan(&notifications); e != nil {
		t.Fatal(e)
	}
	if users != 0 || grants != 0 || notifications != 0 {
		t.Fatal("failed enqueue left partial mutation", users, grants, notifications)
	}
}
