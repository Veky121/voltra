package panel

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

func TestLifecycleDeleteRoutesPreflight(t *testing.T) {
	a, _, user := infraTestApp(t)
	ctx := context.Background()
	var deletes atomic.Int32
	daemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "DELETE" {
			deletes.Add(1)
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer daemon.Close()
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := a.DB.Exec(ctx, sql, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec(`INSERT INTO locations(id,short) VALUES(9901,'delete')`)
	node := daemonTestNode(t, daemon)
	sealed, err := a.seal("secret")
	if err != nil {
		t.Fatal(err)
	}
	node["id"], node["uuid"], node["name"], node["location_id"], node["daemon_token"] = int64(9901), newUUID(), "delete", int64(9901), sealed
	if _, err = a.insert(ctx, "nodes", node); err != nil {
		t.Fatal(err)
	}
	exec(`INSERT INTO nests(id,uuid,author,name) VALUES(9901,'delete-nest','test','test')`)
	exec(`INSERT INTO eggs(id,uuid,nest_id,author,name) VALUES(9901,'delete-egg',9901,'test','test')`)
	exec(`INSERT INTO servers(id,uuid,uuid_short,identifier,name,owner_id,node_id,nest_id,egg_id,image) VALUES(9901,'delete-server','delshort','delserver','test',$1,9901,9901,9901,'test')`, user)
	exec(`INSERT INTO allocations(id,node_id,server_id,ip,port) VALUES(9901,9901,9901,'127.0.0.1',25565)`)
	exec(`INSERT INTO proxy_gateways(id,name,public_host,public_port_start,public_port_end) VALUES(9901,'test','test.invalid',26000,26010)`)
	exec(`INSERT INTO proxy_node_clients(id,gateway_id,node_id,admin_url,credentials_encrypted,local_port_start,local_port_end) VALUES(9901,9901,9901,'http://127.0.0.1','test',25000,25999)`)
	exec(`INSERT INTO proxy_routes(id,gateway_id,client_id,server_id,allocation_id,protocol,public_port,local_ip,local_port,proxy_name) VALUES(9901,9901,9901,9901,9901,'tcp',26000,'127.0.0.1',25565,'delete-route')`)
	mux := http.NewServeMux()
	a.registerLifecycle(mux)
	for _, desired := range []bool{true, false} {
		exec(`UPDATE proxy_routes SET desired_present=$1 WHERE id=9901`, desired)
		for _, suffix := range []string{"", "/force"} {
			status, _, body := infraRequest(t, mux, user, "DELETE", "/api/application/servers/9901"+suffix, nil)
			if status != 409 || !strings.Contains(body, "Automatic public port cleanup") || deletes.Load() != 0 {
				t.Fatalf("desired=%v suffix=%q status=%d daemon deletes=%d body=%s", desired, suffix, status, deletes.Load(), body)
			}
		}
	}
	var assigned int64
	if err = a.DB.QueryRow(ctx, `SELECT server_id FROM allocations WHERE id=9901`).Scan(&assigned); err != nil || assigned != 9901 {
		t.Fatalf("allocation changed: %d %v", assigned, err)
	}
	// Independently completed reconciliation is also safe to retry, even if Wings
	// already deleted the server. Automatic success is covered by the FRPC fixture.
	exec(`DELETE FROM proxy_routes WHERE id=9901`)
	recorder := httptest.NewRecorder()
	mux.ServeHTTP(recorder, WithUser(httptest.NewRequest("DELETE", "/api/application/servers/9901", nil), user))
	status, body := recorder.Code, recorder.Body.String()
	if status != 204 || deletes.Load() != 1 {
		t.Fatalf("retry status=%d deletes=%d body=%s", status, deletes.Load(), body)
	}
	var remaining int
	if err = a.DB.QueryRow(ctx, `SELECT COUNT(*) FROM servers WHERE id=9901`).Scan(&remaining); err != nil || remaining != 0 {
		t.Fatalf("server remains: %d %v", remaining, err)
	}
	var released bool
	if err = a.DB.QueryRow(ctx, `SELECT server_id IS NULL FROM allocations WHERE id=9901`).Scan(&released); err != nil || !released {
		t.Fatalf("allocation not released: %v %v", released, err)
	}
}
