package panel

import (
	"math"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"
)

// Source: xonotic-data.pk3dir xonotic-v0.8.6 xonotic-server.cfg.
// Original thirteen startup controls remain authoritative. Numeric bounds below
// are conservative editor bounds rather than asserted engine hard maxima.
const xonoticSettingsPath = "/.xonotic/data/server.cfg"

func xonoticKinds() map[string]string {
	return map[string]string{"sv_taunt": "boolean", "sv_autotaunt": "boolean", "sv_autopause": "boolean", "g_footsteps": "boolean", "g_friendlyfire": "number", "g_warmup_limit": "number", "g_maplist_shuffle": "boolean", "sv_maxidle": "number"}
}

var xonoticSetPrefix = regexp.MustCompile(`(?i)^([ \t]*seta?[ \t]+)`)

func xonoticValue(kinds map[string]string, key, value string) bool {
	kind, exists := kinds[key]
	if !exists || len(value) > 32 {
		return false
	}
	if kind == "boolean" {
		return value == "0" || value == "1"
	}
	n, err := strconv.ParseFloat(value, 64)
	if err != nil || !sourceNumber.MatchString(value) || math.IsNaN(n) || math.IsInf(n, 0) {
		return false
	}
	switch key {
	case "g_friendlyfire":
		return n >= 0 && n <= 1
	case "g_warmup_limit":
		return n >= -1 && n <= 86400 && math.Trunc(n) == n
	case "sv_maxidle":
		return n >= 0 && n <= 86400 && math.Trunc(n) == n
	}
	return false
}

// Retain exact set/seta prefixes by padding with equal byte-width whitespace
// only during the shared scalar parser's analysis. Restore every original
// prefix after its value-span patch, including unknown commands/settings.
func parseXonoticSettings(data []byte) (gameSettingsParsed, error) {
	kinds := xonoticKinds()
	if len(data) > 8*1024*1024 || !utf8.Valid(data) || strings.HasPrefix(string(data), "\ufeff") {
		return gameSettingsParsed{}, bad("Invalid Xonotic settings document.")
	}
	lines := strings.SplitAfter(string(data), "\n")
	if len(lines) > 100000 {
		return gameSettingsParsed{}, bad("Oversized Xonotic settings document.")
	}
	prefixes := make(map[int]string)
	unsafeControl := false
	for i, line := range lines {
		if len(line) > 65536 || strings.ContainsAny(strings.TrimRight(line, "\r\n"), "\r\u0085\u2028\u2029") {
			return gameSettingsParsed{}, bad("Unsupported Xonotic settings line.")
		}
		words := strings.Fields(strings.TrimSpace(line))
		if len(words) > 0 {
			head := words[0]
			if end := strings.IndexAny(head, ";=\""); end >= 0 {
				head = head[:end]
			}
			switch strings.ToLower(head) {
			case "exec", "exec_pre", "alias", "unalias", "vstr", "toggle", "reset", "unset", "cvar_restart", "cvar_resettodefaults_saveonly", "cvar_resettodefaults_all", "cvar_resettodefaults_nosaveonly", "defer", "loadconfig", "map", "changelevel", "gametype", "devmap", "map_restart", "wait", "if", "stuffcmds", "localcmd", "rcon", "settemp", "settemp_restore":
				unsafeControl = true
			}
		}
		if len(words) > 0 && strings.HasPrefix(words[0], "\"") {
			unsafeControl = true
		}
		prefix := xonoticSetPrefix.FindString(line)
		if prefix != "" {
			prefixes[i] = prefix
			lines[i] = strings.Repeat(" ", len(prefix)) + line[len(prefix):]
		}
		body := strings.TrimSpace(lines[i])
		if (!strings.HasPrefix(body, "//") && strings.Contains(body, "$")) || strings.HasPrefix(body, "\"") {
			unsafeControl = true
		}
		end := strings.IndexAny(body, " \t;=\"")
		key := body
		if end >= 0 {
			key = body[:end]
		}
		if _, known := kinds[strings.ToLower(key)]; known && key != strings.ToLower(key) {
			unsafeControl = true
		}
	}
	parsed, err := parseSourceSettingsWithSchema([]byte(strings.Join(lines, "")), kinds, func(key, value string) bool { return xonoticValue(kinds, key, value) })
	if err != nil {
		return parsed, err
	}
	if unsafeControl {
		for i := range parsed.fields {
			parsed.fields[i].kind = "readonly"
		}
		parsed.patch = func(changes map[string]string) ([]byte, error) {
			if len(changes) > 0 {
				return nil, bad("Xonotic script control requires the native file editor.")
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
			return nil, bad("Invalid Xonotic patch layout.")
		}
		for i, prefix := range prefixes {
			if len(rows[i]) < len(prefix) {
				return nil, bad("Invalid Xonotic patch prefix.")
			}
			rows[i] = prefix + rows[i][len(prefix):]
		}
		return []byte(strings.Join(rows, "")), nil
	}
	return parsed, nil
}
