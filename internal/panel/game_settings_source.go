package panel

import (
	"math"
	"regexp"
	"strconv"
	"strings"
)

const sourceSettingsPath = "/game/csgo/cfg/voltra-native.cfg"

// Only reviewed gameplay cvars belong here. Source CFG also executes commands;
// inferring editability from a name or value would expose that command language.
var sourceSettingKinds = map[string]string{
	"sv_cheats": "boolean", "mp_friendlyfire": "boolean", "mp_autoteambalance": "boolean",
	"mp_limitteams": "number", "mp_roundtime": "number", "mp_freezetime": "number",
	"mp_maxrounds": "number", "bot_quota": "number",
	"mp_teamname_1": "text", "mp_teamname_2": "text",
}
var sourceCvarLine = regexp.MustCompile(`^([ \t]*)([A-Za-z_][A-Za-z0-9_]*)([ \t]+)("[^"\\]*"|[^ \t"\\;]+)([ \t]*)(?://.*)?$`)
var sourceNumber = regexp.MustCompile(`^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)$`)

// parseSourceSettings edits value spans only. Unsupported control syntax makes
// the whole document read-only because line-local reasoning cannot establish
// top-level statements inside a block, continuation or command chain.
func parseSourceSettings(data []byte) (gameSettingsParsed, error) {
	return parseSourceSettingsWithSchema(data, sourceSettingKinds, sourceSettingValue)
}

func parseSourceSettingsWithSchema(data []byte, kinds map[string]string, validate func(string, string) bool) (gameSettingsParsed, error) {
	out := gameSettingsParsed{fields: []gameSetting{}}
	lines := strings.SplitAfter(string(data), "\n")
	type span struct {
		line, start, end int
		quoted           bool
	}
	spans := map[string]span{}
	counts := map[string]int{}
	unsafe := false
	for index, raw := range lines {
		line := strings.TrimRight(raw, "\r\n")
		quoted := false
		for i := 0; i < len(line); i++ {
			c := line[i]
			if !quoted && c == '/' && i+1 < len(line) && line[i+1] == '/' {
				break
			}
			if c == '"' {
				quoted = !quoted
			}
			if c < 32 && c != '\t' || c == '\\' || (!quoted && (strings.ContainsRune(";{}", rune(c)) || c == '/' && i+1 < len(line) && line[i+1] == '*')) {
				unsafe = true
			}
		}
		if quoted {
			unsafe = true
		}
		trim := strings.TrimSpace(line)
		if trim == "" || strings.HasPrefix(trim, "//") {
			continue
		}
		// Count even unsupported assignments, so a malformed repeated statement
		// cannot leave an earlier occurrence writable. Source names ignore case.
		end := strings.IndexAny(trim, " \t;=\"")
		key := trim
		if end >= 0 {
			key = trim[:end]
		}
		key = strings.ToLower(key)
		kind, known := kinds[key]
		if !known {
			continue
		}
		counts[key]++
		m := sourceCvarLine.FindStringSubmatchIndex(line)
		if m == nil {
			continue
		}
		start, stop := m[8], m[9]
		value := line[start:stop]
		q := strings.HasPrefix(value, "\"")
		if q {
			value = value[1 : len(value)-1]
		}
		f := gameSetting{key: key, value: value, kind: kind}
		if kind == "boolean" {
			f.on, f.off = "1", "0"
		}
		if !validate(key, value) {
			f.kind = "readonly"
		}
		if _, exists := spans[key]; !exists {
			spans[key] = span{index, start, stop, q}
			out.fields = append(out.fields, f)
		}
	}
	writable := map[string]bool{}
	for i := range out.fields {
		f := &out.fields[i]
		if unsafe || counts[f.key] != 1 {
			f.kind = "readonly"
		}
		writable[f.key] = f.kind != "readonly"
	}
	out.patch = func(changes map[string]string) ([]byte, error) {
		updated := append([]string(nil), lines...)
		for key, value := range changes {
			if !writable[key] || !validate(key, value) {
				return nil, bad("This Source setting cannot be changed here.")
			}
			s := spans[key]
			encoded := value
			if s.quoted || kinds[key] == "text" {
				encoded = "\"" + value + "\""
			}
			line := updated[s.line]
			updated[s.line] = line[:s.start] + encoded + line[s.end:]
		}
		return []byte(strings.Join(updated, "")), nil
	}
	return out, nil
}

func sourceSettingValue(key, value string) bool {
	// Do not rely on Source's escaping or semicolon handling. Reject all command
	// delimiters, quotes, escapes and control characters, including Unicode lines.
	for _, c := range value {
		if c < 32 || c == 127 || c == '\u0085' || c == '\u2028' || c == '\u2029' || strings.ContainsRune(";\"\\", c) {
			return false
		}
	}
	switch sourceSettingKinds[key] {
	case "boolean":
		return value == "0" || value == "1"
	case "number":
		n, err := strconv.ParseFloat(value, 64)
		return sourceNumber.MatchString(value) && err == nil && !math.IsInf(n, 0) && !math.IsNaN(n)
	case "text":
		return len(value) <= 256
	}
	return false
}
