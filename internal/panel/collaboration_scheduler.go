package panel

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strconv"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

const collabScheduleActionTimeout = 10 * time.Second
const collabScheduleWorkers = 8

// One queue per node prevents a slow node from occupying every worker. Each
// finite queue is useful to callers with an already selected set of jobs.
func collabSchedulePool(ctx context.Context, jobs []M, run func(context.Context, int64)) {
	pending := append([]M(nil), jobs...)
	active := map[int64]bool{}
	done := make(chan int64, collabScheduleWorkers)
	count := 0
	for len(pending) > 0 || count > 0 {
		for ctx.Err() == nil && count < collabScheduleWorkers {
			index := -1
			for i, j := range pending {
				if !active[num(j["node_id"])] {
					index = i
					break
				}
			}
			if index < 0 {
				break
			}
			job := pending[index]
			pending = append(pending[:index], pending[index+1:]...)
			node := num(job["node_id"])
			active[node] = true
			count++
			go func() { defer func() { done <- node }(); run(ctx, num(job["id"])) }()
		}
		if count == 0 {
			return
		}
		node := <-done
		delete(active, node)
		count--
		if ctx.Err() != nil {
			pending = nil
		}
	}
}

// A backup holds the run transaction and an operations transaction while making
// another pool query. Reserve those three connections per worker plus one for
// API/dispatcher work. Pools below four defer scheduling instead of deadlocking.
func collabSchedulerWorkerLimit(max int32) int {
	n := int((max - 1) / 3)
	if n < 0 {
		return 0
	}
	if n > collabScheduleWorkers {
		return collabScheduleWorkers
	}
	return n
}

func collabSchedulerFailure(operation string, err error) {
	code := "database_error"
	var pgerr *pgconn.PgError
	if errors.As(err, &pgerr) {
		code = pgerr.Code
	} else if errors.Is(err, context.DeadlineExceeded) {
		code = "deadline_exceeded"
	}
	// Never include database messages, SQL, connection strings or daemon payloads.
	slog.Error("schedule scheduler operation failed", "operation", operation, "code", code)
}

func (a *App) collabSchedulerBatch(ctx context.Context) {
	workers := collabSchedulerWorkerLimit(a.DB.Config().MaxConns)
	if workers == 0 {
		slog.Warn("schedule scheduler requires at least four pool connections")
		return
	}
	active := map[int64]bool{}
	seen := make([]int64, 0)
	// Prefer nodes that have waited longest for a worker, even with a pool small
	// enough to allow only one worker.
	served := make([]int64, 0)
	type result struct {
		node, id int64
		claimed  bool
	}
	done := make(chan result, workers)
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	defer func() {
		for len(active) > 0 {
			delete(active, (<-done).node)
		}
	}()
	epochEnd := time.Now().Add(time.Minute)
	for ctx.Err() == nil && time.Now().Before(epochEnd) {
		excluded := make([]int64, 0, len(active))
		for node := range active {
			excluded = append(excluded, node)
		}
		jobs, err := a.query(ctx, `SELECT id,node_id FROM (
   SELECT DISTINCT ON (s.node_id) r.id,s.node_id,r.run_after
   FROM schedule_runs r JOIN servers s ON s.id=r.server_id
   WHERE r.status IN ('pending','running') AND r.run_after<=now()
   AND NOT (s.node_id=ANY($1::bigint[])) AND NOT (r.id=ANY($2::bigint[]))
   ORDER BY s.node_id,r.run_after,r.id
  ) candidates ORDER BY array_position($4::bigint[],node_id) NULLS FIRST,run_after,id LIMIT $3`, excluded, seen, workers-len(active), served)
		if err != nil {
			if ctx.Err() == nil {
				collabSchedulerFailure("candidates", err)
			}
			return
		}
		for _, job := range jobs {
			node, id := num(job["node_id"]), num(job["id"])
			active[node] = true
			for i, n := range served {
				if n == node {
					served = append(served[:i], served[i+1:]...)
					break
				}
			}
			served = append(served, node)
			go func() {
				claimed, err := a.collabSchedulerRun(ctx, id)
				if err != nil && ctx.Err() == nil {
					collabSchedulerFailure("worker", err)
				}
				done <- result{node: node, id: id, claimed: claimed && err == nil}
			}()
		}
		if len(active) == 0 {
			return
		}
		select {
		case finished := <-done:
			delete(active, finished.node)
			if !finished.claimed {
				seen = append(seen, finished.id)
			}
		case <-ticker.C:
		case <-ctx.Done():
			return
		}
	}
}

// Drain bounded statements for up to two seconds. A full final batch requests a
// prompt continuation, including when the budget expires between statements.
func (a *App) collabPruneScheduleRunsPass(ctx context.Context) (bool, error) {
	settingsCtx, settingsCancel := context.WithTimeout(ctx, 250*time.Millisecond)
	var setting any
	err := a.DB.QueryRow(settingsCtx, "SELECT value FROM settings WHERE key='schedules:run_retention_days'").Scan(&setting)
	settingsCancel()
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return true, err
	}
	if errors.Is(err, pgx.ErrNoRows) {
		setting = int64(30)
	}
	days, parseErr := strconv.ParseInt(fmt.Sprint(setting), 10, 64)
	if parseErr != nil || days < 0 || days > 3650 {
		days = 30
	}
	if days == 0 {
		return false, nil
	}
	deadline := time.Now().Add(2 * time.Second)
	for {
		queryCtx, cancel := context.WithTimeout(ctx, 250*time.Millisecond)
		tag, err := a.DB.Exec(queryCtx, `DELETE FROM schedule_runs WHERE id IN (
   SELECT id FROM schedule_runs WHERE status IN ('completed','failed')
   AND updated_at<now()-make_interval(days=>$1::int)
   ORDER BY updated_at,id LIMIT 100 FOR UPDATE SKIP LOCKED)`, days)
		cancel()
		if err != nil {
			return true, err
		}
		if tag.RowsAffected() < 100 {
			checkCtx, checkCancel := context.WithTimeout(ctx, 250*time.Millisecond)
			var more bool
			err := a.DB.QueryRow(checkCtx, `SELECT EXISTS(SELECT 1 FROM schedule_runs WHERE status IN ('completed','failed') AND updated_at<now()-make_interval(days=>$1::int))`, days).Scan(&more)
			checkCancel()
			return more, err
		}
		if time.Now().After(deadline) {
			return true, nil
		}
	}
}

func (a *App) collabPruneScheduleRuns(ctx context.Context) error {
	_, err := a.collabPruneScheduleRunsPass(ctx)
	return err
}

func (a *App) collabScheduleCleanup(ctx context.Context, wg *sync.WaitGroup) {
	defer wg.Done()
	for ctx.Err() == nil {
		more, err := a.collabPruneScheduleRunsPass(ctx)
		if err != nil && ctx.Err() == nil {
			collabSchedulerFailure("retention", err)
		}
		delay := time.Hour
		if more || err != nil {
			delay = time.Second
		}
		timer := time.NewTimer(delay)
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
		}
	}
}
