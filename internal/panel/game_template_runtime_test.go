package panel

import "testing"

func TestTemplateRelativeAndOptionalPortRules(t *testing.T) {
	primary := M{"ip": "192.0.2.1", "port": 28000}
	allocation := func(port int) M { return M{"ip": "192.0.2.1", "port": port} }
	for _, spec := range []struct {
		name  string
		rule  templatePortRule
		env   M
		extra []M
		valid bool
	}{
		{"unconditional sparse offset", templatePortRule{Minimum: 1, Maximum: 65535, Count: 2, Offsets: []int{10}}, M{}, []M{allocation(28010)}, true},
		{"wrong sparse offset", templatePortRule{Minimum: 1, Maximum: 65535, Count: 2, Offsets: []int{10}}, M{}, []M{allocation(28011)}, false},
		{"negative offset", templatePortRule{Minimum: 1, Maximum: 65535, Count: 2, Offsets: []int{-10}}, M{}, []M{allocation(27990)}, true},
		{"duplicate allocations", templatePortRule{Minimum: 1, Maximum: 65535, Count: 2, Offsets: []int{10}}, M{}, []M{allocation(28010), allocation(28010)}, false},
		{"wrong address", templatePortRule{Minimum: 1, Maximum: 65535, Count: 2, Offsets: []int{10}}, M{}, []M{{"ip": "192.0.2.2", "port": 28010}}, false},
		{"ASE enabled", templatePortRule{Environment: "ASE", Value: "1", Minimum: 1, Maximum: 65535, Count: 3, Offsets: []int{123}}, M{"ASE": "1"}, []M{allocation(28001), allocation(28123)}, true},
		{"ASE disabled", templatePortRule{Environment: "ASE", Value: "1", Minimum: 1, Maximum: 65535, Count: 3, Offsets: []int{123}}, M{"ASE": "0"}, []M{allocation(28001)}, true},
		{"ASE needs HTTP extra", templatePortRule{Environment: "ASE", Value: "1", Minimum: 1, Maximum: 65535, Count: 3, Offsets: []int{123}}, M{"ASE": "1"}, []M{allocation(28123)}, false},
		{"zero offset metadata", templatePortRule{Minimum: 1, Maximum: 65535, Count: 2, Offsets: []int{0}}, M{}, []M{allocation(28010)}, false},
		{"duplicate offset metadata", templatePortRule{Minimum: 1, Maximum: 65535, Count: 3, Offsets: []int{10, 10}}, M{}, []M{allocation(28010), allocation(28020)}, false},
		{"impossible count metadata", templatePortRule{Minimum: 1, Maximum: 65535, Count: 2, Offsets: []int{10, 20}}, M{}, []M{allocation(28010), allocation(28020)}, false},
		{"invalid inactive metadata", templatePortRule{Environment: "ASE", Value: "1", Minimum: 0, Maximum: 65535, Count: 2}, M{"ASE": "0"}, nil, false},
		{"unknown conditional metadata", templatePortRule{Environment: "WS", Condition: "something", Minimum: 1, Maximum: 65535, Count: 2}, M{"WS": "0"}, nil, false},
		{"allocated value needs nonzero condition", templatePortRule{Environment: "WS", Value: "1", AllocatedValue: true, Minimum: 1, Maximum: 65535, Count: 2}, M{"WS": "0"}, nil, false},
	} {
		t.Run(spec.name, func(t *testing.T) {
			if (validateTemplatePortRules(gameTemplate{PortRules: []templatePortRule{spec.rule}}, spec.env, primary, spec.extra) == nil) != spec.valid {
				t.Fatal("unexpected rule result")
			}
		})
	}
	for _, port := range []int{1, 65535} {
		entry := gameTemplate{PortRules: []templatePortRule{{Minimum: 1, Maximum: 65535, Count: 2, Offsets: []int{10}}}}
		if port == 1 {
			entry.PortRules[0].Offsets = []int{-10}
		}
		if validateTemplatePortRules(entry, M{}, M{"ip": "192.0.2.1", "port": port}, []M{allocation(28010)}) == nil {
			t.Fatal("relative port overflow accepted")
		}
	}
	rules := []templatePortRule{}
	for _, key := range []string{"WS", "RCON"} {
		rules = append(rules, templatePortRule{Environment: key, Condition: "nonzero", AllocatedValue: true, Minimum: 1, Maximum: 65535, Count: 2})
	}
	entry := gameTemplate{RequiredPorts: 1, PortRules: rules}
	for _, spec := range []struct {
		ws, rcon string
		extra    []M
		valid    bool
	}{
		{"0", "0", nil, true}, {"28010", "0", []M{allocation(28010)}, true}, {"28010", "28020", []M{allocation(28010), allocation(28020)}, true}, {"28010", "28020", []M{allocation(28010)}, false},
	} {
		if (validateTemplatePortRules(entry, M{"WS": spec.ws, "RCON": spec.rcon}, primary, spec.extra) == nil) != spec.valid {
			t.Fatal("optional role result", spec.ws, spec.rcon)
		}
	}
	for _, invalid := range []string{"", "-1", "1.0", "1e3", "65536", "NaN", "00"} {
		if validateTemplatePortRules(entry, M{"WS": invalid, "RCON": "0"}, primary, []M{allocation(28010)}) == nil {
			t.Fatal("invalid optional port accepted", invalid)
		}
	}
	if validateTemplatePortLayout(gameTemplate{RequiredPorts: 1}, primary, []M{{"ip": "192.0.2.2", "port": 28000}}) != nil {
		t.Fatal("unrelated single-port allocation compatibility changed")
	}
}

func TestTemplateShiftedConsecutiveBlock(t *testing.T) {
	entry := gameTemplate{RequiredPorts: 7, ConsecutivePorts: true, ConsecutivePortsCount: 6, ConsecutivePrimaryOffset: 1}
	primary := M{"ip": "192.0.2.1", "port": 4255}
	additional := []M{}
	for _, port := range []int{4254, 4256, 4257, 4258, 4259, 4300} {
		additional = append(additional, M{"ip": "192.0.2.1", "port": port})
	}
	if err := validateTemplatePortLayout(entry, primary, additional); err != nil {
		t.Fatal(err)
	}
	if templateSummary(entry)["consecutive_primary_offset"] != 1 {
		t.Fatal("summary omits shifted primary")
	}
	additional[0]["port"] = 4301
	if validateTemplatePortLayout(entry, primary, additional) == nil {
		t.Fatal("missing lower neighbor accepted")
	}
	additional[0]["port"] = 4254
	if validateTemplatePortLayout(entry, primary, additional[:5]) == nil {
		t.Fatal("missing separate port accepted")
	}
	for _, spec := range []struct{ count, offset int }{{8, 1}, {6, -1}, {6, 6}, {-1, 0}} {
		entry.ConsecutivePortsCount = spec.count
		entry.ConsecutivePrimaryOffset = spec.offset
		if validateTemplatePortLayout(entry, primary, additional) == nil {
			t.Fatal("invalid metadata accepted", spec)
		}
	}
	entry.ConsecutivePortsCount = 6
	entry.ConsecutivePrimaryOffset = 1
	if validateTemplatePortLayout(entry, M{"ip": "192.0.2.1", "port": 1}, additional) == nil {
		t.Fatal("port underflow accepted")
	}
}

func TestTemplateConsecutivePorts(t *testing.T) {
	primary := M{"ip": "192.0.2.1", "port": 23560}
	entry := gameTemplate{RequiredPorts: 2, ConsecutivePorts: true}
	for _, spec := range []struct {
		name  string
		ports []M
		valid bool
	}{
		{"pair", []M{{"ip": "192.0.2.1", "port": 23561}}, true},
		{"gap", []M{{"ip": "192.0.2.1", "port": 23562}}, false},
		{"different address", []M{{"ip": "192.0.2.2", "port": 23561}}, false},
		{"missing", nil, false},
		{"extra administration port", []M{{"ip": "192.0.2.1", "port": 23561}, {"ip": "192.0.2.1", "port": 27015}}, true},
	} {
		t.Run(spec.name, func(t *testing.T) {
			if (validateTemplatePortLayout(entry, primary, spec.ports) == nil) != spec.valid {
				t.Fatal("unexpected port-layout result")
			}
		})
	}
	if validateTemplatePortLayout(entry, M{"ip": "192.0.2.1", "port": 65535}, []M{{"ip": "192.0.2.1", "port": 1}}) == nil {
		t.Fatal("port overflow accepted")
	}
	entry.ConsecutivePorts = false
	if err := validateTemplatePortLayout(entry, primary, []M{{"ip": "192.0.2.1", "port": 23570}}); err != nil {
		t.Fatal("ordinary multi-port recipes now require a consecutive block", err)
	}
}

func TestTemplateSteamUpdateOwnership(t *testing.T) {
	egg := M{"features": []any{"steam_disk_space", "voltra_steam_template"}}
	for _, value := range []string{"0", "1"} {
		env := M{"AUTO_UPDATE": value, "VOLTRA_STEAM_AUTO_UPDATE": "spoofed", "SRCDS_APPID": "380870"}
		if err := templateRuntimeEnvironment(egg, env); err != nil {
			t.Fatal(err)
		}
		if env["AUTO_UPDATE"] != "0" || env["VOLTRA_STEAM_AUTO_UPDATE"] != value || env["SRCDS_APPID"] != "380870" {
			t.Fatal("image updater or template update ownership incorrect")
		}
	}
	if templateRuntimeEnvironment(egg, M{"AUTO_UPDATE": "+quit"}) == nil {
		t.Fatal("invalid update setting accepted")
	}
	legacy := M{"AUTO_UPDATE": "1"}
	if err := templateRuntimeEnvironment(M{}, legacy); err != nil || legacy["AUTO_UPDATE"] != "1" {
		t.Fatal("unreviewed image behavior changed")
	}
}

func TestTemplateAllocatedRoleExcludesPrimary(t *testing.T) {
	primary := M{"ip": "192.0.2.1", "port": 28000}
	extra := []M{{"ip": "192.0.2.1", "port": 28001}}
	rule := templatePortRule{Environment: "HTTPS_PORT", Condition: "nonzero", AllocatedValue: true, Minimum: 1, Maximum: 65535, Count: 2}
	check := func(port string, valid bool) {
		t.Helper()
		if (validateTemplatePortRules(gameTemplate{PortRules: []templatePortRule{rule}}, M{"HTTPS_PORT": port}, primary, extra) == nil) != valid {
			t.Fatalf("port %s exclude_primary=%v", port, rule.ExcludePrimary)
		}
	}
	check("28000", true) // Existing allocated roles may share the primary.
	rule.ExcludePrimary = true
	check("28000", false)
	check("28001", true)
	check("28002", false)
	check("0", true)
	extra[0]["ip"] = "192.0.2.2"
	check("28001", false)
	extra[0]["ip"] = "192.0.2.1"
	rule.AllocatedValue = false
	check("0", false) // Invalid metadata is rejected even while inactive.
}

func TestTemplateAllocatedRoleExcludesReservedOffsets(t *testing.T) {
	primary := M{"ip": "192.0.2.1", "port": 28000}
	extra := []M{{"ip": "192.0.2.1", "port": 27999}, {"ip": "192.0.2.1", "port": 28001}}
	rule := templatePortRule{Environment: "RCON_PORT", Condition: "nonzero", AllocatedValue: true, ExcludePrimary: true, Minimum: 1, Maximum: 65535, Count: 3, ExcludeOffsets: []int{-1}}
	check := func(port string, valid bool) {
		t.Helper()
		if (validateTemplatePortRules(gameTemplate{PortRules: []templatePortRule{rule}}, M{"RCON_PORT": port}, primary, extra) == nil) != valid {
			t.Fatalf("unexpected RCON role result: %s, exclusions=%v", port, rule.ExcludeOffsets)
		}
	}
	check("27999", false) // The query listener reserves primary - 1.
	check("28000", false)
	check("28001", true)
	check("0", true)
	rule.ExcludeOffsets = nil
	check("27999", true) // Existing recipes do not gain implicit restrictions.
	for _, invalid := range [][]int{{0}, {-1, -1}, {65535}, {-65535}} {
		rule.ExcludeOffsets = invalid
		check("0", false) // Validate metadata even while the role is disabled.
	}
	rule.ExcludeOffsets = []int{-1}
	rule.AllocatedValue, rule.ExcludePrimary = false, false
	check("0", false)
}
