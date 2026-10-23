package panel

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"
)

// Real PostgreSQL route acceptance; Wings is the existing explicit HTTP fixture.
// Each subtest has infraTestApp's random schema and no live game resources.
func TestGameTemplateAutomaticPortProvisioning(t *testing.T) {
	for _, mode := range []string{"holdfast_auto", "explicit_later_role", "rcon_enabled", "rcon_disabled", "service_pair_auto", "service_pair_explicit"} {
		t.Run(mode, func(t *testing.T) {
			a, _, admin, node, wings := steamGamesFixture(t)
			ctx := context.Background()
			mux := http.NewServeMux()
			a.registerGameTemplates(mux)
			var original gameTemplate
			for _, candidate := range gameTemplates().Entries {
				if candidate.Path == "openttd/egg-open-t-t-d-server.json" {
					original = candidate
					break
				}
			}
			body, _ := json.Marshal(original.Egg)
			egg := M{}
			if err := json.Unmarshal(body, &egg); err != nil {
				t.Fatal(err)
			}
			variable := func(key, def string) M {
				return M{"name": key, "env_variable": key, "default_value": def, "rules": "nullable|integer|between:1,65535", "user_viewable": true, "user_editable": true}
			}
			env := M{}
			vars := asSlice(egg["variables"])
			role := func(key string) templatePortRule {
				return templatePortRule{Environment: key, Condition: "nonzero", AllocatedValue: true, AutoAllocate: true, ExcludePrimary: true, Minimum: 1, Maximum: 65535, Count: 3}
			}
			entry := original
			entry.ID = newUUID()
			entry.Path = "test/automatic-ports-" + entry.ID
			entry.SHA256 = newUUID()
			entry.Egg = egg
			entry.RequiredPorts = 3
			entry.ConsecutivePorts = false
			entry.ConsecutivePortsCount = 0
			entry.ConsecutivePrimaryOffset = 0
			entry.PortRules = []templatePortRule{role("COMM"), role("QUERY")}
			vars = append(vars, variable("COMM", ""), variable("QUERY", ""))
			pairMode := mode == "service_pair_auto" || mode == "service_pair_explicit"
			if pairMode {
				entry.RequiredPorts = 6
				query := role("QUERY")
				query.Count = 6
				query.AllocatedOffsets = []int{1}
				comm := role("COMM")
				comm.Count = 6
				entry.PortRules = []templatePortRule{{Minimum: 1, Maximum: 65535, Count: 6, Offsets: []int{1}}, comm, query}
			}
			if mode == "rcon_enabled" || mode == "rcon_disabled" {
				entry.RequiredPorts = 2
				rule := role("RCON_PORT")
				rule.WhenEnvironment = "RCON"
				rule.WhenValue = "true"
				rule.ExcludeOffsets = []int{-1}
				entry.PortRules = []templatePortRule{{Minimum: 1, Maximum: 65535, Count: 2, Offsets: []int{-1}}, rule}
				vars = append(asSlice(egg["variables"]), M{"name": "RCON", "env_variable": "RCON", "default_value": "false", "rules": "required|in:true,false", "user_viewable": true, "user_editable": true}, variable("RCON_PORT", "4253"))
			}
			egg["variables"] = vars
			_, definitions, err := parseEggDocument(egg)
			if err != nil {
				t.Fatal(err)
			}
			for _, v := range definitions {
				env[str(v["env_variable"])] = v["default_value"]
			}
			if mode == "explicit_later_role" {
				env["QUERY"] = "28001"
			}
			if mode == "service_pair_explicit" {
				env["QUERY"] = "28003"
			}
			if mode == "rcon_enabled" {
				env["RCON"] = "true"
				env["RCON_PORT"] = ""
			}
			// Test-only catalog entry; never writes the shared overrides or production DB.
			length := len(templates.Entries)
			templates.Entries = append(templates.Entries, entry)
			t.Cleanup(func() { templates.Entries = templates.Entries[:length] })
			allocations := map[int]int64{}
			ports := []int{28000, 28001, 28002}
			if pairMode {
				ports = append(ports, 28003, 28004, 28009)
			}
			for _, port := range ports {
				row, err := a.insert(ctx, "allocations", M{"node_id": node["id"], "ip": "127.0.0.1", "port": port})
				if err != nil {
					t.Fatal(err)
				}
				allocations[port] = num(row["id"])
			}
			wrong, err := a.insert(ctx, "allocations", M{"node_id": node["id"], "ip": "192.0.2.2", "port": 28003})
			if err != nil {
				t.Fatal(err)
			}
			primary := allocations[28000]
			additional := []any{allocations[28002], allocations[28001]}
			if pairMode {
				additional = append(additional, allocations[28003], allocations[28004], allocations[28009])
			}
			if mode == "rcon_enabled" || mode == "rcon_disabled" {
				primary = allocations[28001]
				additional = []any{allocations[28000]}
				if mode == "rcon_enabled" {
					additional = append(additional, allocations[28002])
				}
			}
			image := ""
			for _, v := range asMap(egg["docker_images"]) {
				image = str(v)
				break
			}
			input := M{"name": "Automatic service fixture", "request_id": newUUID(), "memory": 2048, "disk": 10240, "image": image, "allocation_id": primary, "allocation_additional": additional, "environment": env}
			endpoint := "/api/client/game-library/templates/" + entry.ID + "/install"
			if pairMode {
				for _, values := range []M{{"COMM": "", "QUERY": "28004"}, {"COMM": "28004", "QUERY": "28003"}, {"COMM": "", "QUERY": "28001"}} {
					invalid := M{}
					for k, v := range input {
						invalid[k] = v
					}
					copyEnv := M{}
					for k, v := range env {
						copyEnv[k] = v
					}
					for k, v := range values {
						copyEnv[k] = v
					}
					invalid["environment"] = copyEnv
					infraExpect(t, mux, admin, "POST", endpoint, invalid, 422)
				}
				if wings.Creates != 0 {
					t.Fatal("invalid service pair reached Wings")
				}
			}
			if mode == "holdfast_auto" {
				for _, spec := range []struct {
					env        M
					additional []any
				}{{M{"COMM": "", "QUERY": ""}, additional[:1]}, {M{"COMM": "28001", "QUERY": "28001"}, additional}, {M{"COMM": "28000", "QUERY": ""}, additional}, {M{"COMM": "28009", "QUERY": ""}, additional}, {M{"COMM": "", "QUERY": ""}, []any{wrong["id"], allocations[28001]}}} {
					invalid := M{}
					for k, v := range input {
						invalid[k] = v
					}
					values := M{}
					for k, v := range env {
						values[k] = v
					}
					for k, v := range spec.env {
						values[k] = v
					}
					invalid["environment"] = values
					invalid["allocation_additional"] = spec.additional
					infraExpect(t, mux, admin, "POST", endpoint, invalid, 422)
				}
				if wings.Creates != 0 {
					t.Fatal("invalid allocation request reached Wings")
				}
			}
			created := asMap(infraExpect(t, mux, admin, "POST", endpoint, input, 201)["attributes"])
			retry := asMap(infraExpect(t, mux, admin, "POST", endpoint, input, 200)["attributes"])
			if created["identifier"] != retry["identifier"] || wings.Creates != 1 {
				t.Fatal("raw blank retry was not idempotent")
			}
			rows, err := a.query(ctx, "SELECT v.env_variable,sv.variable_value FROM server_variables sv JOIN egg_variables v ON v.id=sv.variable_id JOIN servers s ON s.id=sv.server_id WHERE s.uuid_short=$1", created["identifier"])
			if err != nil {
				t.Fatal(err)
			}
			persisted := M{}
			for _, row := range rows {
				persisted[str(row["env_variable"])] = row["variable_value"]
			}
			switch mode {
			case "service_pair_auto", "service_pair_explicit":
				if persisted["COMM"] != "28002" || persisted["QUERY"] != "28003" {
					t.Fatal(persisted)
				}
			case "holdfast_auto":
				if persisted["COMM"] != "28001" || persisted["QUERY"] != "28002" {
					t.Fatal(persisted)
				}
				if env["COMM"] != "" || env["QUERY"] != "" {
					t.Fatal("raw request was mutated")
				}
				env["COMM"] = "28001"
				infraExpect(t, mux, admin, "POST", endpoint, input, 409)
			case "explicit_later_role":
				if persisted["COMM"] != "28002" || persisted["QUERY"] != "28001" {
					t.Fatal(persisted)
				}
			case "rcon_enabled":
				if persisted["RCON_PORT"] != "28002" {
					t.Fatal(persisted)
				}
			case "rcon_disabled":
				if persisted["RCON_PORT"] != "4253" {
					t.Fatal("inactive legacy default was rebound", persisted)
				}
			}
		})
	}
}
