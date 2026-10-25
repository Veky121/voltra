package panel

import "testing"

func TestSTKDiscoveryRecipePortPlan(t *testing.T) {
	var entry gameTemplate
	for _, candidate := range gameTemplates().Entries {
		if candidate.Path == "SuperTuxKart/egg-super-tux-kart.json" {
			entry = candidate
			break
		}
	}
	if entry.RequiredPorts != 2 || gamePreferredPort(entry) != 2759 {
		t.Fatal("STK must reserve separate game and discovery ports", entry.RequiredPorts)
	}
	env := M{}
	for _, raw := range asSlice(entry.Egg["variables"]) {
		v := asMap(raw)
		env[str(v["env_variable"])] = v["default_value"]
	}
	if str(env["DISCOVERY_PORT"]) != "2757" {
		t.Fatal("stock discovery preference missing")
	}
	node := M{"daemon_listen": 18090, "daemon_sftp": 12030}
	for _, tc := range []struct {
		name string
		rows []M
		want int64
	}{
		{"stock", nil, 2757},
		{"discovery_busy", []M{{"ip": "0.0.0.0", "port": 2757, "server_id": 1}}, 2760},
	} {
		t.Run(tc.name, func(t *testing.T) {
			plan, resolved, err := planGamePortLayout(node, tc.rows, entry, env)
			if err != nil {
				t.Fatal(err)
			}
			if len(plan.Ports) != 2 || plan.Ports[0].Port != 2759 || plan.Ports[1].Port != tc.want || num(resolved["DISCOVERY_PORT"]) != tc.want {
				t.Fatal("wrong game/discovery allocation", plan, resolved)
			}
			if tc.want != 2757 && plan.Ports[1].Reason == "" {
				t.Fatal("custom discovery needs an explicit fallback reason")
			}
		})
	}
	for _, tc := range []struct{ primary, discovery int64 }{{2758, 2757}, {2759, 2758}, {2759, 2759}} {
		if validateTemplatePortRules(entry, M{"DISCOVERY_PORT": str(tc.discovery)}, M{"ip": "127.0.0.1", "port": tc.primary}, []M{{"ip": "127.0.0.1", "port": tc.discovery}}) == nil {
			t.Fatal("STK accepted invalid native port combination", tc)
		}
	}
}
