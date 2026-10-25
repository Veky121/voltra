package panel

import (
	"context"
	"encoding/json"
	"net/http"
	"reflect"
	"strconv"
	"testing"
)

func TestTemplateAbsolutePortPostgresPreviewAndReject(t *testing.T) {
	a, _, admin, node, wings := steamGamesFixture(t)
	ctx := context.Background()
	mux := http.NewServeMux()
	a.registerGameTemplates(mux)
	var entry gameTemplate
	for _, candidate := range gameTemplates().Entries {
		if candidate.Path == "openttd/egg-open-t-t-d-server.json" {
			entry = candidate
			break
		}
	}
	raw, _ := json.Marshal(entry.Egg)
	var egg M
	if json.Unmarshal(raw, &egg) != nil {
		t.Fatal("egg clone")
	}
	egg["variables"] = append(asSlice(egg["variables"]), M{"name": "Discovery", "env_variable": "DISCOVERY_PORT", "default_value": "2757", "rules": "nullable|integer|between:1,65535", "user_viewable": true, "user_editable": true})
	entry.ID = newUUID()
	entry.Path = "test/absolute-ports-" + entry.ID
	entry.SHA256 = newUUID()
	entry.Egg = egg
	entry.Defaults = M{"port": 2759}
	entry.RequiredPorts = 2
	entry.ConsecutivePorts = false
	entry.ConsecutivePortsCount = 0
	entry.ConsecutivePrimaryOffset = 0
	entry.PortRules = absolutePortFixture().PortRules
	length := len(templates.Entries)
	templates.Entries = append(templates.Entries, entry)
	t.Cleanup(func() { templates.Entries = templates.Entries[:length] })
	ids := map[int]int64{}
	for _, port := range []int{2757, 2758, 2759, 2760} {
		row, e := a.insert(ctx, "allocations", M{"node_id": node["id"], "ip": "127.0.0.1", "port": port})
		if e != nil {
			t.Fatal(e)
		}
		ids[port] = num(row["id"])
	}
	count := func() string {
		state := M{}
		for _, table := range []string{"servers", "allocations", "server_variables"} {
			row, e := a.one(ctx, "SELECT count(*) n FROM "+table)
			if e != nil {
				t.Fatal(e)
			}
			state[table] = row["n"]
		}
		owners, e := a.query(ctx, "SELECT id,server_id FROM allocations ORDER BY id")
		if e != nil {
			t.Fatal(e)
		}
		state["allocation_owners"] = owners
		b, _ := json.Marshal(state)
		return string(b)
	}
	before := count()
	endpoint := "/api/client/game-library/templates/" + entry.ID
	preview := asMap(infraExpect(t, mux, admin, "POST", endpoint+"/ports", M{"node_id": node["id"], "environment": M{"DISCOVERY_PORT": "2757"}}, 200)["attributes"])
	ports := asSlice(preview["ports"])
	if len(ports) != 2 || num(asMap(ports[0])["port"]) != 2759 || num(asMap(ports[1])["port"]) != 2757 {
		t.Fatal(preview)
	}
	image := ""
	for _, v := range asMap(egg["docker_images"]) {
		image = str(v)
		break
	}
	for _, spec := range []struct{ primary, discovery int }{{2759, 2758}, {2758, 2757}} {
		input := M{"name": "Absolute port rejected fixture", "request_id": newUUID(), "memory": 2048, "disk": 10240, "image": image, "allocation_id": ids[spec.primary], "allocation_additional": []any{ids[spec.discovery]}, "environment": M{"DISCOVERY_PORT": strconv.Itoa(spec.discovery)}}
		infraExpect(t, mux, admin, "POST", endpoint+"/install", input, 422)
	}
	if before != count() || wings.Creates != 0 {
		t.Fatal("preview/rejection mutated state")
	}
}

func absolutePortFixture() gameTemplate {
	return gameTemplate{Defaults: M{"port": 2759}, RequiredPorts: 2, PortRules: []templatePortRule{{Environment: "DISCOVERY_PORT", Condition: "nonzero", AllocatedValue: true, AutoAllocate: true, ExcludePrimary: true, ExcludePorts: []int{2758}, Minimum: 1, Maximum: 65535, Count: 2}}}
}
func TestTemplateAbsolutePortMetadata(t *testing.T) {
	rule := absolutePortFixture().PortRules[0]
	for _, ports := range [][]int{{0}, {65536}, {-1}, {2758, 2758}} {
		r := rule
		r.ExcludePorts = ports
		if validateTemplatePortRuleMetadata(r) == nil {
			t.Fatal("accepted", ports)
		}
	}
	rule.AllocatedValue = false
	if validateTemplatePortRuleMetadata(rule) == nil {
		t.Fatal("nonallocated exclusion accepted")
	}
	entry := absolutePortFixture()
	raw, _ := json.Marshal(entry.PortRules[0])
	var decoded templatePortRule
	if json.Unmarshal(raw, &decoded) != nil || !reflect.DeepEqual(decoded.ExcludePorts, []int{2758}) {
		t.Fatal("JSON contract lost")
	}
}
func TestTemplateAbsolutePortPlannerAndRuntime(t *testing.T) {
	entry := absolutePortFixture()
	node := M{}
	env := M{"DISCOVERY_PORT": "2757"}
	plan, _, e := planGamePortLayout(node, nil, entry, env)
	if e != nil || plan.Ports[0].Port != 2759 || plan.Ports[1].Port != 2757 {
		t.Fatal(plan, e)
	}
	rows := []M{{"ip": "0.0.0.0", "port": 2757, "server_id": 1}}
	plan, resolved, e := planGamePortLayout(node, rows, entry, M{"DISCOVERY_PORT": ""})
	if e != nil || plan.Ports[0].Port != 2759 || resolved["DISCOVERY_PORT"] != "2760" {
		t.Fatal(plan, resolved, e)
	}
	plan, resolved, e = planGamePortLayout(node, rows, entry, env)
	if e != nil || resolved["DISCOVERY_PORT"] != "2760" {
		t.Fatal("occupied default did not move past native port and primary", plan, resolved, e)
	}
	entry.Defaults = M{"port": 2757}
	plan, _, e = planGamePortLayout(node, rows, entry, M{"DISCOVERY_PORT": ""})
	if e != nil || plan.Ports[0].Port != 2759 || plan.Ports[1].Port != 2760 {
		t.Fatal("primary fallback", plan, e)
	}
	primary := M{"port": 2759, "ip": "0.0.0.0"}
	extra := []M{{"port": 2757, "ip": "0.0.0.0"}, {"port": 2758, "ip": "0.0.0.0"}, {"port": 2760, "ip": "0.0.0.0"}}
	for _, spec := range []struct {
		p   M
		a   []M
		env M
	}{{primary, extra, M{"DISCOVERY_PORT": "2758"}}, {M{"port": 2758, "ip": "0.0.0.0"}, extra[:1], env}, {primary, extra, env}} {
		before, _ := json.Marshal(spec.env)
		if validateTemplatePortRules(entry, spec.env, spec.p, spec.a) == nil {
			t.Fatal("forbidden selected port accepted")
		}
		after, _ := json.Marshal(spec.env)
		if string(before) != string(after) {
			t.Fatal("request mutated")
		}
	}
	if _, _, e = planGamePortLayout(node, nil, entry, M{"DISCOVERY_PORT": "2758"}); e == nil {
		t.Fatal("explicit excluded port moved silently")
	}
	pair := absolutePortFixture()
	pair.RequiredPorts = 3
	pair.PortRules[0].Count = 3
	pair.PortRules[0].AllocatedOffsets = []int{1}
	if _, _, e = planGamePortLayout(node, nil, pair, M{"DISCOVERY_PORT": "2757"}); e == nil {
		t.Fatal("excluded companion accepted")
	}
	if e = validateTemplatePortRules(pair, env, primary, extra[:2]); e == nil {
		t.Fatal("runtime excluded companion accepted")
	}
	if e = validateTemplatePortRules(absolutePortFixture(), env, primary, extra[:1]); e != nil {
		t.Fatal("valid default rejected", e)
	}
	inactive := absolutePortFixture()
	inactive.PortRules[0].WhenEnvironment = "ENABLED"
	inactive.PortRules[0].WhenValue = "true"
	if e = validateTemplatePortRules(inactive, M{"ENABLED": "false"}, M{"port": 2758, "ip": "0.0.0.0"}, nil); e != nil {
		t.Fatal("inactive exclusion applied", e)
	}
}
