package panel

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestServerProxyRecovery(t *testing.T) {
	a, _, admin := infraTestApp(t)
	ctx := context.Background()
	exec := func(q string, args ...any) {
		t.Helper()
		if _, e := a.DB.Exec(ctx, q, args...); e != nil {
			t.Fatal(e)
		}
	}
	exec(`INSERT INTO locations(id,short) VALUES(9101,'proxy-ux')`)
	exec(`INSERT INTO nodes(id,uuid,name,location_id,fqdn,daemon_token_id,daemon_token) VALUES(9101,'proxy-ux','proxy-ux',9101,'127.0.0.1','proxy-ux','test')`)
	exec(`INSERT INTO nests(id,uuid,author,name) VALUES(9101,'proxy-ux','test','test')`)
	exec(`INSERT INTO eggs(id,uuid,nest_id,author,name) VALUES(9101,$1,9101,'test','Minecraft')`, minecraftLibraryEggUUID)
	exec(`INSERT INTO servers(id,uuid,uuid_short,identifier,name,owner_id,node_id,nest_id,egg_id,image) VALUES(9101,'proxy-ux','proxyux','proxyux','Minecraft',$1,9101,9101,9101,'test')`, admin)
	exec(`INSERT INTO allocations(id,node_id,server_id,ip,port) VALUES(9101,9101,9101,'10.0.0.5',25567),(9102,9101,9101,'10.0.0.5',25568),(9103,9101,NULL,'10.0.0.5',25569)`)
	exec(`UPDATE servers SET allocation_id=9101 WHERE id=9101`)
	store := map[string]M{}
	failDelete := false
	fake := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.URL.Path == "/api/status":
			tcp := []M{}
			udp := []M{}
			for name, m := range store {
				proto := str(m["type"])
				entry := M{"name": name, "type": proto, "status": "running", "err": "", "remote_addr": fmt.Sprintf("vps.example.test:%d", num(asMap(m[proto])["remotePort"]))}
				if proto == "tcp" {
					tcp = append(tcp, entry)
				} else {
					udp = append(udp, entry)
				}
			}
			json.NewEncoder(w).Encode(M{"tcp": tcp, "udp": udp})
		case r.Method == "GET" && r.URL.Path == "/api/store/proxies":
			entries := []M{}
			for _, m := range store {
				entries = append(entries, m)
			}
			json.NewEncoder(w).Encode(M{"proxies": entries})
		case r.Method == "POST" && r.URL.Path == "/api/store/proxies":
			var m M
			_ = json.NewDecoder(r.Body).Decode(&m)
			store[str(m["name"])] = m
			json.NewEncoder(w).Encode(m)
		case r.Method == "DELETE":
			if failDelete {
				w.WriteHeader(503)
				return
			}
			delete(store, strings.TrimPrefix(r.URL.Path, "/api/store/proxies/"))
			fmt.Fprint(w, "{}")
		default:
			w.WriteHeader(404)
		}
	}))
	defer fake.Close()
	secret, e := a.seal(`{"admin_user":"test","admin_password":"test"}`)
	if e != nil {
		t.Fatal(e)
	}
	exec(`INSERT INTO proxy_gateways(id,name,public_host,server_host,public_port_start,public_port_end) VALUES(9101,'VPS','games.example.test','vps.example.test',25567,25570),(9102,'Other VPS','other.example.test','vps.example.test',25567,25570)`)
	exec(`INSERT INTO proxy_node_clients(id,gateway_id,node_id,admin_url,credentials_encrypted,local_port_start,local_port_end,setup_complete,test_status) VALUES(9101,9101,9101,$1,$2,25567,25570,false,'new'),(9102,9102,9101,'http://10.0.0.9:7400',$2,25567,25570,true,'complete')`, fake.URL, secret)
	mux := http.NewServeMux()
	a.registerProxyGateways(mux)
	base := "/api/admin/servers/proxy-ux/proxy"
	input := M{"client_id": 9101, "allocation_id": 9101, "protocol": "tcp", "public_port": 0}
	infraExpect(t, mux, admin, "POST", base, input, 409)
	exec(`UPDATE proxy_node_clients SET setup_complete=true,test_status='complete' WHERE id=9101`)
	setup := asMap(infraExpect(t, mux, admin, "GET", base, nil, 200)["attributes"])
	if str(setup["primary_protocol"]) != "tcp" || len(asSlice(setup["clients"])) != 2 {
		t.Fatal(setup)
	}
	raw, _ := json.Marshal(setup)
	if strings.Contains(string(raw), "credentials_encrypted") || strings.Contains(string(raw), fake.URL) {
		t.Fatal("setup leaked management details")
	}
	owner, e := a.insert(ctx, "users", M{"uuid": newUUID(), "username": "proxy_owner", "email": "proxy-owner@example.invalid"})
	if e != nil {
		t.Fatal(e)
	}
	infraExpect(t, mux, num(owner["id"]), "GET", base, nil, 403)
	infraExpect(t, mux, num(owner["id"]), "POST", base, input, 403)
	input["allocation_id"] = 9103
	infraExpect(t, mux, admin, "POST", base, input, 422)
	input["allocation_id"] = 9101
	input["protocol"] = "both"
	infraExpect(t, mux, admin, "POST", base, input, 422)
	input["protocol"] = "tcp"
	input["public_port"] = 25566
	infraExpect(t, mux, admin, "POST", base, input, 409)
	input["public_port"] = 0
	route := asMap(infraExpect(t, mux, admin, "POST", base, input, 200)["attributes"])
	if num(route["public_port"]) != 25567 {
		t.Fatal("did not prefer internal port", route)
	}
	retry := asMap(infraExpect(t, mux, admin, "POST", base, input, 200)["attributes"])
	if num(retry["id"]) != num(route["id"]) {
		t.Fatal("duplicate on retry")
	}
	input["allocation_id"] = 9102
	input["public_port"] = 25567
	infraExpect(t, mux, admin, "POST", base, input, 409)
	input["public_port"] = 0
	second := asMap(infraExpect(t, mux, admin, "POST", base, input, 200)["attributes"])
	firstPath := fmt.Sprintf("/api/admin/proxy-gateways/9101/routes/%d", num(route["id"]))
	secondPath := fmt.Sprintf("/api/admin/proxy-gateways/9101/routes/%d", num(second["id"]))
	infraExpect(t, mux, admin, "POST", firstPath+"/apply", nil, 200)
	pending, _ := a.one(ctx, "SELECT status FROM proxy_routes WHERE id=$1", second["id"])
	if str(pending["status"]) != "pending" || len(store) != 1 {
		t.Fatal("single apply changed another route", pending)
	}
	infraExpect(t, mux, admin, "POST", "/api/admin/proxy-gateways/9102/routes/"+fmt.Sprint(num(route["id"]))+"/apply", nil, 404)
	infraExpect(t, mux, num(owner["id"]), "POST", firstPath+"/apply", nil, 403)
	infraExpect(t, mux, admin, "POST", secondPath+"/apply", nil, 200)
	failDelete = true
	infraExpect(t, mux, admin, "DELETE", firstPath, nil, 204)
	response := infraExpect(t, mux, admin, "POST", firstPath+"/apply", nil, 200)
	failed := asMap(asMap(asSlice(response["data"])[0])["attributes"])
	if boolean(failed["desired_present"]) || str(failed["status"]) != "error" || len(store) != 2 {
		t.Fatal("failed removal lost durable intent", failed)
	}
	failDelete = false
	infraExpect(t, mux, admin, "POST", firstPath+"/apply", nil, 200)
	if len(store) != 1 {
		t.Fatal("removal disturbed unrelated mapping")
	}
	var port int64
	if e = a.DB.QueryRow(ctx, "SELECT port FROM allocations WHERE id=9101").Scan(&port); e != nil || port != 25567 {
		t.Fatal("game port changed", port, e)
	}
}
