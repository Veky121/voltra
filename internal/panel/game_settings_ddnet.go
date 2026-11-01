package panel

import (
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"
)

const ddnetSettingsPath = "/ddnet/autoexec_server.cfg"
const ddnetDataSettingsPath = "/ddnet/data/autoexec_server.cfg"

// Explicit scalars only. Passwords, listeners, administration, exec, votes,
// SQL and operator arrays remain exclusively under Files authority.
var ddnetSettingKinds = map[string]string{
	"sv_name": "text", "sv_map": "text", "sv_register": "text",
	"sv_max_clients": "number", "sv_sixup": "boolean", "sv_test_cmds": "boolean",
}
var ddnetCvarLine = regexp.MustCompile(`^([ \t]*)([A-Za-z_][A-Za-z0-9_]*)([ \t]+)("[^"\\]*"|[^ \t"\\;]+)([ \t]*)(?:#.*)?$`)

// parseDDNetSettings edits value spans only. Unsupported control syntax makes
// the whole document read-only because line-local reasoning cannot establish
// top-level statements inside a block, continuation or command chain.
func parseDDNetSettings(data []byte) (gameSettingsParsed, error) {
	return parseNativeConsoleSettings(data, nativeConsoleSettingsSchema{kind: func(key string) string { return ddnetSettingKinds[key] }, valid: ddnetSettingValue})
}

func ddnetSettingValue(key, value string) bool {
	// Do not rely on DDNet's escaping or semicolon handling. Reject all command
	// delimiters, quotes, escapes and control characters, including Unicode lines.
	for _, c := range value {
		if c < 32 || c == 127 || c == '\u0085' || c == '\u2028' || c == '\u2029' || strings.ContainsRune(";\"\\", c) {
			return false
		}
	}
	switch ddnetSettingKinds[key] {
	case "boolean":
		return value == "0" || value == "1"
	case "number":
		n, err := strconv.Atoi(value)
		return err == nil && n >= 1 && n <= 128
	case "text":
		if !utf8.ValidString(value) || len(value) > 127 {
			return false
		}
		switch key {
		case "sv_register":
			return value == "0" || value == "1" || value == "ipv4"
		case "sv_map":
			return value != "" && value != "." && value != ".." && !strings.ContainsAny(value, "/\\")
		}
		return true
	}
	return false
}
