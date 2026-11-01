package panel

import (
	"context"
	"encoding/json"
	"net/http"
	"reflect"
	"testing"
)

func crewlinkPrimaryPortFixture(t *testing.T) gameTemplate {
	t.Helper()
	for _, candidate := range gameTemplates().Entries {
		if candidate.Path == "among_us/bettercrewlink_server/egg-better-crewlink-server.json" {
			body, err := json.Marshal(candidate.Egg)
			if err != nil {
				t.Fatal(err)
			}
			candidate.Egg = M{}
			if err = json.Unmarshal(body, &candidate.Egg); err != nil {
				t.Fatal(err)
			}
			candidate.PrimaryPortEnv = "PORT"
			return candidate
		}
	}
	t.Fatal("CrewLink canonical recipe missing")
	return gameTemplate{}
}

func TestCrewlinkPrimaryPortPlanning(t *testing.T) {
	entry := crewlinkPrimaryPortFixture(t)
	node := M{"daemon_listen": 18100, "daemon_sftp": 12100}
	for _, tc := range []struct {
		name string
		port string
		rows []M
		want int64
	}{
		{"blank", "", nil, 27015},
		{"explicit", "29191", nil, 29191},
		{"same_as_preferred", "27015", nil, 27015},
		{"upper_boundary", "65535", nil, 65535},
		{"reuse_free", "29191", []M{{"ip": "127.0.0.1", "port": 29191}}, 29191},
		{"occupied", "29191", []M{{"ip": "127.0.0.1", "port": 29191, "server_id": 99}}, 0},
		{"wildcard_conflict", "29191", []M{{"ip": "0.0.0.0", "port": 29191, "server_id": 99}}, 0},
		{"node_probe_conflict", "29191", []M{{"ip": "127.0.0.1", "port": 29191, "server_id": -1, "notes": "tcp_in_use"}}, 0},
		{"management_reserved", "18100", nil, 0},
		{"operator_reserved", "29192", nil, 29192},
		{"zero", "0", nil, 0}, {"negative", "-1", nil, 0}, {"too_large", "65536", nil, 0},
		{"leading_zero", "029191", nil, 0}, {"leading_plus", "+29191", nil, 0},
		{"whitespace", " 29191", nil, 0}, {"decimal", "29191.0", nil, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			env := M{"PORT": tc.port, "NAME": "unchanged"}
			before, _ := json.Marshal(env)
			plan, resolved, err := planGamePortLayout(node, tc.rows, entry, env)
			if tc.want == 0 {
				if err == nil || len(plan.Ports) != 0 {
					t.Fatalf("invalid explicit listener silently moved: %+v %v", plan, err)
				}
				return
			}
			if err != nil || len(plan.Ports) != 1 || plan.Ports[0].Port != tc.want || resolved["PORT"] != tc.port {
				t.Fatalf("wrong single listener plan: %+v %v %v", plan, resolved, err)
			}
			after, _ := json.Marshal(env)
			if string(before) != string(after) {
				t.Fatal("planning mutated caller controls")
			}
		})
	}
	node["_operator_reserved_ports"] = []int64{29192}
	if _, _, err := planGamePortLayout(node, nil, entry, M{"PORT": "29192"}); err == nil {
		t.Fatal("explicit listener ignored operator reservation")
	}
	entry.PrimaryPortEnv = ""
	plan, _, err := planGamePortLayout(node, nil, entry, M{"PORT": "29191"})
	if err != nil || plan.Ports[0].Port != 27015 {
		t.Fatal("undeclared PORT changed unrelated recipe behavior", plan, err)
	}
}

func TestCrewlinkPrimaryPortRuntimeAndMetadata(t *testing.T) {
	entry := crewlinkPrimaryPortFixture(t)
	primary := M{"ip": "127.0.0.1", "port": 29190}
	for _, tc := range []struct {
		name  string
		port  string
		extra []M
		valid bool
	}{
		{"blank", "", nil, true}, {"primary", "29190", nil, true},
		{"manual_secondary", "29191", []M{{"ip": "127.0.0.1", "port": 29191}}, true},
		{"manual_secondary_other_bind", "29191", []M{{"ip": "192.0.2.1", "port": 29191}}, true},
		{"unallocated", "29191", nil, false}, {"noncanonical", "029190", nil, false},
		{"zero", "0", nil, false}, {"invalid", "word", nil, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if (validateTemplatePortRules(entry, M{"PORT": tc.port}, primary, tc.extra) == nil) != tc.valid {
				t.Fatal("runtime membership validation changed manual/default semantics")
			}
		})
	}
	for _, name := range []string{"MISSING", "PORT\n", "1PORT"} {
		invalid := entry
		invalid.PrimaryPortEnv = name
		if _, _, err := templatePrimaryListenerPort(invalid, M{}); err == nil {
			t.Fatal("invalid primary listener declaration accepted", name)
		}
	}
	duplicate := crewlinkPrimaryPortFixture(t)
	duplicate.Egg["variables"] = append(asSlice(duplicate.Egg["variables"]), M{"env_variable": "PORT"})
	if _, _, err := templatePrimaryListenerPort(duplicate, M{}); err == nil {
		t.Fatal("ambiguous declared variable accepted")
	}
	if port, explicit, err := templatePrimaryListenerPort(entry, M{"PORT": "1"}); err != nil || !explicit || port != 1 {
		t.Fatal("canonical listener parsing lost original 1..65535 domain")
	}
	var override gameTemplateOverride
	if err := json.Unmarshal([]byte(`{"primary_port_env":"PORT"}`), &override); err != nil || override.PrimaryPortEnv != "PORT" {
		t.Fatal("primary listener metadata not decoded", err)
	}
	if templateSummary(entry)["primary_port_env"] != "PORT" {
		t.Fatal("declared listener missing from template response")
	}
}

// Real PostgreSQL schemas and the actual ports/install routes. The existing
// explicit Wings HTTP fixture performs no publisher acquisition or game start.
func TestCrewlinkPrimaryPortRoutesPostgres(t *testing.T) {
	for _, mode := range []string{"blank", "explicit", "same_primary", "free_existing", "conflict", "invalid", "manual_secondary"} {
		t.Run(mode, func(t *testing.T) {
			a, _, admin, node, wings := steamGamesFixture(t)
			ctx := context.Background()
			entry := crewlinkPrimaryPortFixture(t)
			entry.ID, entry.Path, entry.SHA256 = newUUID(), "test/crewlink-primary-listener", newUUID()
			length := len(templates.Entries)
			templates.Entries = append(templates.Entries, entry)
			t.Cleanup(func() { templates.Entries = templates.Entries[:length] })
			mux := http.NewServeMux()
			a.registerGameTemplates(mux)
			endpoint := "/api/client/game-library/templates/" + entry.ID
			env, want, status := M{"PORT": "29191"}, int64(29191), 200
			if mode == "blank" {
				env["PORT"], want = "", 27015
			}
			if mode == "same_primary" {
				env["PORT"], want = "27015", 27015
			}
			if mode == "invalid" {
				env["PORT"], status = "029191", 422
			}
			if mode == "free_existing" || mode == "conflict" {
				allocation, err := a.insert(ctx, "allocations", M{"node_id": node["id"], "ip": "127.0.0.1", "port": 29191})
				if err != nil {
					t.Fatal(err)
				}
				if mode == "conflict" {
					egg, variables, err := parseEggDocument(entry.Egg)
					if err != nil {
						t.Fatal(err)
					}
					imported, err := a.ensureGameTemplateEgg(ctx, entry, egg, variables)
					if err != nil {
						t.Fatal(err)
					}
					uuid := newUUID()
					server, err := a.insert(ctx, "servers", M{"uuid": uuid, "uuid_short": uuid[:8], "identifier": uuid[:8], "name": "FK-backed listener occupant", "owner_id": admin, "node_id": node["id"], "nest_id": imported["nest_id"], "egg_id": imported["id"], "image": "fixture-only", "allocation_id": allocation["id"]})
					if err != nil {
						t.Fatal(err)
					}
					if _, err = a.update(ctx, "allocations", num(allocation["id"]), M{"server_id": server["id"]}); err != nil {
						t.Fatal(err)
					}
					status = 422
				}
			}
			before, _ := a.one(ctx, "SELECT (SELECT count(*) FROM allocations) allocations,(SELECT count(*) FROM servers) servers")
			preview := infraExpect(t, mux, admin, "POST", endpoint+"/ports", M{"node_id": node["id"], "environment": env}, status)
			after, _ := a.one(ctx, "SELECT (SELECT count(*) FROM allocations) allocations,(SELECT count(*) FROM servers) servers")
			if !reflect.DeepEqual(before, after) || wings.Creates != 0 {
				t.Fatal("port preview mutated database or reached publisher installation")
			}
			if status != 200 {
				return
			}
			ports := asSlice(asMap(preview["attributes"])["ports"])
			if len(ports) != 1 || num(asMap(ports[0])["port"]) != want {
				t.Fatal("ports route ignored listener or forced an unnecessary extra allocation", preview)
			}
			image := ""
			for _, value := range asMap(entry.Egg["docker_images"]) {
				image = str(value)
				break
			}
			input := M{"name": "CrewLink listener fixture", "request_id": newUUID(), "memory": 512, "disk": 4096, "image": image, "node_id": node["id"], "automatic_ports": true, "environment": env}
			if mode == "manual_secondary" {
				primary, err := a.insert(ctx, "allocations", M{"node_id": node["id"], "ip": "127.0.0.1", "port": 29190})
				if err != nil {
					t.Fatal(err)
				}
				secondary, err := a.insert(ctx, "allocations", M{"node_id": node["id"], "ip": "127.0.0.1", "port": 29191})
				if err != nil {
					t.Fatal(err)
				}
				delete(input, "automatic_ports")
				delete(input, "node_id")
				input["allocation_id"], input["allocation_additional"] = primary["id"], []any{secondary["id"]}
				want = 29190
			}
			created := asMap(infraExpect(t, mux, admin, "POST", endpoint+"/install", input, 201)["attributes"])
			server, err := a.one(ctx, "SELECT s.id,a.port FROM servers s JOIN allocations a ON a.id=s.allocation_id WHERE s.uuid_short=$1", created["identifier"])
			if err != nil || num(server["port"]) != want || wings.Creates != 1 {
				t.Fatal("actual install route did not use the planned/manual primary", server, err)
			}
			persisted, err := a.one(ctx, "SELECT sv.variable_value FROM server_variables sv JOIN egg_variables v ON v.id=sv.variable_id WHERE sv.server_id=$1 AND v.env_variable='PORT'", server["id"])
			if err != nil || str(persisted["variable_value"]) != str(env["PORT"]) {
				t.Fatal("install changed original blank/explicit control", persisted, err)
			}
			assigned, err := a.one(ctx, "SELECT count(*) n FROM allocations WHERE server_id=$1", server["id"])
			count := int64(1)
			if mode == "manual_secondary" {
				count = 2
			}
			if err != nil || num(assigned["n"]) != count {
				t.Fatal("wrong allocation count", assigned, err)
			}
		})
	}
}
