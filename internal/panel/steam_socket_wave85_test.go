package panel

import (
	"context"
	"encoding/json"
	"github.com/gorilla/websocket"
	"github.com/jackc/pgx/v5/pgxpool"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"runtime"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestWave85UnmanagedSocketPower(t *testing.T) {
	cfg, err := pgxpool.ParseConfig(os.Getenv("TEST_DATABASE_URL"))
	if err != nil || cfg.ConnConfig.Host != "127.0.0.1" || cfg.ConnConfig.Port != 55439 {
		t.Fatal("requires isolated local PostgreSQL 55439")
	}
	for _, action := range []string{"start", "restart"} {
		for _, change := range []string{"none", "revoke", "suspend", "maintenance", "disabled", "disabled_owner", "transfer", "missing"} {
			t.Run(action+"/"+change, func(t *testing.T) {
				var ownedSchema string
				t.Cleanup(func() {
					pool, e := pgxpool.New(context.Background(), os.Getenv("TEST_DATABASE_URL"))
					if e != nil {
						t.Error(e)
						return
					}
					defer pool.Close()
					var exists bool
					e = pool.QueryRow(context.Background(), "SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname=$1)", ownedSchema).Scan(&exists)
					if e != nil || exists {
						t.Errorf("owned schema cleanup failed: %v exists=%v", e, exists)
					}
				})
				a, _, owner := pairingTestApp(t)
				ownedSchema = a.DB.Config().ConnConfig.RuntimeParams["search_path"]
				ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
				defer cancel()
				var posts, frames atomic.Int32
				received := make(chan string, 8)
				up := websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}
				wings := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					if strings.HasSuffix(r.URL.Path, "/ws") {
						c, e := up.Upgrade(w, r, nil)
						if e != nil {
							return
						}
						defer c.Close()
						for {
							_, b, e := c.ReadMessage()
							if e != nil {
								return
							}
							frames.Add(1)
							received <- string(b)
						}
					}
					if strings.HasSuffix(r.URL.Path, "/power") {
						var body M
						_ = json.NewDecoder(r.Body).Decode(&body)
						if str(body["action"]) != action {
							t.Errorf("wrong action")
						}
						posts.Add(1)
						w.WriteHeader(204)
						return
					}
					t.Errorf("unexpected Wings request %s", r.URL.Path)
					w.WriteHeader(404)
				}))
				defer wings.Close()
				insert := func(table string, m M) M {
					v, e := a.insert(ctx, table, m)
					if e != nil {
						t.Fatal(e)
					}
					return v
				}
				host, p, _ := net.SplitHostPort(strings.TrimPrefix(wings.URL, "http://"))
				port, _ := strconv.Atoi(p)
				loc := insert("locations", M{"short": "wave85"})
				token, e := a.seal("private-mock-token")
				if e != nil {
					t.Fatal(e)
				}
				node := insert("nodes", M{"uuid": newUUID(), "name": "mock", "location_id": loc["id"], "fqdn": host, "daemon_listen": port, "daemon_token": token, "daemon_token_id": "mock"})
				nest := insert("nests", M{"uuid": newUUID(), "name": "Terraria", "author": "test@example.invalid"})
				var canonical M
				for _, entry := range gameTemplates().Entries {
					if entry.Path == "terraria/vanilla/egg-terraria-vanilla.json" {
						canonical = entry.Egg
					}
				}
				if canonical == nil {
					t.Fatal("canonical Terraria missing")
				}
				egg := insert("eggs", M{"uuid": newUUID(), "nest_id": nest["id"], "name": canonical["name"], "author": "test@example.invalid", "startup": canonical["startup"]})
				id := newUUID()
				server := insert("servers", M{"uuid": id, "uuid_short": id[:8], "identifier": id[:8], "name": "Terraria", "owner_id": owner, "node_id": node["id"], "nest_id": nest["id"], "egg_id": egg["id"], "image": "test:local"})
				user := insert("users", M{"uuid": newUUID(), "username": "socket", "email": "socket@example.invalid"})
				perms := []string{"websocket.connect", "control.console", "control." + action}
				if change == "missing" {
					perms = []string{"websocket.connect", "control.console", "control.stop"}
				}
				insert("subusers", M{"user_id": user["id"], "server_id": server["id"], "permissions": perms})
				panel := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					r.SetPathValue("server", id)
					a.clientSocketProxy(w, WithUser(r, num(user["id"])))
				}))
				defer panel.Close()
				c, _, e := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(panel.URL, "http")+"/ws", nil)
				if e != nil {
					t.Fatal(e)
				}
				defer c.Close()
				_ = c.SetReadDeadline(time.Now().Add(12 * time.Second))
				lock, e := a.DB.Begin(ctx)
				if e != nil {
					t.Fatal(e)
				}
				defer lock.Rollback(context.Background())
				_, e = lock.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "voltra:server-mutation:"+id)
				if e != nil {
					t.Fatal(e)
				}
				if e = c.WriteJSON(M{"event": "set state", "args": []string{action}}); e != nil {
					t.Fatal(e)
				}
				if change != "missing" {
					for {
						var waiting bool
						e = a.DB.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND NOT granted AND $1=ANY(pg_blocking_pids(pid)))", lock.Conn().PgConn().PID()).Scan(&waiting)
						if e != nil {
							t.Fatal(e)
						}
						if waiting {
							break
						}
						if ctx.Err() != nil {
							t.Fatal(ctx.Err())
						}
						runtime.Gosched()
					}
				}
				if posts.Load() != 0 || frames.Load() != 0 {
					t.Fatal("power escaped held lock")
				}
				switch change {
				case "revoke":
					e = a.exec(ctx, "UPDATE subusers SET permissions='[\"websocket.connect\",\"control.console\"]' WHERE user_id=$1", user["id"])
				case "suspend":
					e = a.exec(ctx, "UPDATE servers SET status='suspended' WHERE id=$1", server["id"])
				case "maintenance":
					e = a.exec(ctx, "UPDATE nodes SET maintenance_mode=true WHERE id=$1", node["id"])
				case "disabled_owner":
					e = a.exec(ctx, "UPDATE servers SET owner_id=$1 WHERE id=$2", user["id"], server["id"])
					e = a.exec(ctx, "UPDATE users SET disabled=true WHERE id=$1", user["id"])
				case "transfer":
					_, e = a.insert(ctx, "server_transfers", M{"server_id": server["id"], "old_node": node["id"], "new_node": node["id"]})
				case "disabled":
					e = a.exec(ctx, "UPDATE users SET disabled=true WHERE id=$1", user["id"])
				}
				if e != nil {
					t.Fatal(e)
				}
				if e = lock.Commit(ctx); e != nil {
					t.Fatal(e)
				}
				// An ordinary command is an ordered barrier through the same proxy reader.
				command := `{"event":"send command","args":["help"]}`
				if e = c.WriteMessage(websocket.TextMessage, []byte(command)); e != nil {
					t.Fatal(e)
				}
				if change != "none" {
					var reply M
					if e = c.ReadJSON(&reply); e != nil {
						t.Fatal(e)
					}
					if str(reply["event"]) != "daemon error" {
						t.Fatalf("missing error: %v", reply)
					}
				}
				select {
				case got := <-received:
					if got != command {
						t.Fatalf("power frame leaked: %s", got)
					}
				case <-ctx.Done():
					t.Fatal(ctx.Err())
				}
				want := int32(0)
				if change == "none" {
					want = 1
				}
				if posts.Load() != want || frames.Load() != 1 {
					t.Fatalf("posts=%d frames=%d", posts.Load(), frames.Load())
				}
			})
		}
	}
}
