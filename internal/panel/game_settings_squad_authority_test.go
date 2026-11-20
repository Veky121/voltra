package panel

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
	"voltra/internal/gamesettings"
)

func squadAuthorityFixture(t *testing.T) gamesettings.SquadAuthorityInput {
	t.Helper()
	data, err := os.ReadFile("../gamesettings/testdata/game-settings/game-parity-20261029/squad-authority/current-emitted-fixture-console-v2.json")
	if err != nil {
		t.Fatal(err)
	}
	var f struct {
		Startup     string
		ConfigFiles string `json:"config_files"`
		Helpers     map[string]string
	}
	if err := json.Unmarshal(data, &f); err != nil {
		t.Fatal(err)
	}
	in := gamesettings.SquadAuthorityInput{Recipe: gamesettings.SquadSettingsRecipe, Path: gamesettings.SquadSettingsPath, Startup: f.Startup, EggStartup: f.Startup, ConfigFiles: json.RawMessage(f.ConfigFiles), Environment: map[string]string{"VOLTRA_TACTICAL": "squad", "SRCDS_APPID": "403240", "WINDOWS_INSTALL": "0"}, Helpers: map[string][]byte{}}
	for k, v := range f.Helpers {
		in.Helpers[k] = []byte(v)
	}
	return in
}

func TestSquadAuthorityReviewedEmitted(t *testing.T) {
	in := squadAuthorityFixture(t)
	// Conflicting file/env counts are safe: env only seeds absent keys.
	in.Environment["maxplayers"] = "80"
	if err := gamesettings.ValidateSquadSettingsAuthority(in); err != nil {
		t.Fatal(err)
	}
	parsed, err := gamesettings.ParseSquadSettings([]byte("MaxPlayers=21\nNumReservedSlots=2\n"))
	if err != nil {
		t.Fatal(err)
	}
	result, err := parsed.Patch(map[string]string{"MaxPlayers": "22"})
	if err != nil || !strings.Contains(string(result), "MaxPlayers=22") {
		t.Fatalf("%s %v", result, err)
	}
}

func TestSquadAuthorityRefusals(t *testing.T) {
	cases := map[string]func(*gamesettings.SquadAuthorityInput){
		"direct canonical launcher": func(i *gamesettings.SquadAuthorityInput) {
			i.Startup = "/home/container/SquadGame/Binaries/Linux/SquadGameServer SquadGame Port={{SERVER_PORT}} QueryPort={{QUERY_PORT}} -beaconport={{BEACON_PORT}}"
		},
		"fixed appended": func(i *gamesettings.SquadAuthorityInput) { i.Startup += " FIXEDMAXPLAYERS=80" },
		"egg drift":      func(i *gamesettings.SquadAuthorityInput) { i.EggStartup += " -log" },
		"inactive path":  func(i *gamesettings.SquadAuthorityInput) { i.Path = "/SquadGame/Saved/Config/LinuxServer/Server.cfg" },
		"recipe":         func(i *gamesettings.SquadAuthorityInput) { i.Recipe = "post_scriptum/egg-post-scriptum.json" },
		"original rewrite": func(i *gamesettings.SquadAuthorityInput) {
			i.ConfigFiles = json.RawMessage(`{"SquadGame/ServerConfig/Server.cfg":{"parser":"file","find":{"MaxPlayers":"MaxPlayers={{server.build.env.maxplayers}}"}}}`)
		},
		"null mappings":      func(i *gamesettings.SquadAuthorityInput) { i.ConfigFiles = json.RawMessage(`null`) },
		"malformed mappings": func(i *gamesettings.SquadAuthorityInput) { i.ConfigFiles = json.RawMessage(`{`) },
		"helper drift": func(i *gamesettings.SquadAuthorityInput) {
			i.Helpers[".voltra/squad_owner.py"] = append(i.Helpers[".voltra/squad_owner.py"], byte(' '))
		},
		"missing dependency": func(i *gamesettings.SquadAuthorityInput) { delete(i.Helpers, ".voltra/tactical_runtime.py") },
		"alias conflict": func(i *gamesettings.SquadAuthorityInput) {
			i.Environment["maxplayers"] = "20"
			i.Environment["MAXPLAYERS"] = "80"
		},
		"wrong app":       func(i *gamesettings.SquadAuthorityInput) { i.Environment["SRCDS_APPID"] = "393380" },
		"wrong selection": func(i *gamesettings.SquadAuthorityInput) { i.Environment["VOLTRA_TACTICAL"] = "postscriptum" },
	}
	for _, key := range []string{"FIXEDMAXPLAYERS", "fixedmaxplayers", "EXTRA_ARGS", "STARTUP_FLAGS", "LD_PRELOAD", "PYTHONPATH"} {
		k := key
		cases[k] = func(i *gamesettings.SquadAuthorityInput) { i.Environment[k] = "override" }
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			in := squadAuthorityFixture(t)
			mutate(&in)
			if gamesettings.ValidateSquadSettingsAuthority(in) == nil {
				t.Fatal("unsafe authority accepted")
			}
		})
	}
}

func TestSquadAuthorityFixtureMatchesCurrentProfile(t *testing.T) {
	in := squadAuthorityFixture(t)
	data, err := os.ReadFile("game_library/overrides.json")
	if err != nil {
		t.Fatal(err)
	}
	var profiles map[string]struct {
		Egg struct {
			Startup string
			Config  struct{ Files string }
			Scripts struct{ Installation struct{ Script string } }
		}
	}
	if err = json.Unmarshal(data, &profiles); err != nil {
		t.Fatal(err)
	}
	egg := profiles[gamesettings.SquadSettingsRecipe].Egg
	if egg.Startup != in.Startup || egg.Config.Files != string(in.ConfigFiles) {
		t.Fatal("reviewed profile changed")
	}
	for file, body := range in.Helpers {
		name := strings.TrimPrefix(file, ".voltra/")
		if !strings.Contains(egg.Scripts.Installation.Script, string(body)) {
			t.Fatalf("emitted helper changed: %s", file)
		}
		source, err := os.ReadFile("game_library/scripts/" + strings.ReplaceAll(strings.TrimSuffix(name, ".py"), "_", "-") + ".py")
		if err != nil {
			t.Fatal(err)
		}
		if name == "native_console.py" {
			source = reviewedConsoleV1(t)
		}
		normalize := func(b []byte) string { return strings.TrimRight(strings.ReplaceAll(string(b), "\r\n", "\n"), "\n") }
		if normalize(source) != normalize(body) {
			t.Fatalf("source differs from emitted helper: %s", file)
		}
	}
}
