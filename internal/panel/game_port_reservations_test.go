package panel

import (
	"context"
	"encoding/json"
	"strconv"
	"strings"
	"testing"
)

func TestGamePortReservationsValidation(t *testing.T) {
	for _, raw := range []string{
		`null`, `{}`, `{"version":2}`, `{"version":1,"unknown":true}`,
		`{"version":1,"nodes":{"0":[25565]}}`, `{"version":1,"nodes":{"01":[25565]}}`,
		`{"version":1,"nodes":{"1":[0]}}`, `{"version":1,"nodes":{"1":[65536]}}`,
		`{"version":1,"nodes":{"1":[25565,25565]}}`, `{"version":1,"gateways":{"1":[1.5]}}`,
		`{"version":1} {"version":1}`, strings.Repeat(" ", 131073),
	} {
		if _, err := parseGamePortReservations([]byte(raw)); err == nil {
			t.Fatalf("invalid reservation accepted: %.100s", raw)
		}
	}
	r, err := parseGamePortReservations([]byte(`{"version":1,"nodes":{"147":[2022,25565,25566]},"gateways":{"1":[25567]}}`))
	if err != nil || !reservedGamePort(r.nodePorts(147), 25565) || reservedGamePort(r.nodePorts(249), 25565) || !reservedGamePort(r.gatewayPorts(1), 25567) || r.gatewayPorts(2) == nil {
		t.Fatal("reservation scopes or empty SQL array changed", err)
	}
}

func TestGamePortReservationsPostgresPlanningAndStaleProvision(t *testing.T) {
	a, _, _, node, _ := steamGamesFixture(t)
	ctx := context.Background()
	if err := a.exec(ctx, "DELETE FROM allocations WHERE node_id=$1", node["id"]); err != nil {
		t.Fatal(err)
	}
	store := func(value any) {
		t.Helper()
		raw, err := json.Marshal(value)
		if err != nil {
			t.Fatal(err)
		}
		if err := a.exec(ctx, "INSERT INTO settings(key,value) VALUES($1,$2::jsonb) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value", gamePortReservationsKey, string(raw)); err != nil {
			t.Fatal(err)
		}
	}
	nid := strconv.FormatInt(num(node["id"]), 10)
	store(gamePortReservations{Version: 1, Nodes: map[string][]int64{nid: {25565, 25566, 25567}}})
	// A free allocation still cannot override an external reservation.
	if err := a.exec(ctx, "INSERT INTO allocations(node_id,ip,port) VALUES($1,'192.0.2.1',25565)", node["id"]); err != nil {
		t.Fatal(err)
	}
	plan, _, err := a.planGamePorts(ctx, node, gameTemplate{ID: "minecraft"}, M{})
	if err != nil || len(plan.Ports) != 1 || plan.Ports[0].Port != 25568 || !strings.Contains(plan.Ports[0].Reason, "reserved") || plan.IP != "192.0.2.1" {
		t.Fatalf("legacy reserved ports reused or bind changed: %+v %v", plan, err)
	}
	if _, ok := node["_operator_reserved_ports"]; ok {
		t.Fatal("planning mutated caller node")
	}
	// The operator changes reservations after preview. Recheck inside the write
	// transaction and roll back even earlier inserts in the same companion plan.
	store(gamePortReservations{Version: 1, Nodes: map[string][]int64{nid: {25565, 25566, 25567, 25568}}})
	stale := gamePortPlan{IP: plan.IP, Ports: []gamePlannedPort{{Port: 25590}, {Port: 25568}}}
	if _, err := a.provisionGamePorts(ctx, node, stale); err == nil {
		t.Fatal("stale reservation was assigned")
	}
	count, _ := a.one(ctx, "SELECT count(*) n FROM allocations WHERE node_id=$1 AND port IN (25568,25590)", node["id"])
	if num(count["n"]) != 0 {
		t.Fatal("rejected companion plan partly persisted")
	}
	store(M{"version": 2})
	if _, _, err := a.planGamePorts(ctx, node, gameTemplate{ID: "minecraft"}, M{}); err == nil {
		t.Fatal("invalid configuration did not block planning")
	}
	if _, err := a.provisionGamePorts(ctx, node, stale); err == nil {
		t.Fatal("invalid configuration did not block provisioning")
	}
}

func TestGamePortReservationsPostgresFRPPublicAndLocal(t *testing.T) {
	a, _, user := infraTestApp(t)
	ctx := context.Background()
	exec := func(q string, args ...any) {
		t.Helper()
		if err := a.exec(ctx, q, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec(`INSERT INTO locations(id,short) VALUES(9911,'port-reservation')`)
	exec(`INSERT INTO nodes(id,uuid,name,location_id,fqdn,daemon_token_id,daemon_token) VALUES(9911,'port-reservation','port-reservation',9911,'127.0.0.1','port-reservation','test')`)
	exec(`INSERT INTO nests(id,uuid,author,name) VALUES(9911,'port-reservation','test','test')`)
	exec(`INSERT INTO eggs(id,uuid,nest_id,author,name) VALUES(9911,'port-reservation',9911,'test','test')`)
	exec(`INSERT INTO servers(id,uuid,uuid_short,identifier,name,owner_id,node_id,nest_id,egg_id,image) VALUES(9911,'port-reservation','reserved','reserved','test',$1,9911,9911,9911,'test')`, user)
	exec(`INSERT INTO allocations(id,node_id,server_id,ip,port) VALUES(9911,9911,9911,'192.0.2.1',25565)`)
	exec(`INSERT INTO proxy_gateways(id,name,public_host,public_port_start,public_port_end) VALUES(9911,'port-reservation','game.invalid',25565,25570)`)
	exec(`INSERT INTO proxy_node_clients(id,gateway_id,node_id,admin_url,credentials_encrypted,local_port_start,local_port_end,setup_complete,test_status) VALUES(9911,9911,9911,'http://127.0.0.1:7400','test',25565,25570,true,'complete')`)
	exec(`INSERT INTO settings(key,value) VALUES($1,'{"version":1,"gateways":{"9911":[25565,25566,25567]}}')`, gamePortReservationsKey)
	node, server := M{"id": 9911}, M{"id": 9911}
	for _, proto := range []string{"tcp", "udp"} {
		route, err := a.createGameFRPRoute(ctx, node, server, "192.0.2.1", 25565, proto)
		if err != nil || num(route["public_port"]) != 25568 || num(route["local_port"]) != 25565 {
			t.Fatalf("public reservation ignored for %s: %v %v", proto, route, err)
		}
		again, err := a.createGameFRPRoute(ctx, node, server, "192.0.2.1", 25565, proto)
		if err != nil || num(again["id"]) != num(route["id"]) {
			t.Fatal("existing permitted route lost idempotency", err)
		}
	}
	exec(`UPDATE settings SET value='{"version":1,"gateways":{"9911":[25568]}}' WHERE key=$1`, gamePortReservationsKey)
	if _, err := a.createGameFRPRoute(ctx, node, server, "192.0.2.1", 25565, "tcp"); err == nil {
		t.Fatal("reserved existing public mapping was reused")
	}
	exec(`UPDATE settings SET value='{"version":1,"nodes":{"9911":[25565]}}' WHERE key=$1`, gamePortReservationsKey)
	if _, err := a.createGameFRPRoute(ctx, node, server, "192.0.2.1", 25565, "udp"); err == nil {
		t.Fatal("reserved local mapping was reused")
	}
	count, _ := a.one(ctx, "SELECT count(*) n FROM proxy_routes WHERE public_port=25568 AND desired_present")
	if num(count["n"]) != 2 {
		t.Fatal("reservation conflict changed existing routes")
	}
}
