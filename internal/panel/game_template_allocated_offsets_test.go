package panel

import "testing"

func TestTemplateAllocatedServiceOffsets(t *testing.T) {
	allocation := func(port int) M { return M{"ip": "192.0.2.1", "port": port} }
	role := templatePortRule{Environment: "QUERY", Condition: "nonzero", AllocatedValue: true, AutoAllocate: true, AllocatedOffsets: []int{1}, Minimum: 1, Maximum: 65535, Count: 4}
	entry := gameTemplate{RequiredPorts: 4, PortRules: []templatePortRule{{Minimum: 1, Maximum: 65535, Count: 2, Offsets: []int{1}}, role}}
	for _, spec := range []struct {
		name  string
		raw   string
		ports []int
		want  string
		valid bool
	}{
		{"lowest complete group", "", []int{28009, 28004, 28003, 28001}, "28003", true},
		{"explicit complete group", "28003", []int{28001, 28003, 28004}, "28003", true},
		{"sparse group", "", []int{28001, 28003, 28005}, "", false},
		{"missing explicit companion", "28003", []int{28001, 28003, 28005}, "", false},
		{"fixed game overlap", "28001", []int{28001, 28002, 28003}, "", false},
		{"companion overflow", "65535", []int{28001, 65534, 65535}, "", false},
		{"disabled unchanged", "0", []int{28001}, "0", true},
	} {
		t.Run(spec.name, func(t *testing.T) {
			extra := []M{}
			for _, port := range spec.ports {
				extra = append(extra, allocation(port))
			}
			raw := M{"QUERY": spec.raw}
			normalized, err := normalizeTemplatePortEnvironment(entry, raw, allocation(28000), extra)
			if (err == nil) != spec.valid {
				t.Fatal(err)
			}
			if raw["QUERY"] != spec.raw {
				t.Fatal("raw changed")
			}
			if spec.valid {
				if normalized["QUERY"] != spec.want {
					t.Fatal(normalized)
				}
				if err := validateTemplatePortRules(entry, normalized, allocation(28000), extra); err != nil {
					t.Fatal(err)
				}
			}
		})
	}
	// Reserve a later explicit group's companion before choosing an earlier auto role.
	first := role
	first.Environment = "COMM"
	first.AllocatedOffsets = nil
	entry.PortRules = append([]templatePortRule{first}, entry.PortRules...)
	normalized, err := normalizeTemplatePortEnvironment(entry, M{"COMM": "", "QUERY": "28003"}, allocation(28000), []M{allocation(28001), allocation(28003), allocation(28004), allocation(28009)})
	if err != nil || normalized["COMM"] != "28009" {
		t.Fatal(normalized, err)
	}
	for _, offsets := range [][]int{{0}, {1, 1}, {65535}} {
		badRule := role
		badRule.AllocatedOffsets = offsets
		badRule.WhenEnvironment = "ENABLED"
		badRule.WhenValue = "true"
		if _, err := normalizeTemplatePortEnvironment(gameTemplate{PortRules: []templatePortRule{badRule}}, M{"ENABLED": "false"}, allocation(28000), nil); err == nil {
			t.Fatal("inactive invalid metadata accepted", offsets)
		}
	}
	badRule := role
	badRule.AllocatedValue = false
	if validateTemplatePortRuleMetadata(badRule) == nil {
		t.Fatal("companions without service role accepted")
	}
	negative := role
	negative.AutoAllocate = false
	negative.AllocatedOffsets = []int{-1}
	negative.Minimum = 28002
	negative.Maximum = 28010
	negativeEntry := gameTemplate{PortRules: []templatePortRule{negative}}
	if err := validateTemplatePortRules(negativeEntry, M{"QUERY": "28004"}, allocation(28002), []M{allocation(28003), allocation(28004), allocation(28009)}); err != nil {
		t.Fatal("negative service offset", err)
	}
	if err := validateTemplatePortRules(negativeEntry, M{"QUERY": "28003"}, allocation(28002), []M{allocation(28003), allocation(28004), allocation(28009)}); err == nil {
		t.Fatal("companion reused primary")
	}
	wrong := allocation(28004)
	wrong["ip"] = "192.0.2.2"
	if err := validateTemplatePortRules(entry, M{"COMM": "28009", "QUERY": "28003"}, allocation(28000), []M{allocation(28001), allocation(28003), wrong, allocation(28009)}); err == nil {
		t.Fatal("foreign companion accepted")
	}
}
