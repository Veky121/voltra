package panel

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type performanceQueryCounter struct {
	queries atomic.Int64
	mu      sync.Mutex
	bySQL   map[string]int64
}

func (p *performanceQueryCounter) TraceQueryStart(ctx context.Context, _ *pgx.Conn, data pgx.TraceQueryStartData) context.Context {
	p.queries.Add(1)
	p.mu.Lock()
	if p.bySQL == nil {
		p.bySQL = map[string]int64{}
	}
	p.bySQL[data.SQL]++
	p.mu.Unlock()
	return ctx
}
func (*performanceQueryCounter) TraceQueryEnd(context.Context, *pgx.Conn, pgx.TraceQueryEndData) {}

// Opt-in: real PostgreSQL in an automatically cleaned schema, controlled HTTP
// Wings responder. Does not contact Docker, Wings, or a running panel.
func TestPanelPerformanceBaseline(t *testing.T) {
	if os.Getenv("PANEL_PERF_TEST") != "1" {
		t.Skip("set PANEL_PERF_TEST=1 and TEST_DATABASE_URL")
	}
	a, ctx := collabTestApp(t)
	var delay atomic.Int64
	var calls atomic.Int64
	wings := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		select {
		case <-time.After(time.Duration(delay.Load()) * time.Millisecond):
		case <-r.Context().Done():
			return
		}
		writeJSON(w, 200, M{"state": "running", "utilization": M{"memory_bytes": 1234, "network": M{"rx_bytes": 1, "tx_bytes": 2}}})
	}))
	defer wings.Close()
	u, s := collabFixture(t, a, ctx, wings.URL)
	allocation, err := a.insert(ctx, "allocations", M{"node_id": s["node_id"], "server_id": s["id"], "ip": "127.0.0.1", "port": 25565})
	if err != nil {
		t.Fatal(err)
	}
	if err = a.exec(ctx, "UPDATE servers SET allocation_id=$1 WHERE id=$2", allocation["id"], s["id"]); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 29; i++ {
		id := newUUID()
		_, err = a.insert(ctx, "servers", M{"uuid": id, "uuid_short": id[:8], "identifier": id[:8], "name": fmt.Sprintf("fixture-%02d", i), "owner_id": u["id"], "node_id": s["node_id"], "nest_id": s["nest_id"], "egg_id": s["egg_id"], "image": "fixture", "allocation_id": allocation["id"]})
		if err != nil {
			t.Fatal(err)
		}
	}
	counter := &performanceQueryCounter{}
	cfg := a.DB.Config()
	// Match New: production avoids stale prepared SELECT * descriptions during
	// additive online migrations. Fixture helpers otherwise use pgx defaults.
	cfg.ConnConfig.DefaultQueryExecMode = pgx.QueryExecModeDescribeExec
	cfg.ConnConfig.Tracer = counter
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	a.DB = pool
	a.Config.DevMode = true
	a.Config.DevUserID = num(u["id"])
	a.Config.PublicURL = "http://127.0.0.1"
	server := httptest.NewServer(a.Handler())
	defer server.Close()
	client := server.Client()
	client.Timeout = 10 * time.Second
	type result struct {
		Path          string             `json:"path"`
		Concurrency   int                `json:"concurrency"`
		Delay         int64              `json:"controlled_wings_delay_ms"`
		Requests      int                `json:"requests"`
		Errors        int64              `json:"errors"`
		P50           float64            `json:"p50_ms"`
		P95           float64            `json:"p95_ms"`
		P99           float64            `json:"p99_ms"`
		QPR           float64            `json:"sql_queries_per_request"`
		WingsCalls    int64              `json:"wings_calls"`
		AcquireWaitMS float64            `json:"pool_acquire_duration_ms"`
		Queries       map[string]float64 `json:"sql_calls_per_request,omitempty"`
	}
	results := []result{}
	paths := []string{"/healthz", "/api/client/account", "/api/client?summary=overview", "/api/client", "/api/client/servers/" + str(s["uuid_short"]), "/api/client/servers/" + str(s["uuid_short"]) + "/resources"}
	for _, path := range paths {
		for _, latency := range []int64{0, 100} {
			if latency > 0 && path != paths[len(paths)-1] {
				continue
			}
			delay.Store(latency)
			for _, concurrency := range []int{1, 8} {
				for i := 0; i < 4; i++ {
					res, e := client.Get(server.URL + path)
					if e != nil {
						t.Fatal(e)
					}
					io.Copy(io.Discard, res.Body)
					res.Body.Close()
					if res.StatusCode != 200 {
						t.Fatalf("warmup %s: %d", path, res.StatusCode)
					}
				}
				before := counter.queries.Load()
				counter.mu.Lock()
				beforeSQL := map[string]int64{}
				for sql, n := range counter.bySQL {
					beforeSQL[sql] = n
				}
				counter.mu.Unlock()
				beforeCalls := calls.Load()
				beforePool := pool.Stat().AcquireDuration()
				var index, failures atomic.Int64
				var mu sync.Mutex
				durations := []float64{}
				var workers sync.WaitGroup
				for i := 0; i < concurrency; i++ {
					workers.Add(1)
					go func() {
						defer workers.Done()
						for index.Add(1) <= 32 {
							start := time.Now()
							res, e := client.Get(server.URL + path)
							if e != nil {
								failures.Add(1)
							} else {
								_, e = io.Copy(io.Discard, res.Body)
								res.Body.Close()
								if e != nil || res.StatusCode != 200 {
									failures.Add(1)
								}
							}
							ms := float64(time.Since(start)) / float64(time.Millisecond)
							mu.Lock()
							durations = append(durations, ms)
							mu.Unlock()
						}
					}()
				}
				workers.Wait()
				sort.Float64s(durations)
				r := result{Path: path, Concurrency: concurrency, Delay: latency, Requests: len(durations), Errors: failures.Load(), P50: durations[15], P95: durations[30], P99: durations[31], QPR: float64(counter.queries.Load()-before) / 32, WingsCalls: calls.Load() - beforeCalls, AcquireWaitMS: float64(pool.Stat().AcquireDuration()-beforePool) / float64(time.Millisecond)}
				if path == "/api/client" {
					r.Queries = map[string]float64{}
					counter.mu.Lock()
					for sql, n := range counter.bySQL {
						if delta := n - beforeSQL[sql]; delta > 0 {
							r.Queries[sql] = float64(delta) / 32
						}
					}
					counter.mu.Unlock()
				}
				results = append(results, r)
				t.Logf("%s c=%d wings=%dms p95=%.2fms queries/request=%.1f errors=%d", path, concurrency, latency, r.P95, r.QPR, r.Errors)
				if r.Errors != 0 {
					t.Errorf("request failures: %+v", r)
				}
			}
		}
	}
	report := M{"tested_at": time.Now().UTC(), "scope": "30 synthetic servers; real isolated PostgreSQL; controlled HTTP Wings responder; 32 warm requests per case; not production capacity or real Docker/Wings performance", "query_exec_mode": "describe_exec", "pool_max_conns": cfg.MaxConns, "results": results}
	if path := os.Getenv("PANEL_PERF_REPORT"); path != "" {
		body, e := json.MarshalIndent(report, "", "  ")
		if e != nil {
			t.Fatal(e)
		}
		if e = os.MkdirAll(filepath.Dir(path), 0755); e != nil {
			t.Fatal(e)
		}
		if e = os.WriteFile(path, body, 0644); e != nil {
			t.Fatal(e)
		}
	}
}
