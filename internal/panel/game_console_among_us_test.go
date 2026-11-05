package panel

import "testing"

func TestAmongUsConsoleInputCapability(t *testing.T) {
	// Reviewed stock BetterCrewLink 0e1d4b12e7a7201cda4db723d08d57baa5549432
	// has no stdin handler. Impostor 1.10.9 at
	// 703915f06fcfd17bc8804d36dd67655671a66cf2 with zero plugins uses
	// ConsoleLifetime for signals only. Inherited stdin adds no command semantics.
	// Nonstock plugins are outside this review; custom startup is the escape hatch.
	for _, path := range []string{
		"among_us/bettercrewlink_server/egg-better-crewlink-server.json",
		"among_us/impostor_server/egg-among-us--impostor-server.json",
	} {
		t.Run(path, func(t *testing.T) {
			var entry gameTemplate
			for _, candidate := range gameTemplates().Entries {
				if candidate.Path == path {
					entry = candidate
					break
				}
			}
			if entry.Profile == "" {
				t.Fatal("reviewed profile missing")
			}
			startup := str(entry.Egg["startup"])
			if startup == "" {
				t.Fatal("canonical startup missing")
			}
			for _, tc := range []struct {
				name   string
				server string
				egg    string
				want   bool
			}{
				{"canonical", startup, startup, false},
				{"custom server", "exec custom-admin-bridge", startup, true},
				{"custom egg", startup, "exec custom-admin-bridge", true},
			} {
				t.Run(tc.name, func(t *testing.T) {
					egg := M{"uuid": gameTemplateEggUUID(entry), "startup": tc.egg}
					if got := serverConsoleInputSupported(M{"startup": tc.server}, egg); got != tc.want {
						t.Fatalf("console input supported = %v, want %v", got, tc.want)
					}
				})
			}
		})
	}
	t.Run("unknown", func(t *testing.T) {
		if !serverConsoleInputSupported(M{}, M{"name": "Among Us"}) {
			t.Fatal("unknown egg inferred by name")
		}
	})
}
