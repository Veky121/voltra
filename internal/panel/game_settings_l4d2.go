package panel

import (
	"bytes"
	"strings"
	"unicode/utf8"
)

const l4d2SettingsRecipe = "left4dead_2/egg-left4dead_2.json"
const l4d2SettingsPath = "/left4dead2/cfg/server.cfg"

// Candidate parser only: dispatch must establish active-file authority first.
// Valve's Source SDK voice_gamemgr.cpp reads sv_alltalk with GetInt as a bool.
// No L4D2 default is inferred from the SDK; only existing 0/1 assignments edit.
// Difficulty, mode, credentials and allocation cvars retain their current owners.
func parseL4D2Settings(data []byte) (gameSettingsParsed, error) {
	if len(data) > 65536 || !utf8.Valid(data) || bytes.HasPrefix(data, []byte{0xef, 0xbb, 0xbf}) {
		return gameSettingsParsed{}, bad("Invalid L4D2 configuration encoding or size.")
	}
	for _, c := range string(data) {
		if c < 32 && c != '\n' && c != '\r' && c != '\t' || c == 127 || c == '\u0085' || c == '\u2028' || c == '\u2029' {
			return gameSettingsParsed{}, bad("Unsupported L4D2 control character.")
		}
	}
	if bytes.Contains(bytes.ReplaceAll(data, []byte("\r\n"), nil), []byte{'\r'}) {
		return gameSettingsParsed{}, bad("Unsupported L4D2 line separator.")
	}
	validate := func(key, value string) bool { return key == "sv_alltalk" && (value == "0" || value == "1") }
	out, err := parseSourceSettingsWithSchema(data, map[string]string{"sv_alltalk": "boolean"}, validate)
	if err != nil {
		return out, err
	}
	unsafe := false
	seen := map[string]bool{}
	for _, raw := range strings.Split(string(data), "\n") {
		line := strings.TrimSuffix(raw, "\r")
		trim := strings.TrimSpace(line)
		if trim == "" || strings.HasPrefix(trim, "//") {
			continue
		}
		parts := sourceCvarLine.FindStringSubmatch(line)
		if parts == nil {
			unsafe = true
			continue
		}
		key := strings.ToLower(parts[2])
		// Unknown scalar bytes remain intact. Executable indirection cannot be
		// resolved locally, so it blocks this candidate editor, including exec.
		if key != "sv_alltalk" || seen[key] || key == "exec" || key == "alias" || key == "bind" || key == "toggle" || key == "incrementvar" {
			unsafe = true
		}
		seen[key] = true
		if key == "sv_alltalk" && (parts[2] != key || !validate(key, strings.Trim(parts[4], "\""))) {
			unsafe = true
		}
	}
	if unsafe {
		for i := range out.fields {
			out.fields[i].kind = "readonly"
		}
		out.patch = func(changes map[string]string) ([]byte, error) {
			if len(changes) != 0 {
				return nil, bad("Review ambiguous L4D2 commands in Files.")
			}
			return bytes.Clone(data), nil
		}
	}
	return out, nil
}
