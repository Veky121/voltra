package panel

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type wave142CommitCancel struct{ cancel context.CancelFunc }

func (c *wave142CommitCancel) TraceQueryStart(ctx context.Context, _ *pgx.Conn, d pgx.TraceQueryStartData) context.Context {
	return context.WithValue(ctx, c, d.SQL)
}
func (c *wave142CommitCancel) TraceQueryEnd(ctx context.Context, _ *pgx.Conn, d pgx.TraceQueryEndData) {
	if ctx.Value(c) == "commit" && d.Err == nil && c.cancel != nil {
		c.cancel()
		c.cancel = nil
	}
}

func TestWave142CreateCompensation(t *testing.T) {
	cfg, e := pgxpool.ParseConfig(os.Getenv("TEST_DATABASE_URL"))
	if e != nil || cfg.ConnConfig.Host != "127.0.0.1" || cfg.ConnConfig.Port != 55439 {
		t.Fatal("requires private loopback55439")
	}
	for _, mode := range []string{"clean", "first", "second", "commit", "cancel"} {
		t.Run(mode, func(t *testing.T) {
			var schemaName string
			t.Cleanup(func() {
				p, e := pgxpool.NewWithConfig(context.Background(), cfg)
				if e != nil {
					t.Fatal("cleanup verification connection failed")
				}
				defer p.Close()
				var exists bool
				if e = p.QueryRow(context.Background(), "SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname=$1)", schemaName).Scan(&exists); e != nil || exists {
					t.Error("schema cleanup failed")
				} else {
					t.Log("schema removed", schemaName)
				}
			})
			a, _, admin, server, _ := quickSetupMinecraftFixture(t)
			ctx := context.Background()
			if e := a.DB.QueryRow(ctx, "SELECT current_schema()").Scan(&schemaName); e != nil {
				t.Fatal(e)
			}
			if _, e := a.update(ctx, "eggs", num(server["egg_id"]), M{"uuid": newUUID(), "java_config": M{}, "startup": "echo fixture"}); e != nil {
				t.Fatal(e)
			}
			if _, e := a.DB.Exec(ctx, "DELETE FROM egg_variables WHERE egg_id=$1", server["egg_id"]); e != nil {
				t.Fatal(e)
			}
			var requests int
			wings := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { requests++; w.WriteHeader(503) }))
			defer wings.Close()
			node := daemonTestNode(t, wings)
			token, e := a.seal("fixture-token")
			if e != nil {
				t.Fatal(e)
			}
			node["daemon_token"] = token
			if _, e := a.update(ctx, "nodes", num(server["node_id"]), node); e != nil {
				t.Fatal(e)
			}
			alloc, e := a.insert(ctx, "allocations", M{"node_id": server["node_id"], "ip": "127.0.0.1", "port": 29911})
			if e != nil {
				t.Fatal(e)
			}
			// Real PostgreSQL refusal at each statement and at deferred commit.
			sql := ""
			switch mode {
			case "first":
				sql = `CREATE FUNCTION refuse_cleanup() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.server_id IS NULL THEN RAISE EXCEPTION 'fixture-private-detail'; END IF; RETURN NEW; END $$; CREATE TRIGGER refuse_cleanup BEFORE UPDATE ON allocations FOR EACH ROW EXECUTE FUNCTION refuse_cleanup()`
			case "second":
				sql = `CREATE FUNCTION refuse_cleanup() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture-private-detail'; END $$; CREATE TRIGGER refuse_cleanup BEFORE DELETE ON servers FOR EACH ROW EXECUTE FUNCTION refuse_cleanup()`
			case "commit":
				sql = `CREATE FUNCTION refuse_cleanup() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture-private-detail'; END $$; CREATE CONSTRAINT TRIGGER refuse_cleanup AFTER DELETE ON servers DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION refuse_cleanup()`
			}
			if sql != "" {
				if _, e := a.DB.Exec(ctx, sql); e != nil {
					t.Fatal(e)
				}
			}
			requestCtx, cancel := context.WithCancel(ctx)
			defer cancel()
			if mode == "cancel" {
				pc := a.DB.Config()
				pc.ConnConfig.Tracer = &wave142CommitCancel{cancel: cancel}
				p, e := pgxpool.NewWithConfig(ctx, pc)
				if e != nil {
					t.Fatal(e)
				}
				a.DB = p
				t.Cleanup(p.Close)
			}
			_, err := a.createServer(requestCtx, M{"name": "wave142", "user": admin, "egg": server["egg_id"], "docker_image": "fixture/java", "startup": "echo fixture", "environment": M{}, "allocation": M{"default": alloc["id"]}, "limits": M{"memory": 128, "disk": 128, "io": 500, "cpu": 100, "swap": 0}})
			if err == nil {
				t.Fatal("expected refusal")
			}
			var count, assigned int
			if e := a.DB.QueryRow(ctx, "SELECT count(*) FROM servers WHERE name='wave142'").Scan(&count); e != nil {
				t.Fatal(e)
			}
			if e := a.DB.QueryRow(ctx, "SELECT count(*) FROM allocations WHERE id=$1 AND server_id IS NOT NULL", alloc["id"]).Scan(&assigned); e != nil {
				t.Fatal(e)
			}
			want := 0
			if mode == "first" || mode == "second" || mode == "commit" {
				want = 1
			}
			if count != want || assigned != want {
				t.Fatalf("residual server=%d allocation=%d want=%d error=%v", count, assigned, want, err)
			}
			if mode == "cancel" {
				if requests != 0 || !errors.Is(err, context.Canceled) {
					t.Fatalf("cancel causal error or zero Wings violated: %v requests=%d", err, requests)
				}
			} else {
				if requests != 1 {
					t.Fatalf("Wings requests=%d error=%v", requests, err)
				}
				if !strings.Contains(err.Error(), "uncertain") {
					t.Fatal("missing daemon uncertainty")
				}
			}
			if want == 1 && !strings.Contains(err.Error(), "residual state") {
				t.Fatal("missing residual identity")
			}
			if strings.Contains(err.Error(), "fixture-private-detail") {
				t.Fatal("private error leaked")
			}
			deadline := time.Now().Add(time.Second)
			for a.DB.Stat().AcquiredConns() != 0 && time.Now().Before(deadline) {
				time.Sleep(time.Millisecond)
			}
			if a.DB.Stat().AcquiredConns() != 0 {
				t.Fatal("connection leak")
			}
			t.Logf("mode=%s residual_servers=%d assigned=%d Wings=%d acquired=0", mode, count, assigned, requests)
		})
	}
}

func TestWave142CompensationBeginFailure(t *testing.T) {
	cause := errors.New("original-private")
	cleanup := errors.New("private-begin")
	err := compensateCreateServer(func(ctx context.Context) (pgx.Tx, error) {
		if ctx.Err() != nil {
			t.Fatal("cleanup inherited cancellation")
		}
		return nil, cleanup
	}, 42, cause, false)
	response := httptest.NewRecorder()
	fail(response, err)
	if response.Code != 502 || strings.Contains(response.Body.String(), "private") || !strings.Contains(response.Body.String(), "server 42") {
		t.Fatal("unsafe API compensation response")
	}
	if !errors.Is(err, cause) || !errors.Is(err, cleanup) || !strings.Contains(err.Error(), "server 42") || strings.Contains(err.Error(), "private") {
		t.Fatal("unsafe or lost causal error")
	}
}
