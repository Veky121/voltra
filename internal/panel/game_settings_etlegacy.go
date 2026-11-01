package panel

import (
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"
)

const etlegacySettingsRecipe = "wolfenstein_enemy_territory/etlegacy/egg-e-t-legacy.json"
const etlegacySettingsPath = "/etlegacy/userdata/legacy/voltra-native.cfg"

func etlegacySettingsDocument(egg M, file string) bool {
	return file == etlegacySettingsPath && nativeSettingsIsRecipe(egg, etlegacySettingsRecipe) && str(egg["startup"]) == "exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/etlegacy_authority.py"
}

var etlegacySettingKinds = map[string]string{
	"sv_hostname": "text", "sv_maxclients": "number", "g_password": "text", "rconpassword": "text",
	"sv_privateclients": "number", "sv_privatepassword": "text", "refereepassword": "text", "shoutcastpassword": "text",
	"g_friendlyfire": "boolean", "g_dowarmup": "boolean", "g_warmup": "number",
	"g_teamforcebalance": "boolean", "g_noteamswitching": "boolean", "g_xpsave": "boolean",
}
var etlegacySetPrefix = regexp.MustCompile(`(?i)^[ \t]*(?:set|seta|sets|setu)[ \t]+`)
var etlegacyScalarInteger = regexp.MustCompile(`^(?:0|[1-9][0-9]*)$`)

func etlegacySettingValue(key, value string) bool {
	if !utf8.ValidString(value) {
		return false
	}
	for _, c := range value {
		if c < 32 || c == 127 || c == '\u0085' || c == '\u2028' || c == '\u2029' || strings.ContainsRune(`;"\`, c) {
			return false
		}
	}
	switch etlegacySettingKinds[key] {
	case "boolean":
		return value == "0" || value == "1"
	case "number":
		n, e := strconv.ParseUint(value, 10, 32)
		if e != nil || !etlegacyScalarInteger.MatchString(value) {
			return false
		}
		switch key {
		case "sv_maxclients":
			return n >= 1 && n <= 64
		case "sv_privateclients":
			return n <= 64
		case "g_warmup":
			return n <= 3600
		}
	case "text":
		if key == "sv_hostname" {
			return len(value) > 0 && len(value) <= 255
		}
		return len(value) <= 127
	}
	return false
}

// Keep the shared command parser's span edits, duplicate handling and safety
// checks. Only normalize Quake's set/seta/sets/setu prefix, then restore those
// exact original bytes. Unknown executable commands make this document read-only.
func parseETLegacySettings(data []byte) (gameSettingsParsed, error) {
	lines := strings.SplitAfter(string(data), "\n")
	normalized := append([]string(nil), lines...)
	prefixes := map[int]string{}
	unsafe := false
	for index, line := range lines {
		trim := strings.TrimSpace(line)
		if trim == "" || strings.HasPrefix(trim, "//") {
			continue
		}
		if location := etlegacySetPrefix.FindStringIndex(line); location != nil {
			prefixes[index] = line[:location[1]]
			normalized[index] = strings.Repeat(" ", location[1]) + line[location[1]:]
		} else {
			key := strings.ToLower(strings.Fields(trim)[0])
			if _, known := etlegacySettingKinds[key]; !known {
				unsafe = true
			}
		}
		if strings.HasPrefix(strings.TrimSpace(normalized[index]), "\"") {
			unsafe = true
		}
	}
	parsed, err := parseSourceSettingsWithSchema([]byte(strings.Join(normalized, "")), etlegacySettingKinds, etlegacySettingValue)
	if err != nil {
		return parsed, err
	}
	sharedPatch := parsed.patch
	if unsafe {
		for i := range parsed.fields {
			parsed.fields[i].kind = "readonly"
		}
	}
	parsed.patch = func(changes map[string]string) ([]byte, error) {
		if unsafe && len(changes) > 0 {
			return nil, bad("This ET: Legacy document contains executable control commands and is read-only.")
		}
		patched, err := sharedPatch(changes)
		if err != nil {
			return nil, err
		}
		result := strings.SplitAfter(string(patched), "\n")
		if len(result) != len(lines) {
			return nil, bad("ET: Legacy settings line structure changed.")
		}
		for index, prefix := range prefixes {
			if len(result[index]) < len(prefix) || result[index][:len(prefix)] != strings.Repeat(" ", len(prefix)) {
				return nil, bad("ET: Legacy settings prefix changed.")
			}
			result[index] = prefix + result[index][len(prefix):]
		}
		return []byte(strings.Join(result, "")), nil
	}
	return parsed, nil
}
