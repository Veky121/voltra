package panel

import (
	"bytes"
	"strconv"
	"strings"
	"unicode/utf8"
)

const avorionSettingsRecipe = "avorion/egg-avorion.json"

// Official Server reference and historical 2.5.13 receipt. Only existing native
// scalars are edited: native generation owns defaults, not the panel. CLI-owned
// difficulty/collision/name/player limits/ports/listing/save/threads stay Runtime.
var avorionSettingKinds = map[string]string{
	"Game/PlayerToPlayerDamage": "boolean", "Game/LogoutInvincibility": "boolean",
	"Game/InfiniteResources": "boolean", "Game/LogoutInvincibilityDelay": "number",
	"Game/BigWreckageDespawnTime": "number", "Game/SmallWreckageDespawnTime": "number",
	"System/weakUpdate": "boolean", "System/profiling": "boolean",
	"System/sendCrashReports": "boolean", "System/hangDetection": "boolean",
	"Networking/broadcastInterval": "number",
	"Administration/description":   "text",
}

func avorionSettingValue(key, value string) bool {
	kind, ok := avorionSettingKinds[key]
	if !ok || !utf8.ValidString(value) || strings.ContainsAny(value, "\r\n\x00\"'\\;#\u0085\u2028\u2029") {
		return false
	}
	for _, c := range value {
		if c < 32 || c == 127 {
			return false
		}
	}
	switch kind {
	case "boolean":
		return value == "true" || value == "false"
	case "number":
		// Representation guard only; no undocumented gameplay maximum or default.
		if value == "" || strings.Trim(value, "0123456789") != "" {
			return false
		}
		_, err := strconv.ParseUint(value, 10, 31)
		return err == nil
	default:
		return len(value) <= 4096
	}
}

func parseAvorionSettings(data []byte) (gameSettingsParsed, error) {
	invalid := func() error { return bad("Invalid or ambiguous Avorion native settings.") }
	if len(data) > 4*1024*1024 || !utf8.Valid(data) || bytes.ContainsRune(data, 0) {
		return gameSettingsParsed{}, invalid()
	}
	// Refuse duplicate/case-variant sections and keys before the shared INI span
	// parser can choose a value. Unknown rows remain byte-for-byte untouched.
	seen, sections := map[string]bool{}, map[string]bool{}
	section := ""
	for _, line := range strings.Split(string(data), "\n") {
		t := strings.TrimSpace(line)
		if t == "" || strings.HasPrefix(t, ";") || strings.HasPrefix(t, "#") {
			continue
		}
		if strings.HasPrefix(t, "[") {
			if !strings.HasSuffix(t, "]") || strings.Count(t, "[") != 1 || strings.Count(t, "]") != 1 {
				return gameSettingsParsed{}, invalid()
			}
			section = t[1 : len(t)-1]
			low := strings.ToLower(section)
			if sections[low] {
				return gameSettingsParsed{}, invalid()
			}
			sections[low] = true
			continue
		}
		key, _, ok := strings.Cut(t, "=")
		if !ok {
			return gameSettingsParsed{}, invalid()
		}
		full := section + "/" + strings.TrimSpace(key)
		low := strings.ToLower(full)
		if seen[low] {
			return gameSettingsParsed{}, invalid()
		}
		seen[low] = true
		for known := range avorionSettingKinds {
			if strings.EqualFold(known, full) && known != full {
				return gameSettingsParsed{}, invalid()
			}
		}
	}
	parsed, err := parseGameSettingsLines("/server.ini", data)
	if err != nil {
		return parsed, err
	}
	fields := []gameSetting{}
	for _, f := range parsed.fields {
		if kind, ok := avorionSettingKinds[f.key]; ok {
			if !avorionSettingValue(f.key, f.value) {
				return gameSettingsParsed{}, invalid()
			}
			f.kind = kind
			f.on = "true"
			f.off = "false"
			fields = append(fields, f)
		}
	}
	originalPatch := parsed.patch
	parsed.fields = fields
	parsed.patch = func(changes map[string]string) ([]byte, error) {
		for key, value := range changes {
			if !seen[strings.ToLower(key)] || !avorionSettingValue(key, value) {
				return nil, invalid()
			}
		}
		return originalPatch(changes)
	}
	return parsed, nil
}
