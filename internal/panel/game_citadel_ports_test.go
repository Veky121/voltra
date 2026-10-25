package panel

import (
	"context"
	"encoding/json"
	"net/http"
	"reflect"
	"strconv"
	"strings"
	"testing"
)

// Real PostgreSQL in infraTestApp's disposable schema; daemon calls terminate
// at steamGamesWings' explicit HTTP fixture. No publisher process is executed.
func TestCitadelPortsPostgres(t *testing.T) {
	for _, mode := range []string{"automatic_query_conflict", "manual_exact", "manual_unavailable"} {
		t.Run(mode, func(t *testing.T) {
			a, _, admin, node, wings := steamGamesFixture(t)
			ctx := context.Background()
			var entry gameTemplate
			for _, candidate := range gameTemplates().Entries {
				if candidate.Path == "citadel/egg-citadel-forged-with-fire.json" {
					entry = candidate
					break
				}
			}
			if entry.ID == "" {
				t.Fatal("canonical Citadel recipe missing")
			}
			canonical, err := json.Marshal(entry.Egg)
			if err != nil {
				t.Fatal(err)
			}
			egg, variables, err := parseEggDocument(entry.Egg)
			if err != nil {
				t.Fatal(err)
			}
			var queryVariable M
			for _, variable := range variables {
				if str(variable["env_variable"]) == "QPORT" {
					queryVariable = variable
				}
			}
			if str(queryVariable["default_value"]) != "27015" || boolean(queryVariable["user_editable"]) || !boolean(queryVariable["user_viewable"]) {
				t.Fatal("original read-only query control changed", queryVariable)
			}
			if entry.RequiredPorts != 2 || len(entry.PortRules) != 1 || entry.PortRules[0].Environment != "QPORT" || entry.PortRules[0].AutoAllocate {
				t.Fatal("test must exercise actual legacy port metadata")
			}
			mux := http.NewServeMux()
			a.registerGameTemplates(mux)
			endpoint := "/api/client/game-library/templates/" + entry.ID
			query, err := a.insert(ctx, "allocations", M{"node_id": node["id"], "ip": "127.0.0.1", "port": 27015})
			if err != nil {
				t.Fatal(err)
			}
			if mode != "manual_exact" {
				// An actual foreign-key-backed occupant, not a synthetic invalid
				// server_id or an in-memory approximation of allocation conflict.
				imported, e := a.ensureGameTemplateEgg(ctx, entry, egg, variables)
				if e != nil {
					t.Fatal(e)
				}
				id := newUUID()
				occupant, e := a.insert(ctx, "servers", M{"uuid": id, "uuid_short": id[:8], "identifier": id[:8], "name": "isolated query occupant", "owner_id": admin, "node_id": node["id"], "nest_id": imported["nest_id"], "egg_id": imported["id"], "image": "fixture-only", "allocation_id": query["id"]})
				if e != nil {
					t.Fatal(e)
				}
				if e = a.exec(ctx, "UPDATE allocations SET server_id=$1 WHERE id=$2", occupant["id"], query["id"]); e != nil {
					t.Fatal(e)
				}
			}
			before, err := a.query(ctx, "SELECT * FROM allocations ORDER BY id")
			if err != nil {
				t.Fatal(err)
			}
			var previewQuery int64
			if mode == "automatic_query_conflict" {
				preview := asMap(infraExpect(t, mux, admin, "POST", endpoint+"/ports", M{"node_id": node["id"], "environment": M{"ADMIN_PASSWD": "isolated-admin"}}, 200)["attributes"])
				ports := asSlice(preview["ports"])
				if len(ports) != 2 || str(preview["ip"]) != "127.0.0.1" {
					t.Fatal("preview did not retain same-address two-port layout", preview)
				}
				for _, raw := range ports {
					port := asMap(raw)
					if str(port["role"]) == "QPORT" {
						previewQuery = num(port["port"])
						if previewQuery == 27015 || previewQuery < 1025 || previewQuery == num(asMap(ports[0])["port"]) || num(port["preferred_port"]) != 27015 || str(port["reason"]) == "" {
							t.Fatal("query conflict lost resolved/preferred port or explanation", port)
						}
					}
				}
				if previewQuery == 0 {
					t.Fatal("preview omitted actual QPORT role")
				}
				after, e := a.query(ctx, "SELECT * FROM allocations ORDER BY id")
				if e != nil || !reflect.DeepEqual(before, after) || wings.Creates != 0 || wings.Writes != 0 {
					t.Fatal("preview mutated allocation/daemon state", e)
				}
			}
			image := ""
			for _, value := range asMap(egg["docker_images"]) {
				image = str(value)
				break
			}
			input := M{"name": "Citadel port fixture", "request_id": newUUID(), "memory": 6144, "disk": 16384, "image": image, "environment": M{"ADMIN_PASSWD": "isolated-admin", "AUTO_UPDATE": "0"}}
			if mode == "automatic_query_conflict" {
				input["automatic_ports"], input["node_id"] = true, node["id"]
			} else {
				primary, e := a.one(ctx, "SELECT id FROM allocations WHERE node_id=$1 AND port=7777", node["id"])
				if e != nil {
					t.Fatal(e)
				}
				input["allocation_id"], input["allocation_additional"] = primary["id"], []any{query["id"]}
			}
			if mode == "manual_unavailable" {
				infraExpect(t, mux, admin, "POST", endpoint+"/install", input, 422)
				after, e := a.query(ctx, "SELECT * FROM allocations ORDER BY id")
				if e != nil || !reflect.DeepEqual(before, after) || wings.Creates != 0 {
					t.Fatal("failed manual exact request reassigned ports or reached daemon", e)
				}
				return
			}
			result := asMap(infraExpect(t, mux, admin, "POST", endpoint+"/install", input, 201)["attributes"])
			server, err := a.one(ctx, "SELECT * FROM servers WHERE uuid_short=$1", result["identifier"])
			if err != nil {
				t.Fatal(err)
			}
			want := "27015"
			if mode == "automatic_query_conflict" {
				want = strconv.FormatInt(previewQuery, 10)
			}
			stored, err := a.one(ctx, "SELECT sv.variable_value,ev.default_value,ev.user_editable,ev.user_viewable FROM server_variables sv JOIN egg_variables ev ON ev.id=sv.variable_id WHERE sv.server_id=$1 AND ev.env_variable='QPORT'", server["id"])
			if err != nil || str(stored["variable_value"]) != want || str(stored["default_value"]) != "27015" || boolean(stored["user_editable"]) || !boolean(stored["user_viewable"]) {
				t.Fatal("resolved override or original variable metadata lost", stored, err)
			}
			environment, err := a.serverEnvironment(ctx, server)
			if err != nil || str(environment["QPORT"]) != want {
				t.Fatal("resolved port absent from stored runtime environment", environment["QPORT"], err)
			}
			configuration, err := a.serverConfig(ctx, server)
			if err != nil {
				t.Fatal(err)
			}
			runtime := asMap(configuration["environment"])
			if str(runtime["QPORT"]) != want || !strings.Contains(","+str(runtime["VOLTRA_ALLOCATED_PORTS"])+",", ","+want+",") {
				t.Fatal("Wings configuration omitted resolved query/selected ports", runtime["QPORT"], runtime["VOLTRA_ALLOCATED_PORTS"])
			}
			assigned, err := a.query(ctx, "SELECT port FROM allocations WHERE server_id=$1 ORDER BY port", server["id"])
			if err != nil || len(assigned) != 2 {
				t.Fatal("wrong assigned layout", assigned, err)
			}
			matched := false
			for _, row := range assigned {
				matched = matched || strconv.FormatInt(num(row["port"]), 10) == want
			}
			if !matched || wings.Creates != 1 {
				t.Fatal("query override was not allocated or fixture create missing")
			}
			current, e := json.Marshal(entry.Egg)
			if e != nil || string(current) != string(canonical) {
				t.Fatal("install mutated canonical recipe/default metadata", e)
			}
		})
	}
}
