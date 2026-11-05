package panel

import (
	"encoding/json"
	"os"
	"regexp"
	"testing"
)

func puckAuthorityFixture(t *testing.T) settingsAuthorityInput {
	t.Helper()
	raw, err := os.ReadFile("game_library/overrides.json")
	if err != nil {
		t.Fatal(err)
	}
	var profiles map[string]struct {
		Egg struct {
			Startup string `json:"startup"`
			Scripts struct {
				Installation struct {
					Script string `json:"script"`
				} `json:"installation"`
			} `json:"scripts"`
		} `json:"egg"`
	}
	if err = json.Unmarshal(raw, &profiles); err != nil {
		t.Fatal(err)
	}
	egg := profiles["puck/egg-puck.json"].Egg
	in := settingsAuthorityInput{Startup: egg.Startup, Env: map[string]string{}, Files: map[string][]byte{"server_config.json": []byte(`{"useWhitelist":false}`)}}
	re := regexp.MustCompile(`(?s)cat > \.voltra/([^ ]+) <<'([^']+)'\n(.*?)\n`)
	// Match heredoc bodies against their exact closing delimiter without guessing shell.
	for _, m := range re.FindAllStringSubmatchIndex(egg.Scripts.Installation.Script, -1) {
		name := egg.Scripts.Installation.Script[m[2]:m[3]]
		delimiter := egg.Scripts.Installation.Script[m[4]:m[5]]
		tail := egg.Scripts.Installation.Script[m[6]:]
		end := regexp.MustCompile(`(?m)^` + regexp.QuoteMeta(delimiter) + `$`).FindStringIndex(tail)
		if end != nil {
			in.Files[".voltra/"+name] = []byte(tail[:end[0]])
		}
	}
	in.Files["start_server.sh"], err = os.ReadFile("../../artifacts/game-parity-20261029/wave24-puck-authority/start_server.sh")
	if err != nil {
		t.Fatal(err)
	}
	return in
}

func TestPuckAuthorityCanonicalAndRefusals(t *testing.T) {
	in := puckAuthorityFixture(t)
	resolve := func(in settingsAuthorityInput) (settingsPathAuthority, error) {
		return puckSettingsAuthority("puck/egg-puck.json", puckAuthorityStartup, in)
	}
	a, err := resolve(in)
	if err != nil || a.Path != puckSettingsPath || a.Revision == "" {
		t.Fatalf("canonical rejected: %v", err)
	}
	for _, startup := range []string{"exec python3 .voltra/light_games_next_runtime.py puck", puckAuthorityStartup + " --serverConfigPath other.json", puckAuthorityStartup + " --serverConfig '{}'", "cd /tmp; " + puckAuthorityStartup} {
		t.Run(startup, func(t *testing.T) {
			v := puckAuthorityFixture(t)
			v.Startup = startup
			if _, e := resolve(v); e == nil {
				t.Fatal("accepted custom argv")
			}
		})
	}
	for _, key := range []string{"PUCK_SERVER_CONFIG", "BASH_ENV", "ENV", "SHELLOPTS", "BASHOPTS", "BASH_FUNC_exec%%", "BASH_FUNC_pwd%%", "BASH_FUNC_chmod%%", "PYTHONPATH", "PYTHONHOME", "LD_PRELOAD"} {
		t.Run(key, func(t *testing.T) {
			v := puckAuthorityFixture(t)
			v.Env[key] = "conflict"
			if _, e := resolve(v); e == nil {
				t.Fatal("accepted injection")
			}
		})
	}
	for name := range in.Files {
		if _, required := puckAuthoritySources[name]; !required && name != "start_server.sh" && name != "server_config.json" {
			continue
		}
		t.Run(name, func(t *testing.T) {
			v := puckAuthorityFixture(t)
			delete(v.Files, name)
			if _, e := resolve(v); e == nil {
				t.Fatal("accepted missing source")
			}
			v.Files[name] = []byte("changed")
			if _, e := resolve(v); e == nil {
				t.Fatal("accepted changed source")
			}
		})
	}
	if _, e := puckSettingsAuthority("other/egg-puck.json", puckAuthorityStartup, in); e == nil {
		t.Fatal("recipe alias")
	}
	if _, e := puckSettingsAuthority("puck/egg-puck.json", "other", in); e == nil {
		t.Fatal("egg startup")
	}
	in.Env["SRV_PASSWORD"] = "unrelated-secret"
	b, e := resolve(in)
	if e != nil || a.Revision != b.Revision {
		t.Fatal("secret changed path revision")
	}
}
