package panel

import (
	"bytes"
	"strings"
	"unicode/utf8"
)

const l4dSettingsRecipe = "left4dead/egg-left4dead.json"
const l4dSettingsStartup = "exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/source_variant_runtime.py"

// l4dSettingsCandidateDocument checks the launch selector and this document only.
// It does not establish addon, autoexec, managed include or native CVar authority.
// The shared owner must read with supported Wings confinement, then repeat these
// checks under its save lock together with revision and permission rechecks.
// No writable dispatch is authorized while exact L4D CVar evidence is absent.
func l4dSettingsCandidateDocument(recipe, startup, appID, customMode string, data []byte) (string, error) {
	if recipe != l4dSettingsRecipe || startup != l4dSettingsStartup || appID != "222840" || customMode != "" {
		return "", nil
	}
	if !l4dCFGAuthority(data) {
		return "", bad("Review executable or ambiguous L4D configuration in Files.")
	}
	return l4dSettingsPath, nil
}

// Accept only a small statement grammar observed in the canonical runtime, plus
// the proposed scalar name. This is syntax/ownership screening, not evidence of
// engine semantics. Only the exact terminal setup footer may execute includes.
func l4dCFGAuthority(data []byte) bool {
	if len(data) > 65536 || !utf8.Valid(data) || bytes.HasPrefix(data, []byte{0xef, 0xbb, 0xbf}) {
		return false
	}
	for _, c := range string(data) {
		if c < 32 && c != '\t' && c != '\r' && c != '\n' || c == 127 || c == '\u0085' || c == '\u2028' || c == '\u2029' {
			return false
		}
	}
	if bytes.Contains(bytes.ReplaceAll(data, []byte("\r\n"), nil), []byte{'\r'}) {
		return false
	}
	text := string(data)
	if !strings.HasSuffix(text, l4dManagedFooter) || strings.Count(text, "// BEGIN VOLTRA L4D MANAGED") != 1 || strings.Count(text, "// END VOLTRA L4D MANAGED") != 1 {
		return false
	}
	body := strings.TrimSuffix(text, l4dManagedFooter)
	seen := map[string]bool{}
	for _, raw := range strings.Split(body, "\n") {
		line := strings.TrimSuffix(raw, "\r")
		trim := strings.TrimSpace(line)
		if trim == "" || strings.HasPrefix(trim, "//") {
			continue
		}
		m := sourceCvarLine.FindStringSubmatch(line)
		if m == nil {
			return false
		}
		key := strings.ToLower(m[2])
		switch key {
		case "sv_alltalk", "hostname", "sv_password", "rcon_password", "sv_lan", "mp_gamemode", "z_difficulty", "sv_allow_lobby_connect_only":
		default:
			return false
		}
		if seen[key] {
			return false
		}
		seen[key] = true
		// CFG values containing command/block syntax require the file editor even
		// inside quotes; do not guess the native command tokenizer's behavior.
		if strings.ContainsAny(m[4], ";{}") || strings.Contains(m[4], "/*") {
			return false
		}
	}
	return true
}
