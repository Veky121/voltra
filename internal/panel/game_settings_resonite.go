package panel

import (
	"encoding/json"
	"sort"
	"strings"
	"unicode/utf8"
)

// Exact owner launcher and config path only. Optional absent keys stay absent.
// Session/world controls are supplied by the separately scoped composed parser.
func parseResoniteSettings(data []byte) (gameSettingsParsed, error) {
	invalid := func() (gameSettingsParsed, error) {
		return gameSettingsParsed{}, bad("Invalid or ambiguous Resonite configuration; review in Files.")
	}
	if len(data) > 4*1024*1024 || !utf8.Valid(data) || !json.Valid(data) {
		return invalid()
	}
	spans, err := bananaJSONSpans(data)
	if err != nil || !spans[""].object {
		return invalid()
	}
	kinds := map[string]string{"/comment": "text", "/usernameOverride": "text", "/loginCredential": "text", "/loginPassword": "text"}
	parents := []string{}
	reserved := append([]string{}, parents...)
	for key := range kinds {
		reserved = append(reserved, key)
	}
	for key := range spans {
		for _, name := range reserved {
			if key != name && strings.EqualFold(key, name) {
				return invalid()
			}
		}
	}
	for _, key := range parents {
		if span, ok := spans[key]; ok && !span.object {
			return invalid()
		}
	}
	parsed := gameSettingsParsed{}
	// Keep general identity fields before credentials.
	keys := []string{"/comment", "/usernameOverride", "/loginCredential", "/loginPassword"}
	validate := func(key, value string) bool {
		switch kinds[key] {
		case "boolean":
			return value == "true" || value == "false"
		case "select":
			return value == "Small" || value == "Normal" || value == "Large"
		case "text":
			// Bound matches the existing scoped helper, not a publisher recommendation.
			if !utf8.ValidString(value) || utf8.RuneCountInString(value) > 4096 {
				return false
			}
			for _, r := range value {
				if r < 32 || r == 127 {
					return false
				}
			}
			return true
		}
		return false
	}
	present := map[string]bool{}
	for _, key := range keys {
		span, ok := spans[key]
		if !ok {
			continue
		}
		raw := data[span.start:span.end]
		value := string(raw)
		if kinds[key] != "boolean" {
			if len(raw) == 0 || raw[0] != '"' || json.Unmarshal(raw, &value) != nil {
				return invalid()
			}
		}
		if !validate(key, value) {
			return invalid()
		}
		kind := kinds[key]
		if kind == "select" {
			kind = "text"
		} // Metadata supplies select options.
		parsed.fields = append(parsed.fields, gameSetting{key: key, value: value, kind: kind, on: "true", off: "false"})
		present[key] = true
	}
	original := append([]byte(nil), data...)
	parsed.patch = func(changes map[string]string) ([]byte, error) {
		ordered := []string{}
		for key, value := range changes {
			if !present[key] || !validate(key, value) {
				return nil, bad("Unsupported Resonite setting or value.")
			}
			ordered = append(ordered, key)
		}
		sort.Slice(ordered, func(i, j int) bool { return spans[ordered[i]].start > spans[ordered[j]].start })
		out := append([]byte(nil), original...)
		for _, key := range ordered {
			value := []byte(changes[key])
			if kinds[key] != "boolean" {
				value, _ = json.Marshal(changes[key])
			}
			span := spans[key]
			next := append([]byte(nil), out[:span.start]...)
			next = append(next, value...)
			out = append(next, out[span.end:]...)
		}
		return out, nil
	}
	return parsed, nil
}
