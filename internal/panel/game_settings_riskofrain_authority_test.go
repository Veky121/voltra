package panel

import (
	"os"
	"testing"
)

func TestRiskOfRainCandidateAuthority(t *testing.T) {
	helper, err := os.ReadFile("game_library/scripts/risk-of-rain-owner.py")
	if err != nil {
		t.Fatal(err)
	}
	path := "Risk of Rain 2_Data/Config/"
	fixtures := []struct {
		name, startup, pregame, cfg string
		refuse                      bool
	}{
		{"ordered", "exec server; host; remove_all_local_users;", "// empty", `sv_hostname "name";`, false},
		{"extension", "exec server.cfg\r\nhost", "", `sv_hostname "name";`, false},
		{"reordered", "host; exec server;", "", `sv_hostname "name";`, true},
		{"override", "exec server; host;", "sv_hostname changed;", `sv_hostname "name";`, true},
		{"include", "exec other; host;", "", `sv_hostname "name";`, true},
		{"quoted", `exec "server"; host;`, "", `sv_hostname "name";`, true},
		{"duplicate", "exec server; host;", "", `sv_hostname "a"; sv_hostname "b";`, true},
		{"escape", "exec server; host;", "", `sv_hostname "bad\q";`, true},
		{"executable", "exec server; host;", "", `exec other;`, true},
	}
	for _, f := range fixtures {
		t.Run(f.name, func(t *testing.T) {
			files := map[string][]byte{".voltra/risk-of-rain-owner.py": helper, path + "server.cfg": []byte(f.cfg), path + "server_startup.cfg": []byte(f.startup), path + "server_pregame.cfg": []byte(f.pregame)}
			a, e := reviewRiskOfRainSettingsCandidate(riskOfRainAuthorityRecipe, riskOfRainAuthorityStartup, riskOfRainAuthorityStartup, files)
			if (e != nil) != f.refuse {
				t.Fatalf("unexpected refusal: %v", e)
			}
			if !f.refuse {
				if a.NativeSchemaReviewed || a.ScriptsReviewed {
					t.Fatal("unproven authority granted")
				}
				if _, e := parseRiskOfRainSettings(files[path+"server.cfg"], a); e == nil {
					t.Fatal("candidate enabled writes")
				}
			}
		})
	}
	for _, mutation := range []string{"recipe", "startup", "helper", "missing"} {
		t.Run(mutation, func(t *testing.T) {
			files := map[string][]byte{".voltra/risk-of-rain-owner.py": helper, path + "server.cfg": []byte(`sv_hostname "name";`)}
			recipe, startup := riskOfRainAuthorityRecipe, riskOfRainAuthorityStartup
			switch mutation {
			case "recipe":
				recipe = "other"
			case "startup":
				startup += " --custom"
			case "helper":
				files[".voltra/risk-of-rain-owner.py"] = append(append([]byte{}, helper...), '\n')
			case "missing":
				delete(files, path+"server.cfg")
			}
			if _, e := reviewRiskOfRainSettingsCandidate(recipe, riskOfRainAuthorityStartup, startup, files); e == nil {
				t.Fatal("accepted unsupported candidate")
			}
		})
	}
}
