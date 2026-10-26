package panel

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestLifecycleDeleteAutomaticallyCleansPublicPorts(t *testing.T) {
	for _, mode := range []string{"success", "gateway_failure", "runtime_still_present", "daemon_failure", "name_collision", "gateway_busy", "invalid_store_confirmation", "invalid_runtime_status", "server_mutation_busy", "build_busy", "allocation_busy", "transferring"} {
		t.Run(mode, func(t *testing.T) {
			a, _, admin, server, _ := quickSetupMinecraftFixture(t)
			ctx := context.Background()
			exec := func(sql string, args ...any) {
				t.Helper()
				if err := a.exec(ctx, sql, args...); err != nil {
					t.Fatal(err)
				}
			}
			var mu sync.Mutex
			state := mode
			store := map[string]M{}
			for _, proto := range []string{"tcp", "udp"} {
				store[proto] = M{"name": proto, "type": proto, proto: M{"localIP": "127.0.0.1", "localPort": 8211, "remotePort": 26000}}
			}
			store["unrelated"] = M{"name": "unrelated", "type": "tcp", "tcp": M{"remotePort": 27000}}
			deletes := 0
			invalidConfirmation := false
			frpc := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				mu.Lock()
				defer mu.Unlock()
				u, p, ok := r.BasicAuth()
				if !ok || u != "admin" || p != "fixture-secret" {
					w.WriteHeader(401)
					return
				}
				switch {
				case r.URL.Path == "/api/store/proxies" && r.Method == "GET":
					if invalidConfirmation {
						invalidConfirmation = false
						fmt.Fprint(w, `{"unexpected":[]}`)
						return
					}
					entries := []M{}
					for name, value := range store {
						if state == "name_collision" && name == "tcp" {
							value = M{"name": "tcp", "type": "tcp", "tcp": M{"localIP": "127.0.0.1", "localPort": 9999, "remotePort": 26000}}
						}
						entries = append(entries, value)
					}
					json.NewEncoder(w).Encode(M{"proxies": entries})
				case r.URL.Path == "/api/status":
					if state == "invalid_runtime_status" {
						fmt.Fprint(w, `{"error":"unavailable"}`)
						return
					}
					entries := []M{}
					for name := range store {
						entries = append(entries, M{"name": name})
					}
					if state == "runtime_still_present" {
						entries = append(entries, M{"name": "tcp"})
					}
					json.NewEncoder(w).Encode(M{"tcp": entries})
				case strings.HasPrefix(r.URL.Path, "/api/store/proxies/") && r.Method == "DELETE":
					if state == "gateway_failure" {
						http.Error(w, "private upstream response", 500)
						return
					}
					name := strings.TrimPrefix(r.URL.Path, "/api/store/proxies/")
					if name == "unrelated" {
						t.Error("unrelated proxy deleted")
					}
					delete(store, name)
					invalidConfirmation = state == "invalid_store_confirmation"
					fmt.Fprint(w, "{}")
				default:
					w.WriteHeader(404)
				}
			}))
			defer frpc.Close()
			wings := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				mu.Lock()
				defer mu.Unlock()
				if r.Method != "DELETE" {
					t.Errorf("unexpected daemon method %s", r.Method)
				}
				if store["tcp"] != nil || store["udp"] != nil {
					t.Error("daemon deleted before route cleanup")
				}
				deletes++
				if state == "daemon_failure" {
					w.WriteHeader(500)
					return
				}
				w.WriteHeader(204)
			}))
			defer wings.Close()
			node := daemonTestNode(t, wings)
			exec("UPDATE nodes SET fqdn=$2,scheme=$3,daemon_listen=$4 WHERE id=$1", server["node_id"], node["fqdn"], node["scheme"], node["daemon_listen"])
			allocation, err := a.one(ctx, "UPDATE allocations SET server_id=$1,notes='test' WHERE node_id=$2 AND port=8211 RETURNING *", server["id"], server["node_id"])
			if err != nil {
				t.Fatal(err)
			}
			gateway, err := a.insert(ctx, "proxy_gateways", M{"name": "cleanup", "public_host": "games.example.test", "public_port_start": 26000, "public_port_end": 26005})
			if err != nil {
				t.Fatal(err)
			}
			sealed, err := a.seal(`{"admin_user":"admin","admin_password":"fixture-secret"}`)
			if err != nil {
				t.Fatal(err)
			}
			client, err := a.insert(ctx, "proxy_node_clients", M{"gateway_id": gateway["id"], "node_id": server["node_id"], "admin_url": frpc.URL, "credentials_encrypted": sealed, "local_port_start": 8000, "local_port_end": 9000})
			if err != nil {
				t.Fatal(err)
			}
			for _, proto := range []string{"tcp", "udp"} {
				_, err = a.insert(ctx, "proxy_routes", M{"gateway_id": gateway["id"], "client_id": client["id"], "server_id": server["id"], "allocation_id": allocation["id"], "protocol": proto, "public_port": 26000, "local_ip": "127.0.0.1", "local_port": 8211, "proxy_name": proto})
				if err != nil {
					t.Fatal(err)
				}
			}
			mux := http.NewServeMux()
			mux.HandleFunc("DELETE /servers/{server}", a.lifecycleDelete)
			mux.HandleFunc("DELETE /servers/{server}/{force}", a.lifecycleDelete)
			endpoint := "/servers/" + str(server["id"])
			if mode == "gateway_failure" || mode == "server_mutation_busy" || mode == "transferring" {
				endpoint += "/force"
			}
			if mode != "success" {
				if mode == "transferring" {
					exec("INSERT INTO server_transfers(server_id,old_node,new_node) VALUES($1,$2,$2)", server["id"], server["node_id"])
				}
				if mode == "gateway_busy" || mode == "server_mutation_busy" || mode == "build_busy" || mode == "allocation_busy" {
					tx, err := a.DB.Begin(ctx)
					if err != nil {
						t.Fatal(err)
					}
					defer tx.Rollback(ctx)
					switch mode {
					case "gateway_busy":
						_, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtextextended(current_schema()||$1,0))", fmt.Sprintf("proxy-wizard-%d", num(gateway["id"])))
					case "server_mutation_busy":
						_, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "voltra:server-mutation:"+str(server["uuid"]))
					case "build_busy":
						_, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock($1)", num(server["id"]))
					case "allocation_busy":
						_, err = tx.Exec(ctx, "SELECT id FROM allocations WHERE id=$1 FOR SHARE", allocation["id"])
					}
					if err != nil {
						t.Fatal(err)
					}
					requestCtx, cancel := context.WithTimeout(ctx, time.Second)
					rr := httptest.NewRecorder()
					mux.ServeHTTP(rr, WithUser(httptest.NewRequest("DELETE", endpoint, nil).WithContext(requestCtx), admin))
					cancel()
					if rr.Code != 409 {
						t.Fatalf("busy delete status %d, daemon calls %d: %s", rr.Code, deletes, rr.Body.String())
					}
					if err = tx.Rollback(ctx); err != nil {
						t.Fatal(err)
					}
				} else {
					status := 409
					if mode == "daemon_failure" {
						status = 502
					}
					infraExpect(t, mux, admin, "DELETE", endpoint, nil, status)
				}
				var count int
				if err = a.DB.QueryRow(ctx, "SELECT count(*) FROM servers WHERE id=$1", server["id"]).Scan(&count); err != nil || count != 1 {
					t.Fatal("failed cleanup deleted server", err)
				}
				if mode != "daemon_failure" && deletes != 0 {
					t.Fatal("daemon contacted despite cleanup failure")
				}
				busyBeforeCleanup := mode == "gateway_busy" || mode == "server_mutation_busy" || mode == "build_busy" || mode == "transferring"
				if busyBeforeCleanup {
					if err = a.DB.QueryRow(ctx, "SELECT count(*) FROM proxy_routes WHERE server_id=$1 AND desired_present", server["id"]).Scan(&count); err != nil || count != 2 {
						t.Fatal("busy server lost its public routes", err)
					}
				}
				if !busyBeforeCleanup && mode != "daemon_failure" {
					if err = a.DB.QueryRow(ctx, "SELECT count(*) FROM proxy_routes WHERE server_id=$1 AND desired_present", server["id"]).Scan(&count); err != nil || count != 0 {
						t.Fatal("removal intent not durable", err)
					}
				}
				if mode == "daemon_failure" {
					if err = a.DB.QueryRow(ctx, "SELECT count(*) FROM proxy_routes WHERE server_id=$1", server["id"]).Scan(&count); err != nil || count != 0 {
						t.Fatal("daemon failure rolled back route cleanup", err)
					}
				}
				mu.Lock()
				state = "success"
				mu.Unlock()
				if mode == "transferring" {
					exec("UPDATE server_transfers SET successful=false WHERE server_id=$1", server["id"])
				}
			}
			rr := httptest.NewRecorder()
			mux.ServeHTTP(rr, WithUser(httptest.NewRequest("DELETE", endpoint, nil), admin))
			if rr.Code != 204 {
				t.Fatalf("delete status %d: %s", rr.Code, rr.Body.String())
			}
			var remaining int
			if err = a.DB.QueryRow(ctx, "SELECT count(*) FROM servers WHERE id=$1", server["id"]).Scan(&remaining); err != nil || remaining != 0 {
				t.Fatal("server retained", err)
			}
			row, err := a.one(ctx, "SELECT server_id,notes FROM allocations WHERE id=$1", allocation["id"])
			if err != nil || row["server_id"] != nil || row["notes"] != nil {
				t.Fatal("allocation not released", err)
			}
			mu.Lock()
			defer mu.Unlock()
			if store["unrelated"] == nil {
				t.Fatal("unrelated mapping changed")
			}
		})
	}
}
