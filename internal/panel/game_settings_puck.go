package panel

import (
	"bytes"
	"encoding/json"
	"strings"
	"unicode/utf8"
)

const puckSettingsPath = "/server_config.json"

// Pure, unregistered parser for the captured build 24731491 ServerConfig schema.
// Startup authority, permissions, stopped state and revision are caller gates.
// The helper owns other native fields; only an existing whitelist toggle survives
// its setdefault operation without competing with original startup controls.
func parsePuckSettings(data []byte) (gameSettingsParsed, error) {
	out := gameSettingsParsed{}
	invalid := func() error { return bad("Invalid or ambiguous Puck native configuration.") }
	body := bytes.TrimPrefix(data, []byte{0xef, 0xbb, 0xbf})
	if len(data) > 4*1024*1024 || !utf8.Valid(body) || !json.Valid(body) {
		return out, invalid()
	}
	spans, err := bananaJSONSpans(body)
	if err != nil || !spans[""].object {
		return out, invalid()
	}
	// Check every object, including unknown/plugin objects, without normalizing bytes.
	objects := map[string]map[string]bool{}
	for pointer := range spans {
		i := strings.LastIndex(pointer, "/")
		if i < 0 {
			continue
		}
		parent, key := pointer[:i], strings.ToLower(pointer[i+1:])
		if objects[parent] == nil {
			objects[parent] = map[string]bool{}
		}
		if objects[parent][key] {
			return out, invalid()
		}
		objects[parent][key] = true
		if strings.EqualFold(pointer, "/useWhitelist") && pointer != "/useWhitelist" {
			return out, invalid()
		}
	}
	span, exists := spans["/useWhitelist"]
	if exists {
		raw := string(body[span.start:span.end])
		if raw != "true" && raw != "false" {
			return out, invalid()
		}
		out.fields = append(out.fields, gameSetting{key: "/useWhitelist", kind: "boolean", value: raw, on: "true", off: "false"})
	}
	original := bytes.Clone(data)
	out.patch = func(changes map[string]string) ([]byte, error) {
		next := bytes.Clone(original)
		for key, value := range changes {
			if key != "/useWhitelist" || !exists || (value != "true" && value != "false") {
				return nil, invalid()
			}
			if value == string(body[span.start:span.end]) {
				continue
			}
			offset := len(original) - len(body)
			next = append(append(append([]byte{}, original[:offset+span.start]...), []byte(value)...), original[offset+span.end:]...)
		}
		if _, err := parsePuckSettings(next); err != nil {
			return nil, err
		}
		return next, nil
	}
	return out, nil
}
