package panel

import (
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"
)

const quakeLiveSettingsRecipe = "quake_live/egg-quake-live.json"
const quakeLiveBaseSettingsPath = "/baseq3/server.cfg"
const quakeLiveHomeSettingsPath = "/quake-live-user/baseq3/server.cfg"
const quakeLiveManagedFooter = "\n// BEGIN VOLTRA QUAKE MANAGED\nexec voltra-managed.cfg\n// END VOLTRA QUAKE MANAGED\n"

// Publisher server_readme.txt: factories may override any cvar. These eight
// operator scalars are observed with the default ffa factory, not a promise
// that custom factories cannot replace their values.
var quakeLiveSettingKinds = map[string]string{
	"sv_tags": "text", "sv_floodprotect": "number", "g_floodprot_maxcount": "number",
	"g_floodprot_decay": "number", "g_allowvote": "boolean", "g_votedelay": "number",
	"g_votelimit": "number", "g_inactivity": "number",
}
var quakeLiveSetPrefix = regexp.MustCompile(`(?i)^([ \t]*set[asu]?[ \t]+)`)
var quakeLiveUnsigned = regexp.MustCompile(`^[0-9]+$`)

func quakeLiveSettingValue(key, value string) bool {
	kind, known := quakeLiveSettingKinds[key]
	if !known || !utf8.ValidString(value) {
		return false
	}
	for _, c := range value {
		if c < 32 || c == 127 || c == '\u0085' || c == '\u2028' || c == '\u2029' || strings.ContainsRune(";\"\\", c) {
			return false
		}
	}
	if kind == "text" {
		return len(value) <= 256
	}
	if kind == "boolean" {
		return value == "0" || value == "1"
	}
	n, err := strconv.ParseUint(value, 10, 31)
	return quakeLiveUnsigned.MatchString(value) && err == nil && n <= 2147483647
}

func parseQuakeLiveSettings(data []byte) (gameSettingsParsed, error) {
	if len(data) > 8*1024*1024 || !utf8.Valid(data) || strings.HasPrefix(string(data), "\ufeff") {
		return gameSettingsParsed{}, bad("Invalid Quake Live settings document.")
	}
	body, footer := string(data), ""
	if strings.Contains(body, "// BEGIN VOLTRA QUAKE MANAGED") || strings.Contains(body, "// END VOLTRA QUAKE MANAGED") {
		if !strings.HasSuffix(body, quakeLiveManagedFooter) || strings.Count(body, "// BEGIN VOLTRA QUAKE MANAGED") != 1 || strings.Count(body, "// END VOLTRA QUAKE MANAGED") != 1 {
			return gameSettingsParsed{}, bad("Ambiguous managed Quake Live footer.")
		}
		body = strings.TrimSuffix(body, quakeLiveManagedFooter)
		footer = quakeLiveManagedFooter
	}
	lines := strings.SplitAfter(body, "\n")
	if len(lines) > 100000 {
		return gameSettingsParsed{}, bad("Oversized Quake Live settings.")
	}
	prefixes := map[int]string{}
	unsafe := false
	for i, line := range lines {
		if len(line) > 65536 || strings.ContainsAny(strings.TrimSuffix(strings.TrimSuffix(line, "\n"), "\r"), "\r\u0085\u2028\u2029") {
			return gameSettingsParsed{}, bad("Unsupported Quake Live settings line.")
		}
		words := strings.Fields(strings.TrimSpace(line))
		head := ""
		if len(words) > 0 {
			head = strings.ToLower(words[0])
			if end := strings.IndexAny(head, ";=\""); end >= 0 {
				head = head[:end]
			}
		}
		switch head {
		case "exec", "vstr", "toggle", "reset", "unset", "cvar_restart", "map", "devmap", "map_restart", "wait", "alias", "bind":
			unsafe = true
		}
		prefix := quakeLiveSetPrefix.FindString(line)
		if prefix == "" {
			switch head {
			case "set", "seta", "sets", "setu":
				unsafe = true
			}
		} else {
			prefixes[i] = prefix
			lines[i] = strings.Repeat(" ", len(prefix)) + line[len(prefix):]
		}
		if strings.HasPrefix(strings.TrimSpace(lines[i]), "\"") {
			unsafe = true
		}
	}
	parsed, err := parseSourceSettingsWithSchema([]byte(strings.Join(lines, "")), quakeLiveSettingKinds, quakeLiveSettingValue)
	if err != nil {
		return parsed, err
	}
	if unsafe {
		for i := range parsed.fields {
			parsed.fields[i].kind = "readonly"
		}
		parsed.patch = func(changes map[string]string) ([]byte, error) {
			if len(changes) > 0 {
				return nil, bad("Quake Live script control requires the native file editor.")
			}
			return append([]byte(nil), data...), nil
		}
		return parsed, nil
	}
	patch := parsed.patch
	parsed.patch = func(changes map[string]string) ([]byte, error) {
		updated, err := patch(changes)
		if err != nil {
			return nil, err
		}
		rows := strings.SplitAfter(string(updated), "\n")
		if len(rows) != len(lines) {
			return nil, bad("Invalid Quake Live patch layout.")
		}
		for i, prefix := range prefixes {
			if len(rows[i]) < len(prefix) {
				return nil, bad("Invalid Quake Live prefix.")
			}
			rows[i] = prefix + rows[i][len(prefix):]
		}
		return []byte(strings.Join(rows, "") + footer), nil
	}
	return parsed, nil
}
