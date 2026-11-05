package panel

import (
	"context"
	"github.com/gorilla/websocket"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestLiveReadQueryPolicies(t *testing.T) {
	a := &App{}
	for _, path := range []string{
		"/api/client/servers/a/backups?page=2&per_page=20",
		"/api/client/servers/a/schedules?include=tasks",
		"/api/client/servers/a/files/list?directory=%2Fworld%20one",
		"/api/client/servers/a/users",
		"/api/client/servers/a/activity?page=2&per_page=20",
	} {
		topic, ok := a.liveTopic(path)
		if !ok {
			t.Fatalf("missing %s", path)
		}
		if topic.interval < 15*time.Second {
			t.Fatalf("quiet topic polls too frequently: %s", path)
		}
	}
	for _, path := range []string{
		"/api/client/servers/a/backups?include=password", "/api/client/servers/a/backups?page=0",
		"/api/client/servers/a/backups?page=1&page=2", "/api/client/servers/a/backups?per_page=100000",
		"/api/client/servers/a/schedules?include=users", "/api/client/servers/a/files/contents?file=secret",
		"/api/client/servers/a/files/list?directory=%00", "/api/client/servers/a/files/list?token=secret",
	} {
		if _, ok := a.liveTopic(path); ok {
			t.Fatalf("unsafe %s", path)
		}
	}
	for _, suffix := range []string{"resources", "console-history"} {
		topic, _ := a.liveTopic("/api/client/servers/a/" + suffix)
		if topic.interval != time.Second {
			t.Fatal("telemetry lost sampling cadence")
		}
	}
}

func TestLiveInFlightReadAndQueuedDeliveryAreFenced(t *testing.T) {
	a := &App{}
	defer a.liveSnapshots.close()
	started, release := make(chan struct{}), make(chan struct{})
	var calls atomic.Int32
	topic := liveTopic{path: "/test", event: "backups.updated", interval: time.Hour, handler: func(w http.ResponseWriter, r *http.Request) {
		if calls.Add(1) == 1 {
			close(started)
			select {
			case <-release:
			case <-r.Context().Done():
				return
			}
			writeJSON(w, 200, M{"old": true})
			return
		}
		writeJSON(w, 200, M{"fresh": true})
	}}
	b := &liveBinding{updates: make(chan liveDelivery, 8), resync: make(chan struct{}, 1)}
	if !a.watchLiveTopic(topic, 1, b) {
		t.Fatal("watch failed")
	}
	defer b.cancel()
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("reader never started")
	}
	a.publishReadChanges("backups")
	close(release)
	select {
	case d := <-b.updates:
		if string(d.sample.data) != "{\"fresh\":true}\n" {
			t.Fatalf("stale read delivered: %s", d.sample.data)
		}
		if !a.liveSnapshots.deliveryCurrent(d) {
			t.Fatal("fresh delivery rejected")
		}
		a.publishReadChanges("backups")
		if a.liveSnapshots.deliveryCurrent(d) {
			t.Fatal("queued stale delivery accepted")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("no replacement snapshot")
	}
}

func TestLiveSlowConsumerRequestsResynchronization(t *testing.T) {
	a := &App{}
	defer a.liveSnapshots.close()
	b := &liveBinding{updates: make(chan liveDelivery), resync: make(chan struct{}, 1)}
	topic := liveTopic{path: "/test", event: "backups.updated", interval: time.Hour, handler: func(w http.ResponseWriter, r *http.Request) { writeJSON(w, 200, M{"data": []string{}}) }}
	if !a.watchLiveTopic(topic, 1, b) {
		t.Fatal("watch failed")
	}
	defer b.cancel()
	select {
	case <-b.resync:
	case <-time.After(time.Second):
		t.Fatal("full queue silently lost update")
	}
}

func TestLiveChangesInvalidateOtherUsersAndFenceInflightSamples(t *testing.T) {
	h := &liveSnapshotHub{workers: map[string]*liveSnapshotWorker{}}
	for key, event := range map[string]string{"owner": "backups.updated", "viewer": "backups.updated", "other": "schedules.updated"} {
		h.workers[key] = &liveSnapshotWorker{user: 1, topic: liveTopic{event: event}, last: &liveSample{status: 200}, wake: make(chan struct{}, 1)}
	}
	h.workers["viewer"].user = 2
	h.invalidateDomains("backups")
	for _, key := range []string{"owner", "viewer"} {
		w := h.workers[key]
		if w.last != nil || w.generation != 1 || len(w.wake) != 1 {
			t.Fatal("stale cache or cross-user update lost", key)
		}
	}
	if h.workers["other"].generation != 0 {
		t.Fatal("unrelated list was refreshed")
	}
	h.invalidateDomains("access")
	if h.workers["other"].generation != 1 {
		t.Fatal("permission change did not invalidate all consumers")
	}
}

func TestLiveReadHintsCoalesceWithoutLosingDomains(t *testing.T) {
	h := &liveReadChanges{}
	ch, take, stop := h.subscribe()
	defer stop()
	for i := 0; i < 100; i++ {
		h.publish("backups")
		h.publish("files")
	}
	<-ch
	domains := take()
	if len(domains) != 2 {
		t.Fatalf("lost domains: %v", domains)
	}
	select {
	case <-ch:
		t.Fatal("unbounded duplicate notifications")
	default:
	}
}

func TestLiveCommittedDatabaseChangesAcrossListenersPostgres(t *testing.T) {
	a, ctx := collabTestApp(t)
	u, _ := collabFixture(t, a, ctx, "http://127.0.0.1:1")
	b := &App{DB: a.DB, HTTP: &http.Client{Timeout: time.Second}}
	ca, ta, sa := a.readChanges.subscribe()
	defer sa()
	cb, tb, sb := b.readChanges.subscribe()
	defer sb()
	a.startLiveChanges()
	defer a.stopLiveChanges()
	b.startLiveChanges()
	defer b.stopLiveChanges()
	wait := func(ch <-chan struct{}, take func() []string, want string) {
		t.Helper()
		timer := time.NewTimer(4 * time.Second)
		defer timer.Stop()
		for {
			select {
			case <-ch:
				for _, d := range take() {
					if d == want {
						return
					}
				}
			case <-timer.C:
				t.Fatalf("missing %s notification", want)
			}
		}
	}
	wait(ca, ta, "all")
	wait(cb, tb, "all")
	tx, err := a.DB.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = tx.Exec(ctx, "UPDATE users SET username='committed-name' WHERE id=$1", u["id"]); err != nil {
		t.Fatal(err)
	}
	select {
	case <-ca:
		t.Fatal("uncommitted change escaped")
	case <-time.After(100 * time.Millisecond):
	}
	if err = tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	wait(ca, ta, "access")
	wait(cb, tb, "access")
	tx, err = a.DB.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	_, err = tx.Exec(ctx, "UPDATE users SET username='rolled-back' WHERE id=$1", u["id"])
	if err != nil {
		t.Fatal(err)
	}
	if err = tx.Rollback(context.Background()); err != nil {
		t.Fatal(err)
	}
	_, err = a.DB.Exec(ctx, "UPDATE users SET updated_at=now() WHERE id=$1", u["id"])
	if err != nil {
		t.Fatal(err)
	}
	select {
	case <-ca:
		t.Fatal("rollback or timestamp-only change broadcast")
	case <-time.After(150 * time.Millisecond):
	}
	a.publishMutationReadChanges(ctx, "/api/client/servers/one/files/write")
	wait(cb, tb, "files")
}

func TestLivePaginatedBackupsAndScheduleTasksCommitPushPostgres(t *testing.T) {
	a, ctx := collabTestApp(t)
	defer a.liveSnapshots.close()
	u, s := collabFixture(t, a, ctx, "http://127.0.0.1:1")
	viewer, err := a.insert(ctx, "users", M{"uuid": newUUID(), "username": "reader", "email": "reader@example.test"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = a.insert(ctx, "subusers", M{"user_id": viewer["id"], "server_id": s["id"], "permissions": []any{"schedule.read", "backup.read"}}); err != nil {
		t.Fatal(err)
	}
	schedule, err := a.insert(ctx, "schedules", M{"server_id": s["id"], "name": "Daily"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = a.insert(ctx, "tasks", M{"schedule_id": schedule["id"], "sequence_id": 1, "action": "command", "payload": "say before"}); err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(a.Handler())
	defer server.Close()
	a.Config.PublicURL = server.URL
	owner := liveTestConnect(t, a, server, num(u["id"]))
	reader := liveTestConnect(t, a, server, num(viewer["id"]))
	a.startLiveChanges()
	defer a.stopLiveChanges()
	base := "/api/client/servers/" + str(s["uuid_short"])
	paths := []string{base + "/schedules?include=tasks", base + "/backups?page=1&per_page=20"}
	for _, c := range []*websocket.Conn{owner, reader} {
		if err = c.WriteJSON(M{"type": "subscribe", "revision": 1, "paths": paths}); err != nil {
			t.Fatal(err)
		}
		seen := map[string]bool{}
		liveRead(t, c, func(m M) bool {
			if m["type"] == "snapshot" {
				if num(m["status"]) != 200 {
					t.Fatalf("bad initial snapshot: %v", m)
				}
				seen[str(m["path"])] = true
			}
			return len(seen) == 2
		})
	}
	// These writes bypass HTTP and its mutation middleware entirely.
	if err = a.exec(ctx, "UPDATE tasks SET payload='say after' WHERE schedule_id=$1", schedule["id"]); err != nil {
		t.Fatal(err)
	}
	for _, c := range []*websocket.Conn{owner, reader} {
		liveRead(t, c, func(m M) bool { return m["path"] == paths[0] && strings.Contains(str(m["data"]), "say after") })
	}
	if _, err = a.insert(ctx, "backups", M{"uuid": newUUID(), "server_id": s["id"], "name": "Background backup"}); err != nil {
		t.Fatal(err)
	}
	for _, c := range []*websocket.Conn{owner, reader} {
		liveRead(t, c, func(m M) bool { return m["path"] == paths[1] && strings.Contains(str(m["data"]), "Background backup") })
	}
	if err = a.exec(ctx, "DELETE FROM subusers WHERE user_id=$1", viewer["id"]); err != nil {
		t.Fatal(err)
	}
	liveRead(t, reader, func(m M) bool { return num(m["status"]) == 403 })
}
