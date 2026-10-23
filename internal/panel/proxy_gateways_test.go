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

func TestProxyPrivateTransport(t *testing.T) {
	a := &App{Config: Config{EncryptionKey: "test"}}
	if _, e := a.proxyGatewaySecret(M{"auth_token": "bad\x01token"}); e == nil {
		t.Fatal("control token accepted")
	}
	for _, s := range []string{"http://8.8.8.8:7400", "http://example.com", "http://0.0.0.0:7400", "http://u:p@127.0.0.1:7400", "http://127.0.0.1/a"} {
		if proxyPrivateURL(s) == nil {
			t.Fatalf("accepted %s", s)
		}
	}
	for _, s := range []string{"http://127.0.0.1:7400", "https://10.0.0.2:7400", "http://100.64.1.2:7400", "http://[::1]:7400"} {
		if proxyPrivateURL(s) != nil {
			t.Fatalf("rejected %s", s)
		}
	}
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(404)
		fmt.Fprint(w, "secret must never be reflected")
	}))
	defer s.Close()
	_, code, e := proxyStoreCall(context.Background(), s.URL, "u", "p", "GET", "/api/store/proxies", nil)
	if code != 404 || e != nil {
		t.Fatalf("code %d err %v", code, e)
	}
	if strings.Contains(proxyCapability(code, e).Error(), "secret") {
		t.Fatal("leaked response")
	}
}
func TestProxyGatewayIntegration(t *testing.T) {
	a, _, user := infraTestApp(t)
	ctx := context.Background()
	mux := http.NewServeMux()
	a.registerProxyGateways(mux)
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, e := a.DB.Exec(ctx, sql, args...); e != nil {
			t.Fatal(e)
		}
	}
	exec(`INSERT INTO locations(id,short) VALUES(9901,'frp')`)
	exec(`INSERT INTO nodes(id,uuid,name,location_id,fqdn,daemon_token_id,daemon_token) VALUES(9901,'frp-node','frp',9901,'127.0.0.1','frp-node','test')`)
	exec(`INSERT INTO nests(id,uuid,author,name) VALUES(9901,'frp-nest','test','test')`)
	exec(`INSERT INTO eggs(id,uuid,nest_id,author,name) VALUES(9901,'frp-egg',9901,'test','test')`)
	exec(`INSERT INTO servers(id,uuid,uuid_short,identifier,name,owner_id,node_id,nest_id,egg_id,image) VALUES(9901,'frp-server','frpshort','frpserver','test',$1,9901,9901,9901,'test')`, user)
	exec(`INSERT INTO allocations(id,node_id,server_id,ip,port) VALUES(9901,9901,9901,'127.0.0.1',25565),(9902,9901,9901,'127.0.0.1',25566),(9903,9901,9901,'127.0.0.1',25567)`)
	var mu sync.Mutex
	store := map[string]M{}
	writes := 0
	failDelete := false
	running := true
	wrongToken := false
	fileCollision := ""
	fake := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		u, p, ok := r.BasicAuth()
		if !ok || u != "admin" || p != "test-admin-password" {
			w.WriteHeader(401)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.URL.Path == "/api/config":
			if wrongToken {
				fmt.Fprint(w, "serverAddr = \"frps.example.test\"\nserverPort = 7000\nauth.method = \"token\"\nauth.token = \"wrong-token\"\n")
				return
			}
			fmt.Fprint(w, "serverAddr = \"frps.example.test\"\nserverPort = 7000\nauth.method = \"token\"\nauth.token = \"test-frps-token\"\n")
		case r.URL.Path == "/api/status":
			arr := []M{}
			udp := []M{}
			if fileCollision != "" {
				arr = append(arr, M{"name": fileCollision, "type": "tcp", "status": "running", "source": "config"})
			}
			for name, m := range store {
				proto := str(m["type"])
				b := asMap(m[proto])
				status := "running"
				if !running {
					status = "error"
				}
				entry := M{"name": name, "type": proto, "status": status, "err": "", "remote_addr": fmt.Sprintf("frps.example.test:%d", num(b["remotePort"]))}
				if proto == "udp" {
					udp = append(udp, entry)
				} else {
					arr = append(arr, entry)
				}
			}
			json.NewEncoder(w).Encode(M{"tcp": arr, "udp": udp})
		case r.Method == "GET" && r.URL.Path == "/api/store/proxies":
			arr := []M{}
			for _, m := range store {
				arr = append(arr, m)
			}
			json.NewEncoder(w).Encode(M{"proxies": arr})
		case r.Method == "POST" && r.URL.Path == "/api/store/proxies":
			m := M{}
			json.NewDecoder(r.Body).Decode(&m)
			name := str(m["name"])
			if _, ok := store[name]; ok {
				w.WriteHeader(409)
				return
			}
			store[name] = m
			writes++
			json.NewEncoder(w).Encode(m)
		case r.Method == "DELETE" && strings.HasPrefix(r.URL.Path, "/api/store/proxies/"):
			if failDelete {
				w.WriteHeader(500)
				fmt.Fprint(w, "private secret")
				return
			}
			delete(store, strings.TrimPrefix(r.URL.Path, "/api/store/proxies/"))
			writes++
			fmt.Fprint(w, "{}")
		default:
			w.WriteHeader(404)
		}
	}))
	defer fake.Close()
	g := asMap(infraExpect(t, mux, user, "POST", "/api/admin/proxy-gateways", M{"name": "test", "public_host": "games.example.test", "server_host": "frps.example.test", "server_port": 7000, "auth_token": "test-frps-token", "public_port_start": 26000, "public_port_end": 26004}, 201)["attributes"])
	base := fmt.Sprintf("/api/admin/proxy-gateways/%d", num(g["id"]))
	if _, ok := g["auth_token_encrypted"]; ok {
		t.Fatal("gateway leaked ciphertext")
	}
	c := asMap(infraExpect(t, mux, user, "POST", base+"/clients", M{"node_id": 9901, "admin_url": fake.URL, "admin_user": "admin", "admin_password": "test-admin-password", "local_port_start": 25000, "local_port_end": 25999}, 201)["attributes"])
	clientURL := fmt.Sprintf("%s/clients/%d", base, num(c["id"]))
	if _, ok := c["credentials_encrypted"]; ok {
		t.Fatal("client leaked ciphertext")
	}
	stored, e := a.one(ctx, "SELECT credentials_encrypted FROM proxy_node_clients WHERE id=$1", num(c["id"]))
	if e != nil || !strings.HasPrefix(str(stored["credentials_encrypted"]), "enc:v1:") {
		t.Fatal("credentials not encrypted")
	}
	routeInput := func(id int64) M {
		return M{"client_id": num(c["id"]), "server_id": 9901, "allocation_id": id, "protocol": "tcp"}
	}
	route := asMap(infraExpect(t, mux, user, "POST", base+"/routes", routeInput(9901), 201)["attributes"])
	infraExpect(t, mux, user, "POST", base+"/routes", routeInput(9901), 409)
	udpInput := routeInput(9901)
	udpInput["protocol"] = "udp"
	udpInput["public_port"] = num(route["public_port"])
	infraExpect(t, mux, user, "POST", base+"/routes", udpInput, 201)
	mu.Lock()
	store["unrelated"] = M{"name": "unrelated", "type": "tcp", "tcp": M{"remotePort": 28000}}
	mu.Unlock()
	infraExpect(t, mux, user, "POST", base+"/reconcile", nil, 200)
	row, e := a.one(ctx, "SELECT status FROM proxy_routes WHERE id=$1", num(route["id"]))
	if e != nil || str(row["status"]) != "applied" {
		t.Fatalf("not running: %v %v", row, e)
	}
	mu.Lock()
	before := writes
	mu.Unlock()
	infraExpect(t, mux, user, "POST", base+"/reconcile", nil, 200)
	mu.Lock()
	if writes != before || store["unrelated"] == nil {
		t.Fatal("unchanged mapping disrupted")
	}
	mu.Unlock()
	if _, e = a.DB.Exec(ctx, "UPDATE allocations SET port=25569 WHERE id=9901"); e == nil {
		t.Fatal("allocation target mutation allowed")
	}
	if _, e = a.DB.Exec(ctx, "UPDATE allocations SET server_id=NULL WHERE id=9901"); e == nil {
		t.Fatal("allocation owner mutation allowed")
	}
	// A concurrent target edit must wait for route creation, then see the new guard.
	exec(`INSERT INTO allocations(id,node_id,server_id,ip,port) VALUES(9904,9901,9901,'127.0.0.1',25568)`)
	tx, e := a.DB.Begin(ctx)
	if e != nil {
		t.Fatal(e)
	}
	defer tx.Rollback(ctx)
	var allocation int64
	if e = tx.QueryRow(ctx, "SELECT id FROM allocations WHERE id=9904 FOR SHARE").Scan(&allocation); e != nil {
		t.Fatal(e)
	}
	_, e = tx.Exec(ctx, `INSERT INTO proxy_routes(gateway_id,client_id,server_id,allocation_id,protocol,public_port,local_ip,local_port,proxy_name) VALUES($1,$2,9901,9904,'tcp',26004,'127.0.0.1',25568,'race-guard')`, num(g["id"]), num(c["id"]))
	if e != nil {
		t.Fatal(e)
	}
	mutation := make(chan error, 1)
	go func() { _, e := a.DB.Exec(ctx, "UPDATE allocations SET port=25570 WHERE id=9904"); mutation <- e }()
	select {
	case <-mutation:
		t.Fatal("target update did not wait for route transaction")
	case <-time.After(30 * time.Millisecond):
	}
	if e = tx.Commit(ctx); e != nil {
		t.Fatal(e)
	}
	select {
	case e = <-mutation:
		if e == nil {
			t.Fatal("target edit bypassed newly committed route guard")
		}
	case <-time.After(3 * time.Second):
		t.Fatal("target edit remained blocked")
	}
	exec("DELETE FROM proxy_routes WHERE proxy_name='race-guard'")
	exec(`INSERT INTO nodes(id,uuid,name,location_id,fqdn,daemon_token_id,daemon_token) VALUES(9902,'frp-node-two','frp2',9901,'127.0.0.2','frp-node-two','test')`)
	if _, e = a.DB.Exec(ctx, "UPDATE servers SET node_id=9902 WHERE id=9901"); e == nil {
		t.Fatal("server transfer bypassed proxy guard")
	}
	// Concurrent first-free allocation serializes on the gateway lock.
	var wg sync.WaitGroup
	results := make(chan int64, 2)
	errs := make(chan error, 2)
	for _, id := range []int64{9902, 9903} {
		wg.Add(1)
		go func(id int64) {
			defer wg.Done()
			req := WithUser(httptest.NewRequest("POST", base+"/routes", strings.NewReader(fmt.Sprintf(`{"client_id":%d,"server_id":9901,"allocation_id":%d,"protocol":"tcp"}`, num(c["id"]), id))), user)
			rr := httptest.NewRecorder()
			mux.ServeHTTP(rr, req)
			if rr.Code != 201 {
				errs <- fmt.Errorf("concurrent insert status %d", rr.Code)
				return
			}
			var out M
			json.Unmarshal(rr.Body.Bytes(), &out)
			results <- num(asMap(out["attributes"])["public_port"])
		}(id)
	}
	wg.Wait()
	close(errs)
	for e := range errs {
		t.Fatal(e)
	}
	x, y := <-results, <-results
	if x == y {
		t.Fatal("duplicate concurrent public port")
	}
	// File-defined proxy names cannot be overridden by a Store create.
	collisionRoute, _ := a.one(ctx, "SELECT proxy_name FROM proxy_routes WHERE allocation_id=9902 AND protocol='tcp'")
	mu.Lock()
	fileCollision = str(collisionRoute["proxy_name"])
	before = writes
	mu.Unlock()
	infraExpect(t, mux, user, "POST", base+"/reconcile", nil, 200)
	mu.Lock()
	if writes != before+1 {
		t.Fatal("file collision was overwritten or unrelated create failed")
	}
	fileCollision = ""
	mu.Unlock()
	// Multiple node associations stay scoped, and a route cannot use another node's allocation.
	fakeTwo := httptest.NewServer(fake.Config.Handler)
	defer fakeTwo.Close()
	two := asMap(infraExpect(t, mux, user, "POST", base+"/clients", M{"node_id": 9902, "admin_url": fakeTwo.URL, "admin_user": "admin", "admin_password": "test-admin-password", "local_port_start": 25000, "local_port_end": 25999}, 201)["attributes"])
	twoURL := fmt.Sprintf("%s/clients/%d", base, num(two["id"]))
	invalid := routeInput(9901)
	invalid["client_id"] = num(two["id"])
	infraExpect(t, mux, user, "POST", base+"/routes", invalid, 422)
	infraExpect(t, mux, user, "PATCH", twoURL, M{"local_port_start": 25001}, 200)
	infraExpect(t, mux, user, "DELETE", twoURL, nil, 204)
	// Config downloads are explicit admin-only responses and never cacheable.
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, WithUser(httptest.NewRequest("GET", clientURL+"/config", nil), user))
	if rr.Code != 200 || rr.Header().Get("Cache-Control") != "no-store" || !strings.Contains(rr.Body.String(), "/var/lib/voltra-frp/frpc-store.json") {
		t.Fatal("private download invalid")
	}
	rr = httptest.NewRecorder()
	mux.ServeHTTP(rr, httptest.NewRequest("GET", clientURL+"/config", nil))
	if rr.Code == 200 {
		t.Fatal("unauthenticated secret download")
	}
	// Failed deletes retain reservation and are retried without touching survivors.
	infraExpect(t, mux, user, "DELETE", fmt.Sprintf("%s/routes/%d", base, num(route["id"])), nil, 204)
	mu.Lock()
	failDelete = true
	mu.Unlock()
	infraExpect(t, mux, user, "POST", base+"/reconcile", nil, 200)
	row, _ = a.one(ctx, "SELECT status,last_error FROM proxy_routes WHERE id=$1", num(route["id"]))
	if str(row["status"]) != "error" || strings.Contains(str(row["last_error"]), "private secret") {
		t.Fatal("unsafe delete failure state")
	}
	mu.Lock()
	failDelete = false
	mu.Unlock()
	infraExpect(t, mux, user, "POST", base+"/reconcile", nil, 200)
	if _, e = a.one(ctx, "SELECT id FROM proxy_routes WHERE id=$1", num(route["id"])); e == nil {
		t.Fatal("deleted reservation remains")
	}
	mu.Lock()
	wrongToken = true
	before = writes
	mu.Unlock()
	mismatch := asMap(infraExpect(t, mux, user, "POST", clientURL+"/test", nil, 200)["attributes"])
	if boolean(mismatch["setup_complete"]) || strings.Contains(str(mismatch["test_error"]), "wrong-token") {
		t.Fatal("saved token mismatch not safely rejected")
	}
	mu.Lock()
	if writes != before {
		t.Fatal("test created proxy with mismatched saved credentials")
	}
	wrongToken = false
	failDelete = true
	mu.Unlock()
	res := asMap(infraExpect(t, mux, user, "POST", clientURL+"/test", nil, 200)["attributes"])
	if boolean(res["setup_complete"]) || res["test_public_port"] == nil || str(res["test_status"]) != "cleanup_error" {
		t.Fatalf("lost failed cleanup reservation: %v", res)
	}
	infraExpect(t, mux, user, "DELETE", clientURL, nil, 409)
	mu.Lock()
	failDelete = false
	mu.Unlock()
	res = asMap(infraExpect(t, mux, user, "POST", clientURL+"/test", nil, 200)["attributes"])
	if !boolean(res["setup_complete"]) || res["test_public_port"] != nil {
		t.Fatalf("test did not complete cleanup: %v", res)
	}
	mu.Lock()
	running = false
	mu.Unlock()
	infraExpect(t, mux, user, "POST", base+"/reconcile", nil, 200)
	rows, _ := a.query(ctx, "SELECT status FROM proxy_routes WHERE gateway_id=$1", num(g["id"]))
	for _, row := range rows {
		if row["status"] != "error" {
			t.Fatal("marked applied without running")
		}
	}
}
