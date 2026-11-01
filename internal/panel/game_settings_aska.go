package panel

import (
	"strings"
	"unicode/utf8"
)

const askaSettingsPath = "/server properties.txt"

// ASKA uses literal plain-equals properties, with spaces in keys. Java
// properties escaping and INI quote/comment rules do not apply to its values.
func parseASKASettings(data []byte) (gameSettingsParsed, error) {
	out := gameSettingsParsed{fields: []gameSetting{}}
	if !utf8.Valid(data) || len(data) > 8*1024*1024 || strings.ContainsRune(string(data), 0) {
		return out, bad("Invalid ASKA settings document.")
	}
	known := map[string]bool{"display name": true, "server name": true, "password": true, "region": true, "keep server world alive": true, "authentication token": true}
	type span struct{ line, start, end int }
	spans := map[string]span{}
	lines := strings.SplitAfter(string(data), "\n")
	for i, line := range lines {
		prefix := 0
		if i == 0 && strings.HasPrefix(line, "\ufeff") {
			prefix = len("\ufeff")
		}
		text := line[prefix:]
		trim := strings.TrimSpace(text)
		if strings.HasPrefix(trim, "#") || strings.HasPrefix(trim, ";") {
			continue
		}
		eq := strings.IndexByte(text, '=')
		if eq < 0 {
			continue
		}
		name := strings.TrimSpace(text[:eq])
		key := strings.ToLower(name)
		if !known[key] {
			continue
		}
		if name != key {
			return out, bad("Ambiguous ASKA property identity.")
		}
		if _, exists := spans[key]; exists {
			return out, bad("Repeated ASKA property.")
		}
		start, end := prefix+eq+1, len(strings.TrimRight(line, "\r\n"))
		for start < end && (line[start] == ' ' || line[start] == '\t') {
			start++
		}
		for end > start && (line[end-1] == ' ' || line[end-1] == '\t') {
			end--
		}
		value := line[start:end]
		if !askaSettingValue(key, value) {
			return out, bad("Invalid ASKA property value.")
		}
		field := gameSetting{key: key, value: value, kind: "text"}
		if key == "keep server world alive" {
			field.kind, field.on, field.off = "boolean", "true", "false"
		}
		out.fields = append(out.fields, field)
		spans[key] = span{i, start, end}
	}
	out.patch = func(changes map[string]string) ([]byte, error) {
		updated := append([]string(nil), lines...)
		for key, value := range changes {
			s, ok := spans[key]
			if !ok || !askaSettingValue(key, value) {
				return nil, bad("Invalid ASKA setting change.")
			}
			line := updated[s.line]
			updated[s.line] = line[:s.start] + value + line[s.end:]
		}
		return []byte(strings.Join(updated, "")), nil
	}
	return out, nil
}

func askaSettingValue(key, value string) bool {
	if !utf8.ValidString(value) || len(value) > 8192 {
		return false
	}
	for _, r := range value {
		if r < 32 || r == 127 {
			return false
		}
	}
	if key == "keep server world alive" {
		return value == "true" || value == "false"
	}
	return key != "authentication token" || strings.TrimSpace(value) != ""
}
