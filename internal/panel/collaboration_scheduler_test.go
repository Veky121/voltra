package panel

import (
	"bytes"
	"context"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestCollabSchedulePoolSlowNodeAndCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	slow := make(chan struct{})
	healthy := make(chan struct{})
	done := make(chan struct{})
	jobs := []M{{"id": int64(1), "node_id": int64(1)}, {"id": int64(2), "node_id": int64(1)}, {"id": int64(3), "node_id": int64(2)}}
	go func() {
		collabSchedulePool(ctx, jobs, func(ctx context.Context, id int64) {
			switch id {
			case 1:
				close(slow)
				<-ctx.Done()
			case 2:
				t.Error("cancelled queued work ran")
			case 3:
				<-slow
				close(healthy)
			}
		})
		close(done)
	}()
	select {
	case <-healthy:
	case <-time.After(time.Second):
		t.Fatal("healthy node blocked by slow node")
	}
	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("pool did not stop")
	}
}

func TestCollabSchedulePoolBoundsAndOrder(t *testing.T) {
	var mu sync.Mutex
	active, max := 0, 0
	nodes := map[int64]bool{}
	last := map[int64]int64{}
	jobs := []M{}
	for round := int64(0); round < 3; round++ {
		for node := int64(1); node <= 20; node++ {
			jobs = append(jobs, M{"id": round*20 + node, "node_id": node})
		}
	}
	collabSchedulePool(context.Background(), jobs, func(_ context.Context, id int64) {
		node := (id-1)%20 + 1
		mu.Lock()
		if nodes[node] || last[node] >= id {
			t.Error("same node overlap or ordering violation")
		}
		nodes[node] = true
		active++
		if active > max {
			max = active
		}
		mu.Unlock()
		time.Sleep(time.Millisecond)
		mu.Lock()
		active--
		nodes[node] = false
		last[node] = id
		mu.Unlock()
	})
	if max > collabScheduleWorkers || max < 2 {
		t.Fatalf("worker concurrency %d", max)
	}
}

func TestCollabSchedulerSlowAndHealthyNodes(t *testing.T) {
	a, ctx := collabTestApp(t)
	started, release, healthy := make(chan struct{}), make(chan struct{}), make(chan struct{}, 3)
	var startOnce sync.Once
	slow := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		startOnce.Do(func() { close(started) })
		<-release
		w.WriteHeader(204)
	}))
	defer slow.Close()
	fast := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { healthy <- struct{}{}; w.WriteHeader(204) }))
	defer fast.Close()
	_, server := collabFixture(t, a, ctx, slow.URL)
	node, e := a.one(ctx, "SELECT * FROM nodes WHERE id=$1", server["node_id"])
	if e != nil {
		t.Fatal(e)
	}
	delete(node, "id")
	node["uuid"] = newUUID()
	node["daemon_token_id"] = newUUID()
	host, port, _ := net.SplitHostPort(strings.TrimPrefix(fast.URL, "http://"))
	node["fqdn"] = host
	node["daemon_listen"], _ = strconv.Atoi(port)
	node, e = a.insert(ctx, "nodes", node)
	if e != nil {
		t.Fatal(e)
	}
	second := M{}
	for k, v := range server {
		second[k] = v
	}
	delete(second, "id")
	second["uuid"] = newUUID()
	second["uuid_short"] = str(second["uuid"])[:8]
	second["identifier"] = second["uuid_short"]
	second["node_id"] = node["id"]
	second, e = a.insert(ctx, "servers", second)
	if e != nil {
		t.Fatal(e)
	}
	// More than the former global snapshot limit on the slow node. Populate in
	// one statement so remote database latency does not dominate the test.
	if e = a.exec(ctx, `WITH inserted AS (
 INSERT INTO schedules(server_id,name,is_processing)
 SELECT CASE WHEN n<=101 THEN $1::bigint ELSE $2::bigint END,'concurrency',true
 FROM generate_series(1,102) n RETURNING id,server_id
 ), tasks_added AS (
 INSERT INTO tasks(schedule_id,sequence_id,action,payload)
 SELECT id,seq,'command','test' FROM inserted CROSS JOIN LATERAL
 generate_series(1,CASE WHEN server_id=$2::bigint THEN 3 ELSE 1 END) seq
 RETURNING id,schedule_id,sequence_id
 ) INSERT INTO schedule_runs(schedule_id,server_id,task_id,status,manual,run_after)
 SELECT s.id,s.server_id,t.id,'pending',true,now()+s.id*interval '1 microsecond'-interval '1 second'
 FROM inserted s JOIN tasks_added t ON t.schedule_id=s.id WHERE t.sequence_id=1`, server["id"], second["id"]); e != nil {
		t.Fatal(e)
	}
	done := make(chan struct{})
	batchCtx, stopBatch := context.WithCancel(ctx)
	defer stopBatch()
	go func() { a.collabSchedulerBatch(batchCtx); close(done) }()
	select {
	case <-started:
	case <-time.After(15 * time.Second):
		close(release)
		t.Fatal("slow node not started")
	}
	for i := 0; i < 3; i++ {
		select {
		case <-healthy:
		case <-time.After(15 * time.Second):
			close(release)
			<-done
			t.Fatal("healthy node waited for slow node")
		}
	}
	stopBatch()
	close(release)
	<-done
}

func TestCollabScheduleRetentionBoundedAndActivePreserved(t *testing.T) {
	a, ctx := collabTestApp(t)
	_, s := collabFixture(t, a, ctx, "http://127.0.0.1:1")
	schedule, e := a.insert(ctx, "schedules", M{"server_id": s["id"], "name": "retention"})
	if e != nil {
		t.Fatal(e)
	}
	if e = a.exec(ctx, `INSERT INTO schedule_runs(schedule_id,server_id,status,updated_at)
 SELECT $1,$2,'completed',now()-interval '40 days' FROM generate_series(1,3105)`, schedule["id"], s["id"]); e != nil {
		t.Fatal(e)
	}
	if e = a.exec(ctx, `INSERT INTO schedule_runs(schedule_id,server_id,status,updated_at) VALUES($1,$2,'pending',now()-interval '40 days'),($1,$2,'failed',now())`, schedule["id"], s["id"]); e != nil {
		t.Fatal(e)
	}
	for i := 0; i < 100; i++ {
		more, err := a.collabPruneScheduleRunsPass(ctx)
		if err != nil {
			t.Fatal(err)
		}
		if !more {
			break
		}
		if i == 99 {
			t.Fatal("retention backlog did not drain")
		}
	}
	row, e := a.one(ctx, `SELECT count(*) AS total,count(*) FILTER(WHERE status='pending') AS active FROM schedule_runs`)
	if e != nil {
		t.Fatal(e)
	}
	if num(row["total"]) != 2 || num(row["active"]) != 1 {
		t.Fatalf("retention removed wrong rows: %v", row)
	}
	// A skipped locked terminal row must request continuation rather than wait
	// for the hourly cadence once its lock clears.
	expired, e := a.insert(ctx, "schedule_runs", M{"schedule_id": schedule["id"], "server_id": s["id"], "status": "completed", "updated_at": time.Now().Add(-40 * 24 * time.Hour)})
	if e != nil {
		t.Fatal(e)
	}
	// Warm both sessions before applying the deliberately short cleanup deadline
	// over the remote tunnel.
	warm1, e := a.DB.Acquire(ctx)
	if e != nil {
		t.Fatal(e)
	}
	warm2, e := a.DB.Acquire(ctx)
	if e != nil {
		warm1.Release()
		t.Fatal(e)
	}
	warm2.Release()
	warm1.Release()
	lock, e := a.DB.Begin(ctx)
	if e != nil {
		t.Fatal(e)
	}
	defer lock.Rollback(ctx)
	if _, e = lock.Exec(ctx, "SELECT id FROM schedule_runs WHERE id=$1 FOR UPDATE", expired["id"]); e != nil {
		t.Fatal(e)
	}
	if more, e := a.collabPruneScheduleRunsPass(ctx); e != nil || !more {
		t.Fatalf("locked backlog continuation: %v %v", more, e)
	}
	if e = lock.Rollback(ctx); e != nil {
		t.Fatal(e)
	}
	if more, e := a.collabPruneScheduleRunsPass(ctx); e != nil || more {
		t.Fatalf("unlocked backlog drain: %v %v", more, e)
	}
	if e = a.exec(ctx, `INSERT INTO settings(key,value) VALUES('schedules:run_retention_days','0')`); e != nil {
		t.Fatal(e)
	}
	if e = a.collabPruneScheduleRuns(ctx); e != nil {
		t.Fatal(e)
	}
	row, e = a.one(ctx, "SELECT count(*) AS total FROM schedule_runs")
	if e != nil || num(row["total"]) != 2 {
		t.Fatalf("disabled retention: %v %v", row, e)
	}
}

func TestCollabSchedulerActionDeadlinePersistsFailure(t *testing.T) {
	a, ctx := collabTestApp(t)
	a.HTTP = &http.Client{} // Exercise the scheduler deadline rather than client timeout.
	release := make(chan struct{})
	daemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-r.Context().Done():
		case <-release:
		}
	}))
	defer daemon.Close()
	defer close(release)
	_, s := collabFixture(t, a, ctx, daemon.URL)
	schedule, e := a.insert(ctx, "schedules", M{"server_id": s["id"], "name": "deadline"})
	if e != nil {
		t.Fatal(e)
	}
	if _, e = a.insert(ctx, "tasks", M{"schedule_id": schedule["id"], "sequence_id": 1, "action": "command", "payload": "wait"}); e != nil {
		t.Fatal(e)
	}
	if e = a.collabQueueSchedule(ctx, num(schedule["id"]), true); e != nil {
		t.Fatal(e)
	}
	started := time.Now()
	if ran, e := a.collabSchedulerStep(ctx); e != nil || !ran {
		t.Fatalf("deadline action: %v %v", ran, e)
	}
	if elapsed := time.Since(started); elapsed < collabScheduleActionTimeout || elapsed > collabScheduleActionTimeout+3*time.Second {
		t.Fatalf("action deadline elapsed %s", elapsed)
	}
	row, e := a.one(ctx, "SELECT status,last_error FROM schedule_runs WHERE schedule_id=$1", schedule["id"])
	if e != nil || str(row["status"]) != "failed" || str(row["last_error"]) == "" {
		t.Fatalf("deadline failure not committed: %v %v", row, e)
	}
}

func TestCollabSchedulerSmallPoolBackup(t *testing.T) {
	a, ctx := collabTestApp(t)
	daemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(204) }))
	defer daemon.Close()
	_, s := collabFixture(t, a, ctx, daemon.URL)
	cfg := a.DB.Config().Copy()
	cfg.MaxConns = 4
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	a.DB = pool
	node, err := a.one(ctx, "SELECT * FROM nodes WHERE id=$1", s["node_id"])
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 4; i++ {
		server := M{}
		for k, v := range s {
			server[k] = v
		}
		if i > 0 {
			clone := M{}
			for k, v := range node {
				clone[k] = v
			}
			delete(clone, "id")
			clone["uuid"] = newUUID()
			clone["daemon_token_id"] = newUUID()
			newNode, e := a.insert(ctx, "nodes", clone)
			if e != nil {
				t.Fatal(e)
			}
			delete(server, "id")
			server["uuid"] = newUUID()
			server["uuid_short"] = str(server["uuid"])[:8]
			server["identifier"] = server["uuid_short"]
			server["node_id"] = newNode["id"]
			server, e = a.insert(ctx, "servers", server)
			if e != nil {
				t.Fatal(e)
			}
		}
		schedule, err := a.insert(ctx, "schedules", M{"server_id": server["id"], "name": "small pool"})
		if err != nil {
			t.Fatal(err)
		}
		if _, err = a.insert(ctx, "tasks", M{"schedule_id": schedule["id"], "sequence_id": 1, "action": "backup", "payload": ""}); err != nil {
			t.Fatal(err)
		}
		if err = a.collabQueueSchedule(ctx, num(schedule["id"]), true); err != nil {
			t.Fatal(err)
		}
	}
	runCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	a.collabSchedulerBatch(runCtx)
	row, err := a.one(ctx, "SELECT count(*) AS n FROM schedule_runs WHERE status='completed'")
	if err != nil || num(row["n"]) != 4 {
		t.Fatalf("small pool backups: %v %v", row, err)
	}
}

func TestCollabSchedulerWorkerBudget(t *testing.T) {
	for _, tc := range []struct {
		max  int32
		want int
	}{{1, 0}, {2, 0}, {3, 0}, {4, 1}, {7, 2}, {25, 8}, {100, 8}} {
		if got := collabSchedulerWorkerLimit(tc.max); got != tc.want {
			t.Fatalf("max %d: got %d want %d", tc.max, got, tc.want)
		}
	}
}

func TestCollabSchedulerFailureSanitized(t *testing.T) {
	var output bytes.Buffer
	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&output, nil)))
	defer slog.SetDefault(previous)
	collabSchedulerFailure("retention", &pgconn.PgError{Code: "42501", Message: "secret connection/password", Detail: "private SQL"})
	text := output.String()
	if !strings.Contains(text, "retention") || !strings.Contains(text, "42501") || strings.Contains(text, "secret") || strings.Contains(text, "private") {
		t.Fatalf("unsafe or missing diagnostic: %s", text)
	}
}
