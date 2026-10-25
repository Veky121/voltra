package panel

import "testing"

func TestGameSelectableVersionRules(t *testing.T) {
	cases := []struct {
		path, field    string
		valid, invalid []string
	}{
		{"factorio/factorio/egg-factorio.json", "FACTORIO_VERSION", []string{"latest", "stable", "experimental", "2.0.77", "2.1.23"}, []string{"garbage", "02.1.23", "2.1.23\n", "$(echo x)"}},
		{"terraria/vanilla/egg-terraria-vanilla.json", "TERRARIA_VERSION", []string{"latest", "1.4.5.8", "1449"}, []string{"garbage", "1.4.5.8\n", "../1449"}},
		{"terraria/tshock/egg-tshock.json", "TSHOCK_VERSION", []string{"latest", "v6.2.1", "6.2.1"}, []string{"garbage", "v6.2.1\n", "../6.2.1"}},
		{"terraria/tshock/egg-tshock-legacy.json", "TSHOCK_VERSION", []string{"latest", "v4.5.18"}, []string{"garbage", "v4.5.18\n"}},
		{"terraria/tmodloader/egg-t-modloader.json", "VERSION", []string{"latest", "v2026.08.3.0"}, []string{"garbage", "v2026.08.3.0\n"}},
	}
	for _, tc := range cases {
		t.Run(tc.path, func(t *testing.T) {
			rules := ""
			for _, entry := range gameTemplates().Entries {
				if entry.Path != tc.path {
					continue
				}
				for _, raw := range asSlice(entry.Egg["variables"]) {
					v := asMap(raw)
					if str(v["env_variable"]) == tc.field {
						rules = str(v["rules"])
					}
				}
			}
			if rules == "" {
				t.Fatal("version field missing")
			}
			for _, value := range tc.valid {
				if err := validateEggValue(value, true, rules, M{}, tc.field); err != nil {
					t.Fatalf("valid version %q: %v", value, err)
				}
			}
			for _, value := range tc.invalid {
				if err := validateEggValue(value, true, rules, M{}, tc.field); err == nil {
					t.Fatalf("invalid version accepted: %q", value)
				}
			}
		})
	}
}
