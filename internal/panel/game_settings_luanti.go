package panel

import (
	"bytes"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"
)

const luantiSettingsPath = "/.minetest/minetest.conf"
const luantiASCIIWhitespace = " \t\r\n\v\f"

// Luanti5.17 settings.cpp uses LF records, the first '=', ASCII trimming and
// literal scalar values. Groups and multiline bodies are never flattened.
type luantiSettingSpan struct{ start, end int }

func luantiSettingNameSafe(name string) bool {
	return name != "" && len(name) <= 256 && !strings.ContainsAny(name, "=\"{}#\x00"+luantiASCIIWhitespace)
}

func luantiSettingRuntime(key string) bool {
	return key == "port" || key == "bind_address" || key == "default_game"
}

func luantiBooleanKey(key string) bool {
	switch key {
	case "server_announce", "creative_mode", "enable_damage", "enable_pvp":
		return true
	}
	return false
}

func luantiBooleanPair(value string) (on, off string, ok bool) {
	// Pinned util/string.h:is_yes recognizes y/yes/true/nonzero atoi; 'on' is
	// false. Only reviewed, unambiguous pairs become switches.
	for _, pair := range [][2]string{{"true", "false"}, {"True", "False"}, {"TRUE", "FALSE"},
		{"yes", "no"}, {"Yes", "No"}, {"YES", "NO"}, {"y", "n"}, {"Y", "N"}, {"1", "0"}} {
		if value == pair[0] || value == pair[1] {
			return pair[0], pair[1], true
		}
	}
	return "", "", false
}

func luantiSettingValue(key, value string) bool {
	if len(value) > 65536 || !utf8.ValidString(value) || strings.ContainsAny(value, "\r\n\x00") || value != strings.Trim(value, luantiASCIIWhitespace) || value == "{" || value == `"""` {
		return false
	}
	if key == "name" {
		if len(value) < 1 || len(value) > 20 {
			return false
		}
		for _, c := range value {
			if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '_' || c == '-') {
				return false
			}
		}
	}
	if key == "server_name" && value == "" {
		return false
	}
	if key == "max_users" {
		if value == "" {
			return false
		}
		for _, c := range value {
			if c < '0' || c > '9' {
				return false
			}
		}
		n, err := strconv.ParseUint(value, 10, 16)
		if err != nil || n < 1 {
			return false
		}
	}
	return true
}

func parseLuantiSettings(data []byte) (gameSettingsParsed, error) {
	out := gameSettingsParsed{fields: []gameSetting{}}
	if len(data) > 8*1024*1024 || !utf8.Valid(data) || bytes.IndexByte(data, 0) >= 0 || bytes.HasPrefix(data, []byte{0xef, 0xbb, 0xbf}) || bytes.Count(data, []byte{'\n'}) > 100000 {
		return out, bad("Invalid or oversized Luanti configuration.")
	}
	original := string(data)
	lines := strings.SplitAfter(original, "\n")
	offsets := make([]int, len(lines))
	for i := 1; i < len(lines); i++ {
		offsets[i] = offsets[i-1] + len(lines[i-1])
	}
	// Each object scanner starts after its opener. A multiline terminator must
	// be the raw LF-only line; CRLF 'closing quotes' remain inside the body.
	var skipObject func(int, string, int) (int, error)
	skipObject = func(index int, kind string, depth int) (int, error) {
		if depth > 64 {
			return index, bad("Luanti configuration nesting is too deep.")
		}
		for index < len(lines) {
			raw := strings.TrimSuffix(lines[index], "\n")
			index++
			if kind == `"""` {
				if raw == `"""` {
					return index, nil
				}
				continue
			}
			trim := strings.Trim(raw, luantiASCIIWhitespace)
			if trim == "}" {
				return index, nil
			}
			if trim == "" || strings.HasPrefix(trim, "#") {
				continue
			}
			if equal := strings.IndexByte(trim, '='); equal >= 0 {
				value := strings.Trim(trim[equal+1:], luantiASCIIWhitespace)
				if value == "{" || value == `"""` {
					var err error
					index, err = skipObject(index, value, depth+1)
					if err != nil {
						return index, err
					}
				}
			}
		}
		return index, bad("Unterminated Luanti group or multiline value; review it in Files.")
	}
	spans, counts, writable := map[string]luantiSettingSpan{}, map[string]int{}, map[string]bool{}
	for index := 0; index < len(lines); {
		lineIndex, raw := index, strings.TrimSuffix(lines[index], "\n")
		index++
		trim := strings.Trim(raw, luantiASCIIWhitespace)
		if trim == "" || strings.HasPrefix(trim, "#") {
			continue
		}
		equal := strings.IndexByte(raw, '=')
		if equal < 0 {
			continue // The native parser also ignores unsupported nonassignments.
		}
		key := strings.Trim(raw[:equal], luantiASCIIWhitespace)
		value := strings.Trim(raw[equal+1:], luantiASCIIWhitespace)
		opaque := value == "{" || value == `"""`
		if opaque {
			var err error
			index, err = skipObject(index, value, 1)
			if err != nil {
				return out, err
			}
		}
		if !luantiSettingNameSafe(key) {
			continue // Still consume an opaque body, even for an invalid name.
		}
		counts[key]++
		if counts[key] != 1 {
			continue
		}
		f := gameSetting{key: key, value: value, kind: "text", secret: gameSettingSecret.MatchString(key)}
		if opaque {
			f.kind, f.value = "readonly", "Opaque native value; edit in Files."
		} else if !luantiSettingValue(key, value) {
			f.kind = "readonly"
			if len(value) > 65536 {
				f.value = "Large native value; edit in Files."
			}
		} else if luantiBooleanKey(key) {
			if on, off, ok := luantiBooleanPair(value); ok {
				f.kind, f.on, f.off = "boolean", on, off
			} else {
				f.kind = "readonly"
			}
		} else if key == "max_users" {
			f.kind = "number"
		}
		if luantiSettingRuntime(key) {
			f.kind = "readonly"
		}
		// Preserve delimiter/indentation/trailing whitespace/CRLF exactly. For an
		// empty CRLF value the insertion point is before the terminal CR.
		content := strings.TrimSuffix(raw, "\r")
		tail := content[equal+1:]
		left, right := 0, len(tail)
		for left < right && strings.ContainsRune(luantiASCIIWhitespace, rune(tail[left])) {
			left++
		}
		for right > left && strings.ContainsRune(luantiASCIIWhitespace, rune(tail[right-1])) {
			right--
		}
		spans[key] = luantiSettingSpan{offsets[lineIndex] + equal + 1 + left, offsets[lineIndex] + equal + 1 + right}
		out.fields = append(out.fields, f)
		if len(out.fields) > 4000 {
			return out, bad("Too many Luanti settings.")
		}
	}
	for index := range out.fields {
		f := &out.fields[index]
		if counts[f.key] > 1 {
			f.kind, f.value = "readonly", "Repeated native setting; edit in Files."
		}
		writable[f.key] = f.kind != "readonly"
	}
	out.patch = func(changes map[string]string) ([]byte, error) {
		type edit struct {
			luantiSettingSpan
			value string
		}
		edits := make([]edit, 0, len(changes))
		for key, value := range changes {
			if !writable[key] || !luantiSettingValue(key, value) {
				return nil, bad("This Luanti setting cannot be changed here.")
			}
			if luantiBooleanKey(key) {
				allowed := false
				for _, f := range out.fields {
					if f.key == key && (value == f.on || value == f.off) {
						allowed = true
						break
					}
				}
				if !allowed {
					return nil, bad("Choose a valid Luanti boolean value.")
				}
			}
			edits = append(edits, edit{spans[key], value})
		}
		sort.Slice(edits, func(i, j int) bool { return edits[i].start > edits[j].start })
		result := original
		for _, e := range edits {
			result = result[:e.start] + e.value + result[e.end:]
		}
		return []byte(result), nil
	}
	return out, nil
}
