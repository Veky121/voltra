package panel

import (
	"reflect"
	"testing"
)

func TestTemplateAutomaticServicePorts(t *testing.T) {
	allocation := func(port int) M { return M{"ip": "192.0.2.1", "port": port} }
	role := func(key string) templatePortRule {
		return templatePortRule{Environment: key, Condition: "nonzero", AllocatedValue: true, AutoAllocate: true, ExcludePrimary: true, Minimum: 1, Maximum: 65535, Count: 3}
	}
	entry := gameTemplate{RequiredPorts: 3, PortRules: []templatePortRule{role("COMM"), role("QUERY")}}
	primary := allocation(28000)
	extra := []M{allocation(28002), allocation(28001)}
	for _, spec := range []struct {
		name  string
		env   M
		extra []M
		want  M
		valid bool
	}{
		{"two blank roles", M{"COMM": "", "QUERY": ""}, extra, M{"COMM": "28001", "QUERY": "28002"}, true},
		{"explicit later role reserved first", M{"COMM": "", "QUERY": "28001"}, extra, M{"COMM": "28002", "QUERY": "28001"}, true},
		{"exact explicit roles", M{"COMM": "28002", "QUERY": "28001"}, extra, M{"COMM": "28002", "QUERY": "28001"}, true},
		{"explicit role collision", M{"COMM": "28001", "QUERY": "28001"}, extra, nil, false},
		{"primary collision", M{"COMM": "28000", "QUERY": ""}, extra, nil, false},
		{"unallocated explicit", M{"COMM": "28003", "QUERY": ""}, extra, nil, false},
		{"insufficient selected ports", M{"COMM": "", "QUERY": ""}, extra[:1], nil, false},
		{"wrong address", M{"COMM": "", "QUERY": ""}, []M{{"ip": "192.0.2.2", "port": 28001}, allocation(28002)}, nil, false},
	} {
		t.Run(spec.name, func(t *testing.T) {
			raw := M{}
			for key, value := range spec.env {
				raw[key] = value
			}
			normalized, err := normalizeTemplatePortEnvironment(entry, spec.env, primary, spec.extra)
			if (err == nil) != spec.valid {
				t.Fatalf("normalization: %v", err)
			}
			if !reflect.DeepEqual(raw, spec.env) {
				t.Fatal("mutated raw idempotency environment")
			}
			if !spec.valid {
				return
			}
			if !reflect.DeepEqual(normalized, spec.want) {
				t.Fatalf("got %v want %v", normalized, spec.want)
			}
			again, err := normalizeTemplatePortEnvironment(entry, normalized, primary, spec.extra)
			if err != nil || !reflect.DeepEqual(again, normalized) {
				t.Fatal("normalization is not idempotent", err)
			}
			if err = validateTemplatePortRules(entry, normalized, primary, spec.extra); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestTemplateAutomaticGatedRCONAndLegacyCompatibility(t *testing.T) {
	primary := M{"ip": "192.0.2.1", "port": 28001}
	query := M{"ip": "192.0.2.1", "port": 28000}
	rcon := M{"ip": "192.0.2.1", "port": 28002}
	role := templatePortRule{Environment: "RCON_PORT", Condition: "nonzero", AllocatedValue: true, AutoAllocate: true, ExcludePrimary: true, ExcludeOffsets: []int{-1}, WhenEnvironment: "RCON", WhenValue: "true", Minimum: 1, Maximum: 65535, Count: 3}
	entry := gameTemplate{RequiredPorts: 2, PortRules: []templatePortRule{{Minimum: 1, Maximum: 65535, Count: 2, Offsets: []int{-1}}, role}}
	for _, spec := range []struct {
		name  string
		env   M
		extra []M
		want  string
		valid bool
	}{
		{"RCON auto", M{"RCON": "true", "RCON_PORT": ""}, []M{query, rcon}, "28002", true},
		{"inactive original default unallocated", M{"RCON": "false", "RCON_PORT": "4253"}, []M{query}, "4253", true},
		{"inactive blank unchanged", M{"RCON": "false", "RCON_PORT": ""}, []M{query}, "", true},
		{"zero retains existing disabled semantics", M{"RCON": "true", "RCON_PORT": "0"}, []M{query}, "0", true},
		{"RCON query collision", M{"RCON": "true", "RCON_PORT": "28000"}, []M{query, rcon}, "", false},
		{"RCON needs extra port", M{"RCON": "true", "RCON_PORT": ""}, []M{query}, "", false},
	} {
		t.Run(spec.name, func(t *testing.T) {
			env, err := normalizeTemplatePortEnvironment(entry, spec.env, primary, spec.extra)
			if (err == nil) != spec.valid {
				t.Fatal(err)
			}
			if !spec.valid {
				return
			}
			if str(env["RCON_PORT"]) != spec.want {
				t.Fatal(env)
			}
			if err = validateTemplatePortRules(entry, env, primary, spec.extra); err != nil {
				t.Fatal(err)
			}
		})
	}
	legacy := gameTemplate{PortRules: []templatePortRule{{Environment: "PORT", Condition: "nonzero", AllocatedValue: true, Minimum: 1, Maximum: 65535, Count: 2}}}
	if validateTemplatePortRules(legacy, M{"PORT": ""}, primary, []M{query}) == nil {
		t.Fatal("legacy blank semantics weakened")
	}
	if err := validateTemplatePortRules(legacy, M{"PORT": "28001"}, primary, []M{query}); err != nil {
		t.Fatal("legacy primary binding changed", err)
	}
}

func TestTemplateAutomaticMetadataRejectedEvenInactive(t *testing.T) {
	base := templatePortRule{Environment: "PORT", Condition: "nonzero", AllocatedValue: true, AutoAllocate: true, Minimum: 1, Maximum: 65535, Count: 2, WhenEnvironment: "ENABLE", WhenValue: "true"}
	for _, mutate := range []func(*templatePortRule){func(r *templatePortRule) { r.AllocatedValue = false }, func(r *templatePortRule) { r.Condition = "" }, func(r *templatePortRule) { r.WhenValue = "" }, func(r *templatePortRule) { r.WhenEnvironment = "" }, func(r *templatePortRule) { r.WhenEnvironment = "invalid key" }, func(r *templatePortRule) { r.ExcludeOffsets = []int{-1, -1} }, func(r *templatePortRule) { r.Offsets = []int{0} }, func(r *templatePortRule) { r.Minimum = 0 }} {
		rule := base
		mutate(&rule)
		if _, err := normalizeTemplatePortEnvironment(gameTemplate{PortRules: []templatePortRule{rule}}, M{"ENABLE": "false", "PORT": ""}, M{"ip": "192.0.2.1", "port": 28000}, nil); err == nil {
			t.Fatal("invalid inactive metadata accepted", rule)
		}
	}
	if _, err := normalizeTemplatePortEnvironment(gameTemplate{PortRules: []templatePortRule{base, base}}, M{"ENABLE": "false"}, M{}, nil); err == nil {
		t.Fatal("duplicate automatic role accepted")
	}
}
