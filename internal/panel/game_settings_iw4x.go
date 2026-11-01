package panel

import (
	"regexp"
	"strings"
	"unicode/utf8"
)

const iw4xSettingsRecipe = "cod/iw4x/egg-iw4x-mw2.json"
const iw4xSettingsPath = "/userraw/server.cfg"

// Only publisher-documented, independent scalars. Hostname/password are
// environment-owned; ports, filesystem paths, rotation and RCON are excluded.
var iw4xSettingKinds = map[string]string{
	"sv_motd": "text", "g_allowvote": "boolean", "sv_voice": "boolean",
	"sv_alltalk": "boolean", "scr_teambalance": "boolean",
	"scr_game_allowkillcam": "boolean", "scr_thirdperson": "boolean",
}
var iw4xSetPrefix = regexp.MustCompile(`(?i)^[ \t]*(?:set|seta|sets)[ \t]+`)

func iw4xSettingValue(key, value string) bool {
	if !utf8.ValidString(value) {
		return false
	}
	for _, c := range value {
		if c < 32 || c == 127 || c == '\u0085' || c == '\u2028' || c == '\u2029' || strings.ContainsRune(`;"\`, c) {
			return false
		}
	}
	switch iw4xSettingKinds[key] {
	case "boolean":
		return value == "0" || value == "1"
	case "text":
		return len(value) <= 256
	}
	return false
}

// IW4x Dvars have an optional set/seta/sets prefix. After masking that prefix
// with equal-length spaces, the reviewed scalar subset matches the shared
// Source span grammar. No prefix, comment, newline or unknown row is rewritten.
// This is a parser candidate only; it does not establish launcher authority.
func parseIW4xSettings(data []byte) (gameSettingsParsed, error) {
	lines := strings.SplitAfter(string(data), "\n")
	normalized := append([]string(nil), lines...)
	prefixes := map[int]string{}
	unsafe := !utf8.Valid(data)
	for _, c := range string(data) {
		if c == 127 || c == '\u0085' || c == '\u2028' || c == '\u2029' {
			unsafe = true
		}
	}
	for index, line := range lines {
		trim := strings.TrimSpace(line)
		if trim == "" || strings.HasPrefix(trim, "//") {
			continue
		}
		if location := iw4xSetPrefix.FindStringIndex(line); location != nil {
			prefixes[index] = line[:location[1]]
			normalized[index] = strings.Repeat(" ", location[1]) + line[location[1]:]
			if sourceCvarLine.FindStringSubmatchIndex(strings.TrimRight(normalized[index], "\r\n")) == nil {
				unsafe = true
			}
		} else {
			key := strings.ToLower(strings.Fields(trim)[0])
			if _, known := iw4xSettingKinds[key]; !known {
				unsafe = true
			}
		}
		if strings.HasPrefix(strings.TrimSpace(normalized[index]), "\"") {
			unsafe = true
		}
	}
	parsed, err := parseSourceSettingsWithSchema([]byte(strings.Join(normalized, "")), iw4xSettingKinds, iw4xSettingValue)
	if err != nil {
		return parsed, err
	}
	patch := parsed.patch
	if unsafe {
		for i := range parsed.fields {
			parsed.fields[i].kind = "readonly"
		}
	}
	parsed.patch = func(changes map[string]string) ([]byte, error) {
		if unsafe && len(changes) > 0 {
			return nil, bad("IW4x executable or ambiguous configuration is read-only.")
		}
		next, err := patch(changes)
		if err != nil {
			return nil, err
		}
		result := strings.SplitAfter(string(next), "\n")
		if len(result) != len(lines) {
			return nil, bad("IW4x settings line structure changed.")
		}
		for index, prefix := range prefixes {
			if !strings.HasPrefix(result[index], strings.Repeat(" ", len(prefix))) {
				return nil, bad("IW4x settings prefix changed.")
			}
			result[index] = prefix + result[index][len(prefix):]
		}
		return []byte(strings.Join(result, "")), nil
	}
	return parsed, nil
}
