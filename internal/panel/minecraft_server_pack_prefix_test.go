package panel

import "testing"

func TestMinecraftServerPackPrefixNestedContent(t *testing.T) {
	for _, tc := range []struct {
		name, prefix string
		paths        []string
		invalid      bool
	}{
		{"root samples", "", []string{"mods/game.jar", "config/game.cfg", "resources/customloadingscreen/sample/config/default.json"}, false},
		{"wrapped samples", "RLCraft/", []string{"RLCraft/resources/customloadingscreen/sample/config/default.json", "RLCraft/mods/game.jar", "RLCraft/config/game.cfg"}, false},
		{"nested mod configuration", "Pack/", []string{"Pack/mods/example/config/sample.json", "Pack/config/game.cfg"}, false},
		{"sibling instances", "", []string{"A/mods/game.jar", "B/config/game.cfg"}, true},
		{"root and independent instance", "", []string{"mods/game.jar", "Other/config/game.cfg"}, true},
		{"unsupported content nesting", "", []string{"mods/game.jar", "examples/sample/config/game.cfg"}, true},
		{"script only", "", []string{"install.sh"}, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			files := map[string][]byte{}
			for _, path := range tc.paths {
				files[path] = []byte("fixture")
			}
			reader, err := minecraftReadZip(minecraftFixtureZip(t, files))
			if err != nil {
				t.Fatal(err)
			}
			prefix, err := minecraftServerPackPrefix(reader)
			if tc.invalid {
				if err == nil {
					t.Fatal("unsupported or ambiguous archive accepted")
				}
			} else if err != nil || prefix != tc.prefix {
				t.Fatalf("prefix=%q err=%v; want %q", prefix, err, tc.prefix)
			}
		})
	}
}
