package panel

import (
	"bytes"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"
)

const cs2dSettingsPath = "/cs2d/sys/server.cfg"

// Startup owns sv_hostport/name/password/maxplayers/map/lan/rcon/gamemode and
// bot_count. Only independent publisher-documented gameplay scalars are editable.
// Bounds: https://www.cs2d.com/help.php?cmd=<command>.
var cs2dGameplayBounds = map[string][2]int{
	"sv_friendlyfire": {0, 1}, "mp_freezetime": {0, 30},
	"mp_roundtime": {1, 100}, "mp_timelimit": {0, 10000},
	"mp_roundlimit": {0, 1000000}, "mp_winlimit": {0, 1000000},
}

var cs2dScalarLine = regexp.MustCompile(`^([ \t]*)([A-Za-z_][A-Za-z0-9_]*)([ \t]+)("[0-9]+"|[0-9]+)([ \t]*)(?://.*)?$`)
var cs2dScalarInteger = regexp.MustCompile(`^[0-9]+$`)

func validCS2DGameplayValue(key, value string) bool {
	bounds, known := cs2dGameplayBounds[key]
	if !known || len(value) > 10 || !cs2dScalarInteger.MatchString(value) {
		return false
	}
	n, err := strconv.Atoi(value)
	return err == nil && n >= bounds[0] && n <= bounds[1]
}

// This executable CFG is not INI. Value-only spans preserve unknown commands,
// comments, quotation style and even the publisher archive's CRCRLF endings.
// Unsupported control syntax or command ambiguity makes discovered fields
// readonly; raw credentials and other commands are never returned as fields.
func parseCS2DSettings(data []byte) (gameSettingsParsed, error) {
	if len(data) > 8*1024*1024 || !utf8.Valid(data) || bytes.Count(data, []byte{'\n'}) > 100000 {
		return gameSettingsParsed{}, bad("Invalid or oversized CS2D settings document.")
	}
	type span struct {
		line, start, end int
		value            string
		quoted           bool
	}
	out := gameSettingsParsed{fields: []gameSetting{}}
	lines := strings.SplitAfter(string(data), "\n")
	spans := map[string]span{}
	counts := map[string]int{}
	unsafe := false
	for index, raw := range lines {
		line := strings.TrimSuffix(raw, "\n")
		line = strings.TrimRight(line, "\r")
		offset := 0
		if index == 0 && strings.HasPrefix(line, "\ufeff") {
			line, offset = strings.TrimPrefix(line, "\ufeff"), 3
		}
		if len(line) > 65536 {
			return gameSettingsParsed{}, bad("CS2D configuration line exceeds its limit.")
		}
		quoted := false
		for i := 0; i < len(line); i++ {
			c := line[i]
			if !quoted && c == '/' && i+1 < len(line) && line[i+1] == '/' {
				break
			}
			if c == '"' {
				quoted = !quoted
			}
			if c < 32 && c != '\t' || c == 127 || (!quoted && (strings.ContainsRune(";{}", rune(c)) || c == '/' && i+1 < len(line) && line[i+1] == '*')) {
				unsafe = true
			}
		}
		if quoted || strings.ContainsAny(line, "\u0085\u2028\u2029") {
			unsafe = true
		}
		trim := strings.TrimSpace(line)
		if trim == "" || strings.HasPrefix(trim, "//") {
			continue
		}
		key := trim
		if end := strings.IndexAny(trim, " \t;=\""); end >= 0 {
			key = trim[:end]
		}
		key = strings.ToLower(key)
		// Includes can override the same commands outside this document. Do not
		// present an effective settings editor when that authority is unknown.
		if key == "exec" || key == "lua" || key == "lua_dofile" || key == "alias" {
			unsafe = true
		}
		if _, known := cs2dGameplayBounds[key]; !known {
			continue
		}
		counts[key]++
		match := cs2dScalarLine.FindStringSubmatchIndex(line)
		if match == nil {
			continue
		}
		start, end := match[8], match[9]
		value := line[start:end]
		q := strings.HasPrefix(value, "\"")
		if q {
			value = value[1 : len(value)-1]
		}
		if _, exists := spans[key]; exists {
			continue
		}
		field := gameSetting{key: key, value: value, kind: "number"}
		if key == "sv_friendlyfire" {
			field.kind, field.on, field.off = "boolean", "1", "0"
		}
		if !validCS2DGameplayValue(key, value) {
			field.kind = "readonly"
		}
		spans[key] = span{index, start + offset, end + offset, value, q}
		out.fields = append(out.fields, field)
	}
	writable := map[string]bool{}
	for index := range out.fields {
		field := &out.fields[index]
		if unsafe || counts[field.key] != 1 {
			field.kind = "readonly"
		}
		writable[field.key] = field.kind != "readonly"
	}
	out.patch = func(changes map[string]string) ([]byte, error) {
		for key, value := range changes {
			if !writable[key] || !validCS2DGameplayValue(key, value) {
				return nil, bad("This CS2D gameplay setting cannot be changed here.")
			}
		}
		updated := append([]string(nil), lines...)
		for key, value := range changes {
			s := spans[key]
			if value == s.value {
				continue
			}
			encoded := value
			if s.quoted {
				encoded = "\"" + value + "\""
			}
			line := updated[s.line]
			updated[s.line] = line[:s.start] + encoded + line[s.end:]
		}
		return []byte(strings.Join(updated, "")), nil
	}
	return out, nil
}
