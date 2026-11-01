package panel

import (
	"bytes"
	"encoding/json"
	"regexp"
	"sort"
	"strings"
	"unicode/utf8"
)

// Dispatch and file/startup authority belong to root. This parser neither
// discovers files nor seeds defaults. Only existing, evidenced scalars appear.
func parseStarboundSettings(data []byte) (gameSettingsParsed, error) {
	invalid := func() (gameSettingsParsed, error) {
		return gameSettingsParsed{}, bad("Invalid or ambiguous Starbound configuration.")
	}
	if len(data) > 4*1024*1024 || !utf8.Valid(data) {
		return invalid()
	}
	prefix := []byte(nil)
	body := append([]byte(nil), data...)
	if bytes.HasPrefix(body, []byte{239, 187, 191}) {
		prefix, body = body[:3], body[3:]
	}
	if !json.Valid(body) {
		return invalid()
	}
	spans, err := bananaJSONSpans(body)
	if err != nil || !spans[""].object {
		return invalid()
	}
	// Match the runtime's case-insensitive ambiguity refusal, including nested
	// operator objects, without interpreting or exposing their contents.
	seen := map[string]bool{}
	for key := range spans {
		folded := strings.ToLower(key)
		if seen[folded] {
			return invalid()
		}
		seen[folded] = true
	}
	kinds := map[string]string{"/serverName": "text", "/maxPlayers": "number", "/allowAnonymousConnections": "boolean", "/allowAssetsMismatch": "boolean"}
	order := []string{"/serverName", "/maxPlayers", "/allowAnonymousConnections", "/allowAssetsMismatch"}
	for key := range spans {
		for _, reserved := range order {
			if key != reserved && strings.EqualFold(key, reserved) {
				return invalid()
			}
		}
	}
	integer := regexp.MustCompile(`^[0-9]+$`)
	valid := func(kind, value string) bool {
		switch kind {
		case "text":
			if !utf8.ValidString(value) {
				return false
			}
			for _, r := range value {
				if r < 32 || r == 127 {
					return false
				}
			}
			return true
		case "number":
			return integer.MatchString(value) && (value == "0" || value[0] != '0')
		case "boolean":
			return value == "true" || value == "false"
		}
		return false
	}
	out := gameSettingsParsed{fields: []gameSetting{}}
	fields := map[string]gameSetting{}
	for _, key := range order {
		span, exists := spans[key]
		if !exists {
			continue
		}
		raw := string(body[span.start:span.end])
		kind := kinds[key]
		value := raw
		// Null is an absent value, never converted to a zero or a writable default.
		if raw == "null" {
			continue
		}
		if kind == "text" {
			if len(raw) == 0 || raw[0] != '"' || json.Unmarshal([]byte(raw), &value) != nil {
				return invalid()
			}
		}
		if !valid(kind, value) {
			return invalid()
		}
		f := gameSetting{key: key, value: value, kind: kind, on: "true", off: "false"}
		fields[key] = f
		out.fields = append(out.fields, f)
	}
	out.patch = func(changes map[string]string) ([]byte, error) {
		keys := []string{}
		encoded := map[string][]byte{}
		for key, value := range changes {
			f, exists := fields[key]
			if !exists || !valid(f.kind, value) {
				return nil, bad("This Starbound scalar cannot be changed here.")
			}
			if value == f.value {
				continue
			}
			encoded[key] = []byte(value)
			if f.kind == "text" {
				encoded[key], _ = json.Marshal(value)
			}
			keys = append(keys, key)
		}
		sort.Slice(keys, func(i, j int) bool { return spans[keys[i]].start > spans[keys[j]].start })
		result := append([]byte(nil), body...)
		for _, key := range keys {
			s := spans[key]
			next := append([]byte(nil), result[:s.start]...)
			next = append(next, encoded[key]...)
			result = append(next, result[s.end:]...)
		}
		return append(append([]byte(nil), prefix...), result...), nil
	}
	return out, nil
}
