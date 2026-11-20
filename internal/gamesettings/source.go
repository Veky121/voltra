package gamesettings

import (
	"math"
	"regexp"
	"strconv"
	"strings"
)

const SourceSettingsPath = "/game/csgo/cfg/voltra-native.cfg"

// Only reviewed gameplay cvars belong here. Source CFG also executes commands;
// inferring editability from a name or value would expose that command language.
var SourceSettingKinds = map[string]string{
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
func parseSourceSettings(data []byte) (Parsed, error) {
	return parseSourceSettingsWithSchema(data, SourceSettingKinds, SourceSettingValue)
}

func parseSourceSettingsWithSchema(data []byte, kinds map[string]string, validate func(string, string) bool) (Parsed, error) {
	out := Parsed{Fields: []Setting{}}
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
		f := Setting{Key: key, Value: value, Kind: kind}
		if kind == "boolean" {
			f.On, f.Off = "1", "0"
		}
		if !validate(key, value) {
			f.Kind = "readonly"
		}
		if _, exists := spans[key]; !exists {
			spans[key] = span{index, start, stop, q}
			out.Fields = append(out.Fields, f)
		}
	}
	writable := map[string]bool{}
	for i := range out.Fields {
		f := &out.Fields[i]
		if unsafe || counts[f.Key] != 1 {
			f.Kind = "readonly"
		}
		writable[f.Key] = f.Kind != "readonly"
	}
	out.Patch = func(changes map[string]string) ([]byte, error) {
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

func SourceSettingValue(key, value string) bool {
	// Do not rely on Source's escaping or semicolon handling. Reject all command
	// delimiters, quotes, escapes and control characters, including Unicode lines.
	for _, c := range value {
		if c < 32 || c == 127 || c == '\u0085' || c == '\u2028' || c == '\u2029' || strings.ContainsRune(";\"\\", c) {
			return false
		}
	}
	switch SourceSettingKinds[key] {
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
