package panel

import (
	"context"
	"net/http"
	"reflect"
	"testing"
)

// Actual panel routes and isolated real PostgreSQL. Wings is a local explicit
// HTTP fixture; zero calls must occur before invalid input is refused.
func TestSetupValidationRoutesPostgres(t *testing.T) {
	a, _, admin, node, wings := steamGamesFixture(t)
	ctx := context.Background()
	rules, _ := setupValidationFixture()
	var entry gameTemplate
	for _, candidate := range gameTemplates().Entries {
		if candidate.Path == "astroneer/egg-astroneer-dedicated-server.json" {
			entry = candidate
			break
		}
	}
	if entry.Path == "" {
		t.Fatal("Astroneer recipe missing")
	}
	// Clone only the map being changed, leaving the canonical egg untouched.
	cloned := M{}
	for k, v := range entry.Egg {
		cloned[k] = v
	}
	entry.Egg = cloned
	entry.SetupValidation = rules
	entry.ID, entry.Path, entry.SHA256 = newUUID(), "test/setup-public-ip", newUUID()
	length := len(templates.Entries)
	templates.Entries = append(templates.Entries, entry)
	t.Cleanup(func() { templates.Entries = templates.Entries[:length] })
	mux := http.NewServeMux()
	a.registerGameTemplates(mux)
	endpoint := "/api/client/game-library/templates/" + entry.ID
	_, variables, err := parseEggDocument(entry.Egg)
	if err != nil {
		t.Fatal(err)
	}
	image := ""
	for _, value := range asMap(entry.Egg["docker_images"]) {
		image = str(value)
		break
	}
	if _, err := a.insert(ctx, "allocations", M{"node_id": node["id"], "ip": "127.0.0.1", "port": 29298, "notes": "preserve existing allocation"}); err != nil {
		t.Fatal(err)
	}
	snapshot := func() M {
		row, e := a.one(ctx, "SELECT (SELECT count(*) FROM allocations) allocations,(SELECT count(*) FROM servers) servers,(SELECT count(*) FROM eggs) eggs,(SELECT count(*) FROM egg_variables) variables,(SELECT count(*) FROM nests) nests,(SELECT count(*) FROM server_variables) server_variables,(SELECT jsonb_agg(to_jsonb(a) ORDER BY id)::text FROM allocations a) allocation_rows")
		if e != nil {
			t.Fatal(e)
		}
		return row
	}
	before := snapshot()
	for _, value := range []string{"", "not-an-address", "127.0.0.1", "0.0.0.0", "10.0.0.1", "172.16.0.1", "192.168.0.1", "169.254.1.1", "100.64.0.1", "192.0.2.1", "198.51.100.1", "203.0.113.1", "224.0.0.1", "255.255.255.255", "::1", "2001:4860:4860::8888", "1.1.1.1\nInjected=true"} {
		env := M{}
		for _, v := range variables {
			env[str(v["env_variable"])] = v["default_value"]
		}
		env["PUBLIC_IP"] = value
		for _, route := range []string{"ports", "install"} {
			t.Run(route+"/"+value, func(t *testing.T) {
				input := M{"node_id": node["id"], "environment": env, "name": "Refused before mutation", "request_id": newUUID(), "memory": 4096, "disk": 8192, "image": image, "automatic_ports": true}
				infraExpect(t, mux, admin, "POST", endpoint+"/"+route, input, 422)
				if !reflect.DeepEqual(before, snapshot()) || wings.Creates != 0 {
					t.Fatal("invalid setup mutated rows or reached Wings")
				}
			})
		}
	}
	for _, value := range []string{"1.1.1.1", "8.8.8.8", "192.0.0.9", "192.0.0.10"} {
		t.Run("accepted-preview/"+value, func(t *testing.T) {
			env := M{}
			for _, v := range variables {
				env[str(v["env_variable"])] = v["default_value"]
			}
			env["PUBLIC_IP"] = value
			infraExpect(t, mux, admin, "POST", endpoint+"/ports", M{"node_id": node["id"], "environment": env}, 200)
			if !reflect.DeepEqual(before, snapshot()) || wings.Creates != 0 {
				t.Fatal("preview mutated rows or reached Wings")
			}
		})
	}
	got, ok := templateSummary(entry)["setup_validation"].([]templateSetupValidation)
	if !ok || !reflect.DeepEqual(got, rules) {
		t.Fatal("template response dropped validation metadata")
	}
	// A trusted metadata error is separate from a bad user value and also preflight.
	templates.Entries[length].SetupValidation = []templateSetupValidation{rules[0], rules[0]}
	env := M{}
	for _, v := range variables {
		env[str(v["env_variable"])] = v["default_value"]
	}
	env["PUBLIC_IP"] = "8.8.8.8"
	for _, route := range []string{"ports", "install"} {
		input := M{"node_id": node["id"], "environment": env, "name": "Invalid metadata", "request_id": newUUID(), "memory": 4096, "disk": 8192, "image": image, "automatic_ports": true}
		infraExpect(t, mux, admin, "POST", endpoint+"/"+route, input, 409)
		if !reflect.DeepEqual(before, snapshot()) || wings.Creates != 0 {
			t.Fatal("invalid metadata mutated state")
		}
	}
}
