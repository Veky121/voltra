package panel

import (
	"bytes"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"
)

const tachyonSettingsPath = "/tachyon/config.cfg"

// Pinned v1.0.2 e.bj(): BufferedReader.readLine, trim the entire line, skip
// leading --, split at LAST =, exact-case key, Integer.parseInt(value).
// Inner key/value whitespace and inline comments are NOT supported.
// Boolean semantics are documented by the publisher config.cfg. Duration
// maxima below are conservative UI limits, not claimed engine hard limits.
var tachyonSettingsBounds = map[string][2]int64{
	"AUTOSAVE_TIME": {1, 86400}, "LEVEL_TIMEOUT_TIME": {1, 86400},
	"RESPAWN_TIME":         {0, 3600},
	"DISABLE_ENG_IN_HYPER": {0, 1}, "DISABLE_CLOAK_IN_HYPER": {0, 1},
	"DECHARGE_WEAPONS_ON_SHIP_ENTRY": {0, 1}, "ALLOW_SERVER_RESET": {0, 1},
	"EMP_SHIELDS_ENABLED": {0, 1}, "SHIELDS_BLOCK_TP_RECALL": {0, 1},
	"SERVER_PORT": {1, 65535},
}

var tachyonScalarLine = regexp.MustCompile(`^([ \t]*)([A-Z][A-Z0-9_]*)=([+]?[0-9]+)([ \t]*)$`)
var tachyonScalarValue = regexp.MustCompile(`^[0-9]+$`)

func validTachyonSetting(key, value string) bool {
	bounds, known := tachyonSettingsBounds[key]
	if !known || key == "SERVER_PORT" || len(value) > 10 || !tachyonScalarValue.MatchString(value) {
		return false
	}
	n, err := strconv.ParseInt(value, 10, 32)
	return err == nil && n >= bounds[0] && n <= bounds[1]
}

func parseTachyonSettings(data []byte) (gameSettingsParsed, error) {
	if len(data) > 8*1024*1024 || !utf8.Valid(data) || bytes.Count(data, []byte{'\n'}) > 100000 || bytes.HasPrefix(data, []byte{0xef, 0xbb, 0xbf}) {
		return gameSettingsParsed{}, bad("Invalid or oversized Tachyon configuration.")
	}
	type span struct{ line, start, end int }
	lines := strings.SplitAfter(string(data), "\n")
	spans := map[string]span{}
	counts := map[string]int{}
	out := gameSettingsParsed{fields: []gameSetting{}}
	for index, raw := range lines {
		line := strings.TrimRight(strings.TrimSuffix(raw, "\n"), "\r")
		if len(line) > 65536 || strings.ContainsAny(line, "\r\x00\u0085\u2028\u2029") {
			return gameSettingsParsed{}, bad("Unsupported Tachyon configuration line.")
		}
		trim := strings.TrimSpace(line)
		if trim == "" || strings.HasPrefix(trim, "--") {
			continue
		}
		key, _, found := strings.Cut(trim, "=")
		if !found {
			continue
		}
		key = strings.ToUpper(strings.TrimSpace(key))
		if _, known := tachyonSettingsBounds[key]; !known {
			continue
		}
		counts[key]++
		if _, exists := spans[key]; exists {
			continue
		}
		field := gameSetting{key: key, kind: "readonly"}
		match := tachyonScalarLine.FindStringSubmatchIndex(line)
		if match != nil && line[match[4]:match[5]] == key {
			value := line[match[6]:match[7]]
			// Java accepts a leading plus. Keep no-op bytes intact, while new
			// values use the same plain decimal grammar as the publisher file.
			field.value = strings.TrimPrefix(value, "+")
			if n, err := strconv.ParseInt(field.value, 10, 32); err == nil {
				field.value = strconv.FormatInt(n, 10)
			}
			spans[key] = span{index, match[6], match[7]}
			if validTachyonSetting(key, field.value) {
				field.kind = "number"
				if tachyonSettingsBounds[key] == [2]int64{0, 1} {
					field.kind, field.on, field.off = "boolean", "1", "0"
				}
			}
		} else {
			spans[key] = span{index, 0, 0}
		}
		out.fields = append(out.fields, field)
	}
	writable := map[string]bool{}
	values := map[string]string{}
	for index := range out.fields {
		field := &out.fields[index]
		if counts[field.key] != 1 {
			field.kind = "readonly"
		}
		writable[field.key], values[field.key] = field.kind != "readonly", field.value
	}
	out.patch = func(changes map[string]string) ([]byte, error) {
		for key, value := range changes {
			if !writable[key] || !validTachyonSetting(key, value) {
				return nil, bad("This Tachyon setting cannot be changed here.")
			}
		}
		updated := append([]string(nil), lines...)
		for key, value := range changes {
			if value == values[key] {
				continue
			}
			s := spans[key]
			line := updated[s.line]
			updated[s.line] = line[:s.start] + value + line[s.end:]
		}
		return []byte(strings.Join(updated, "")), nil
	}
	return out, nil
}
