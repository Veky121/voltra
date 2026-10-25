package panel

import (
	"context"
	"testing"
)

func TestGameFRPWildcardTarget(t *testing.T) {
	if !gameFRPAllocationTargetMatches("0.0.0.0", "http://100.107.3.95:7410", "100.107.3.95") || gameFRPAllocationTargetMatches("0.0.0.0", "http://100.107.3.95:7410", "10.0.0.1") || gameFRPAllocationTargetMatches("10.0.0.5", "http://100.107.3.95:7410", "100.107.3.95") {
		t.Fatal("allocation target revalidation allowed a changed target or rejected the tested wildcard address")
	}
	for _, tc := range []struct{ bind, admin, want string }{
		{"0.0.0.0", "http://100.107.3.95:7410", "100.107.3.95"},
		{"10.0.0.5", "http://127.0.0.1:7400", "10.0.0.5"},
		{"::", "http://[fd00::5]:7400", "fd00::5"},
		{"127.0.0.1", "http://100.107.3.95:7410", ""},
		{"0.0.0.0", "http://127.0.0.1:7400", ""},
		{"0.0.0.0", "http://example.com:7400", ""},
		{"::", "http://100.107.3.95:7410", ""},
		{"0.0.0.0", "http://100.107.3.95:7410/path", ""},
	} {
		got, err := gameFRPTarget(tc.bind, tc.admin)
		if got != tc.want || (err != nil) != (tc.want == "") {
			t.Fatalf("%s %s: got %q %v", tc.bind, tc.admin, got, err)
		}
	}
}

func TestGameNetworkOldNodeUnverified(t *testing.T) {
	a := &App{}
	got, err := a.probeGamePortAvailability(context.Background(), M{"id": int64(1)}, "0.0.0.0", []int64{25565})
	if err != nil || str(got["status"]) != "unverified" || len(asSlice(got["ports"])) != 0 {
		t.Fatalf("old node false success: %v %v", got, err)
	}
}

func TestGameNetworkAllowlist(t *testing.T) {
	for _, role := range []string{"RCON_PORT", "QUERY_PORT", "CONSOLE_PORT", "admin", "auxiliary", "game+1", "reliable"} {
		if len(gameForwardProtocols("factorio/factorio/egg-factorio.json", role)) != 0 {
			t.Fatalf("unaudited role forwarded: %s", role)
		}
	}
	if p := gameForwardProtocols("factorio/factorio/egg-factorio.json", "game"); len(p) != 1 || p[0] != "udp" {
		t.Fatal(p)
	}
	if p := gameForwardProtocols("terraria/vanilla/egg-terraria-vanilla.json", "game"); len(p) != 1 || p[0] != "tcp" {
		t.Fatal(p)
	}
	if len(gameForwardProtocols("unknown", "game")) != 0 {
		t.Fatal("unknown game forwarded")
	}
	a := &App{}
	got := a.forwardGamePorts(context.Background(), nil, nil, gameTemplate{ID: "satisfactory"}, gamePortPlan{Ports: []gamePlannedPort{{Port: 7777, Role: "game"}, {Port: 8888, Role: "reliable"}}})
	if str(got["status"]) != "manual" || boolean(got["externally_verified"]) {
		t.Fatal(got)
	}
	// A catalog recipe cannot borrow synthetic identity to bypass the audit.
	got = a.forwardGamePorts(context.Background(), nil, nil, gameTemplate{ID: "minecraft", Path: "unknown"}, gamePortPlan{Ports: []gamePlannedPort{{Port: 25565, Role: "game"}}})
	if str(got["status"]) != "manual" {
		t.Fatal(got)
	}
}

func TestGameNetworkFRPOwnershipIntegration(t *testing.T) {
	a, _, user := infraTestApp(t)
	ctx := context.Background()
	exec := func(q string, args ...any) {
		t.Helper()
		if _, err := a.DB.Exec(ctx, q, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec(`INSERT INTO locations(id,short) VALUES(9911,'game-network')`)
	exec(`INSERT INTO nodes(id,uuid,name,location_id,fqdn,daemon_token_id,daemon_token) VALUES(9911,'game-network','game-network',9911,'127.0.0.1','game-network','test')`)
	exec(`INSERT INTO nests(id,uuid,author,name) VALUES(9911,'game-network','test','test')`)
	exec(`INSERT INTO eggs(id,uuid,nest_id,author,name) VALUES(9911,'game-network',9911,'test','test')`)
	exec(`INSERT INTO servers(id,uuid,uuid_short,identifier,name,owner_id,node_id,nest_id,egg_id,image) VALUES(9911,'game-network','gnetwork','gnetwork','test',$1,9911,9911,9911,'test')`, user)
	exec(`INSERT INTO allocations(id,node_id,server_id,ip,port) VALUES(9911,9911,9911,'10.23.45.67',25565),(9912,9911,9911,'10.23.45.67',25566)`)
	exec(`INSERT INTO proxy_gateways(id,name,public_host,public_port_start,public_port_end) VALUES(9911,'game-network','game.invalid',25565,25570)`)
	exec(`INSERT INTO proxy_node_clients(id,gateway_id,node_id,admin_url,credentials_encrypted,local_port_start,local_port_end,setup_complete,test_status) VALUES(9911,9911,9911,'http://127.0.0.1:7400','test',25565,25570,true,'complete')`)
	exec(`INSERT INTO proxy_routes(gateway_id,client_id,server_id,allocation_id,protocol,public_port,local_ip,local_port,proxy_name) VALUES(9911,9911,9911,9912,'tcp',25565,'10.23.45.67',25566,'existing-owner')`)
	node, server := M{"id": int64(9911)}, M{"id": int64(9911)}
	route, err := a.createGameFRPRoute(ctx, node, server, "10.23.45.67", 25565, "tcp")
	if err != nil {
		t.Fatal(err)
	}
	if num(route["public_port"]) != 25566 || num(route["local_port"]) != 25565 {
		t.Fatalf("did not preserve internal and skip public conflict: %v", route)
	}
	again, err := a.createGameFRPRoute(ctx, node, server, "10.23.45.67", 25565, "tcp")
	if err != nil || num(again["id"]) != num(route["id"]) {
		t.Fatalf("not idempotent %v %v", again, err)
	}
	exec("UPDATE proxy_routes SET desired_present=false WHERE id=$1", num(route["id"]))
	if _, err = a.createGameFRPRoute(ctx, node, server, "10.23.45.67", 25565, "tcp"); err == nil {
		t.Fatal("overrode removal intent")
	}
	if _, err = a.createGameFRPRoute(ctx, node, server, "0.0.0.0", 25565, "tcp"); err == nil {
		t.Fatal("mapped unassigned wildcard")
	}
	if _, err = a.createGameFRPRoute(ctx, node, M{"id": int64(999999)}, "10.23.45.67", 25565, "udp"); err == nil {
		t.Fatal("cross-server allocation accepted")
	}
	exec(`UPDATE proxy_node_clients SET admin_url='http://100.107.3.95:7410' WHERE id=9911`)
	exec(`INSERT INTO allocations(id,node_id,server_id,ip,port) VALUES(9913,9911,9911,'0.0.0.0',25567)`)
	wildcard, err := a.createGameFRPRoute(ctx, node, server, "0.0.0.0", 25567, "tcp")
	if err != nil || str(wildcard["local_ip"]) != "100.107.3.95" || num(wildcard["allocation_id"]) != 9913 {
		t.Fatalf("wildcard target did not retain allocation ownership: %v %v", wildcard, err)
	}
}
