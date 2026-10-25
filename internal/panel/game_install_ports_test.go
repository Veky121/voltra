package panel

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"testing"
)

func TestAutomaticGamePortLayouts(t *testing.T) {
	node := M{"daemon_listen": 18084, "daemon_sftp": 12023}
	for _, tc := range []struct {
		name  string
		entry gameTemplate
		rows  []M
		env   M
		want  []int64
	}{
		{"minecraft_empty", gameTemplate{ID: "minecraft"}, nil, M{}, []int64{25565}},
		{"bedrock", gameTemplate{Path: "minecraft/bedrock/egg-bedrock.json"}, nil, M{}, []int64{19132}},
		{"valheim", gameTemplate{ID: "valheim", RequiredPorts: 2, ConsecutivePorts: true}, nil, M{}, []int64{2456, 2457}},
		{"companion_conflict", gameTemplate{ID: "valheim", RequiredPorts: 2, ConsecutivePorts: true}, []M{{"ip": "0.0.0.0", "port": 2457, "server_id": 1}}, M{}, []int64{2458, 2459}},
		{"satisfactory", gameTemplate{ID: "satisfactory", RequiredPorts: 2}, nil, M{}, []int64{7777, 8888}},
		{"independent_reliable", gameTemplate{ID: "satisfactory", Defaults: M{"port": 8888}, RequiredPorts: 2}, nil, M{}, []int64{8888, 8889}},
		{"wildcard_overlap", gameTemplate{ID: "minecraft"}, []M{{"ip": "192.0.2.1", "port": 25570}, {"ip": "0.0.0.0", "port": 25565}}, M{}, []int64{25566}},
		{"management", gameTemplate{Defaults: M{"port": 18084}}, nil, M{}, []int64{18085}},
		{"reuse_free", gameTemplate{ID: "minecraft"}, []M{{"ip": "192.0.2.1", "port": 25565}}, M{}, []int64{25565}},
		{"negative_consecutive", gameTemplate{Defaults: M{"port": 30000}, RequiredPorts: 3, ConsecutivePorts: true, ConsecutivePrimaryOffset: 1}, nil, M{}, []int64{30000, 29999, 30001}},
		{"service_pair", gameTemplate{Defaults: M{"port": 30000}, RequiredPorts: 4, PortRules: []templatePortRule{{Environment: "QUERY", Condition: "nonzero", AllocatedValue: true, AutoAllocate: true, AllocatedOffsets: []int{1}, Minimum: 29000, Maximum: 31000, Count: 4}}}, nil, M{"QUERY": ""}, []int64{30000, 30001, 30002, 30003}},
		{"optional_disabled", gameTemplate{ID: "minecraft", PortRules: []templatePortRule{{Environment: "RCON", Condition: "nonzero", AllocatedValue: true, AutoAllocate: true, Minimum: 1, Maximum: 65535, Count: 2}}}, nil, M{"RCON": "0"}, []int64{25565}},
		{"limited_range", gameTemplate{Defaults: M{"port": 10000}, PortRules: []templatePortRule{{Minimum: 11000, Maximum: 11005, Count: 2, Offsets: []int{1}}}}, nil, M{}, []int64{11000, 11001}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			plan, _, err := planGamePortLayout(node, tc.rows, tc.entry, tc.env)
			if err != nil {
				t.Fatal(err)
			}
			if len(plan.Ports) != len(tc.want) {
				t.Fatalf("ports %+v", plan)
			}
			for i, p := range tc.want {
				if plan.Ports[i].Port != p {
					t.Fatalf("got %+v want %v", plan.Ports, tc.want)
				}
			}
			if gamePreferredPort(tc.entry) != tc.want[0] && plan.Ports[0].Reason == "" {
				t.Fatal("missing fallback reason")
			}
		})
	}
	if ip := gamePortBindIP([]M{{"ip": "127.0.0.1"}, {"ip": "::1"}}); ip != "127.0.0.1" {
		t.Fatal(ip)
	}
	if ip := gamePortBindIP([]M{{"ip": "127.0.0.1"}, {"ip": "192.0.2.1"}}); ip != "192.0.2.1" {
		t.Fatal("loopback displaced configured reachable address", ip)
	}
	if ip := gamePortBindIP(nil); ip != "0.0.0.0" {
		t.Fatal("empty node did not use wildcard", ip)
	}
	if _, _, err := planGamePortLayout(node, nil, gameTemplate{PortRules: []templatePortRule{{Minimum: 1, Maximum: 65535, Count: 2, Offsets: []int{0}}}}, M{}); err == nil {
		t.Fatal("invalid metadata accepted")
	}
}

func TestAutomaticGamePortConfiguredReliablePreviewAndInstall(t *testing.T) {
	a, mux, admin, node, _ := steamGamesFixture(t)
	ctx := context.Background()
	before, err := a.one(ctx, "SELECT count(*) n FROM allocations WHERE node_id=$1", node["id"])
	if err != nil {
		t.Fatal(err)
	}
	preview := asMap(infraExpect(t, mux, admin, "POST", "/api/client/game-library/steam/satisfactory/ports", M{"node_id": node["id"], "environment": M{"RELIABLE_PORT": "9001"}}, 200)["attributes"])
	ports := asSlice(preview["ports"])
	if str(preview["ip"]) != "127.0.0.1" || len(ports) != 2 || num(asMap(ports[1])["port"]) != 9001 || str(asMap(ports[1])["role"]) != "reliable" {
		t.Fatal("preview lost the configured reliable port or bind address", preview)
	}
	after, err := a.one(ctx, "SELECT count(*) n FROM allocations WHERE node_id=$1", node["id"])
	if err != nil || num(before["n"]) != num(after["n"]) {
		t.Fatal("preview changed allocations", err)
	}
	input := steamGamesInput("satisfactory", node)
	input["environment"] = M{"RELIABLE_PORT": "9001"}
	result := asMap(infraExpect(t, mux, admin, "POST", "/api/client/game-library/steam/satisfactory/install", input, 201)["attributes"])
	server, err := a.one(ctx, "SELECT * FROM servers WHERE uuid_short=$1", result["identifier"])
	if err != nil {
		t.Fatal(err)
	}
	assigned, err := a.one(ctx, "SELECT ip,port FROM allocations WHERE server_id=$1 AND port=9001", server["id"])
	if err != nil || str(assigned["ip"]) != "127.0.0.1" {
		t.Fatal("install did not reuse the requested allocation", assigned, err)
	}
	actual := asSlice(asMap(result["ports"])["ports"])
	if len(actual) != 2 || num(asMap(actual[1])["port"]) != 9001 || !strings.Contains(str(server["startup"]), "-ReliablePort=9001 -ExternalReliablePort=9001") {
		t.Fatal("install and preview reliable ports disagree", result, server["startup"])
	}
}

func TestAutomaticGamePortPostgresEmptyNodePreviewAndConcurrentInstall(t *testing.T) {
	a, _, admin, node, wings := steamGamesFixture(t)
	ctx := context.Background()
	if err := a.exec(ctx, "DELETE FROM allocations WHERE node_id=$1", node["id"]); err != nil {
		t.Fatal(err)
	}
	var entry gameTemplate
	for _, candidate := range gameTemplates().Entries {
		if candidate.Path == "openttd/egg-open-t-t-d-server.json" {
			entry = candidate
		}
	}
	mux := http.NewServeMux()
	a.registerGameTemplates(mux)
	endpoint := "/api/client/game-library/templates/" + entry.ID
	preview := asMap(infraExpect(t, mux, admin, "POST", endpoint+"/ports", M{"node_id": node["id"], "environment": M{}}, 200)["attributes"])
	if str(preview["ip"]) != "0.0.0.0" || num(asMap(asSlice(preview["ports"])[0])["port"]) != 3979 {
		t.Fatal(preview)
	}
	count, _ := a.one(ctx, "SELECT count(*) n FROM allocations")
	if num(count["n"]) != 0 || wings.Creates != 0 {
		t.Fatal("preview mutated state")
	}
	image := ""
	for _, value := range asMap(entry.Egg["docker_images"]) {
		image = str(value)
		break
	}
	input := M{"name": "Automatic OpenTTD", "request_id": newUUID(), "memory": 2048, "disk": 10240, "image": image, "node_id": node["id"], "automatic_ports": true, "environment": M{}}
	var wg sync.WaitGroup
	codes := make(chan int, 4)
	bodies := make(chan M, 4)
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			code, body, _ := infraRequest(t, mux, admin, "POST", endpoint+"/install", input)
			codes <- code
			bodies <- asMap(body["attributes"])
		}()
	}
	wg.Wait()
	close(codes)
	close(bodies)
	created := 0
	for code := range codes {
		if code == 201 {
			created++
		} else if code != 200 {
			t.Fatalf("install status %d", code)
		}
	}
	if created != 1 || wings.Creates != 1 {
		t.Fatal("concurrent retries created duplicate servers")
	}
	var saved []byte
	for body := range bodies {
		raw, _ := json.Marshal(body["ports"])
		if saved == nil {
			saved = raw
		} else if string(saved) != string(raw) {
			t.Fatal("retry lost plan metadata")
		}
	}
	input["request_id"] = newUUID()
	second := asMap(infraExpect(t, mux, admin, "POST", endpoint+"/install", input, 201)["attributes"])
	ports := asMap(second["ports"])
	first := asMap(asSlice(ports["ports"])[0])
	if num(first["port"]) != 3980 || str(first["reason"]) == "" {
		t.Fatal("assigned port was stolen or fallback explanation lost", ports)
	}
	count, _ = a.one(ctx, "SELECT count(*) n FROM allocations WHERE server_id IS NOT NULL")
	if num(count["n"]) != 2 {
		t.Fatal("allocations not assigned")
	}
}

func TestAutomaticSteamPortsPostgresEmptyNode(t *testing.T) {
	a, mux, admin, node, _ := steamGamesFixture(t)
	ctx := context.Background()
	if err := a.exec(ctx, "DELETE FROM allocations WHERE node_id=$1", node["id"]); err != nil {
		t.Fatal(err)
	}
	options := asMap(infraExpect(t, mux, admin, "GET", "/api/client/game-library/steam/satisfactory", nil, 200)["attributes"])
	n := asMap(asSlice(options["nodes"])[0])
	if !boolean(n["automatic_ports"]) || !boolean(n["setup_available"]) {
		t.Fatal(n)
	}
	infraExpect(t, mux, admin, "POST", "/api/client/game-library/steam/satisfactory/ports", M{"node_id": node["id"]}, 200)
	preview := asMap(infraExpect(t, mux, admin, "POST", "/api/client/game-library/steam/satisfactory/ports", M{"node_id": node["id"], "environment": M{"RELIABLE_PORT": "29000", "SRCDS_BETAPASS": "not-persisted"}}, 200)["attributes"])
	if num(asMap(asSlice(preview["ports"])[1])["port"]) != 29000 {
		t.Fatal("Steam preview ignored reliable port")
	}
	infraExpect(t, mux, admin, "POST", "/api/client/game-library/steam/satisfactory/ports", M{"node_id": node["id"], "environment": M{"RELIABLE_PORT": "80"}}, 422)
	for _, game := range []string{"satisfactory", "valheim", "7days"} {
		input := steamGamesInput(game, node)
		body := asMap(infraExpect(t, mux, admin, "POST", "/api/client/game-library/steam/"+game+"/install", input, 201)["attributes"])
		if len(asSlice(asMap(body["ports"])["ports"])) == 0 {
			t.Fatal("missing plan")
		}
	}
}

func TestAutomaticGamePortCatalogLayouts(t *testing.T) {
	for _, entry := range gameTemplates().Entries {
		if gameTemplateSetupUnavailable(entry) != "" {
			continue
		}
		t.Run(entry.Path, func(t *testing.T) {
			_, vars, err := parseEggDocument(entry.Egg)
			if err != nil {
				t.Fatal(err)
			}
			env := M{}
			for _, v := range vars {
				env[str(v["env_variable"])] = v["default_value"]
			}
			plan, resolved, err := planGamePortLayout(M{}, nil, entry, env)
			if err != nil {
				t.Fatal(err)
			}
			rows := []M{}
			for i, p := range plan.Ports {
				rows = append(rows, M{"id": i + 1, "port": p.Port, "ip": plan.IP})
			}
			if err = validateTemplatePortLayout(entry, rows[0], rows[1:]); err != nil {
				t.Fatal(err)
			}
			if err = validateTemplatePortRules(entry, resolved, rows[0], rows[1:]); err != nil {
				t.Fatal(err)
			}
		})
	}
}
