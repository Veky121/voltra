package panel

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestReHLDSInstallerHelpersMaterializedBeforeExecution(t *testing.T) {
	var overrides map[string]struct {
		Egg struct {
			Scripts struct {
				Installation struct {
					Script string `json:"script"`
				} `json:"installation"`
			} `json:"scripts"`
		} `json:"egg"`
	}
	if err := json.Unmarshal(gameTemplateOverridesJSON, &overrides); err != nil {
		t.Fatal(err)
	}
	recipe := "counter_strike/counter_strike_1.6_rehlds/egg-cs 1.6-rehlds.json"
	script := overrides[recipe].Egg.Scripts.Installation.Script
	call := "PYTHONPATH=.voltra python3 .voltra/cs16_modules_install.py"
	if strings.Count(script, call) != 1 {
		t.Fatal("expected exactly one ReHLDS installer invocation")
	}
	execution := strings.Index(script, call)
	for _, helper := range []string{"steam_template.py", "native_console.py", "goldsrc_runtime.py", "goldsrc_install.py", "native_release.py", "cs16_modules_install.py", "counterstrike_preflight.py", "cs16-modules-release.json"} {
		prefix := "cat > .voltra/" + helper + " <<'"
		start := strings.Index(script, prefix)
		if start < 0 {
			t.Fatalf("missing required helper %s", helper)
		}
		rest := script[start+len(prefix):]
		quote := strings.Index(rest, "'")
		if quote < 0 {
			t.Fatalf("missing heredoc delimiter for %s", helper)
		}
		delimiter := rest[:quote]
		body := strings.Index(rest, "\n")
		if body < 0 {
			t.Fatalf("missing heredoc body for %s", helper)
		}
		close := strings.Index(rest[body:], "\n"+delimiter+"\n")
		if close < 0 {
			t.Fatalf("missing heredoc completion for %s", helper)
		}
		completion := start + len(prefix) + body + close + len("\n"+delimiter+"\n")
		if completion > execution {
			t.Errorf("%s must be completely materialized before installer execution", helper)
		}
	}
}
