package panel

import "strings"

// Extracted unchanged conservative DDNet value-span lexer; callbacks do not mutate global maps.
type nativeConsoleSettingsSchema struct {
	kind    func(string) string
	valid   func(string, string) bool
	barrier func(string) bool
}

func parseNativeConsoleSettings(data []byte, schema nativeConsoleSettingsSchema) (gameSettingsParsed, error) {
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
			if !quoted && c == '#' {
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
		if trim == "" || strings.HasPrefix(trim, "#") {
			continue
		}
		// Count even unsupported assignments, so a malformed repeated statement
		// cannot leave an earlier occurrence writable. Count case variants conservatively; preserve original command spelling.
		end := strings.IndexAny(trim, " \t;=\"")
		key := trim
		if end >= 0 {
			key = trim[:end]
		}
		key = strings.ToLower(key)
		kind := schema.kind(key)
		known := kind != ""
		if schema.barrier != nil && schema.barrier(key) {
			unsafe = true
		}
		if !known {
			continue
		}
		counts[key]++
		m := ddnetCvarLine.FindStringSubmatchIndex(line)
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
		if !schema.valid(key, value) {
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
			if !writable[key] || !schema.valid(key, value) {
				return nil, bad("This native console setting cannot be changed here.")
			}
			s := spans[key]
			encoded := value
			if s.quoted || schema.kind(key) == "text" {
				encoded = "\"" + value + "\""
			}
			line := updated[s.line]
			updated[s.line] = line[:s.start] + encoded + line[s.end:]
		}
		return []byte(strings.Join(updated, "")), nil
	}
	return out, nil
}
