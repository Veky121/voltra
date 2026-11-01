package panel

import (
	"bytes"
	"encoding/json"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"
)

// parseResoniteSessionSettings is an uncomposed extension. Root retains launcher,
// permissions, stopped-only and full-document revision authority. Indexes are
// valid only for that revision; this helper never inserts or reorders worlds.
func parseResoniteSessionSettings(data []byte) (gameSettingsParsed, error) {
	invalid := func() (gameSettingsParsed, error) {
		return gameSettingsParsed{}, bad("Invalid or ambiguous Resonite startup worlds; review in Files.")
	}
	body := bytes.TrimPrefix(data, []byte{0xef, 0xbb, 0xbf})
	offset := len(data) - len(body)
	if len(data) > 4*1024*1024 || !utf8.Valid(data) || !json.Valid(body) {
		return invalid()
	}
	spans, err := bananaJSONSpans(body)
	if err != nil || !spans[""].object {
		return invalid()
	}
	root := ""
	for key := range spans {
		if !strings.Contains(strings.TrimPrefix(key, "/"), "/") && strings.EqualFold(key, "/startWorlds") {
			if root != "" || (key != "/startWorlds" && key != "/StartWorlds") {
				return invalid()
			}
			root = key
		}
	}
	kinds := map[string]string{"sessionName": "text", "description": "text", "accessLevel": "text", "maxUsers": "number", "isEnabled": "boolean", "saveOnExit": "boolean", "autoRecover": "boolean", "autoSleep": "boolean"}
	order := []string{"sessionName", "description", "accessLevel", "maxUsers", "isEnabled", "saveOnExit", "autoRecover", "autoSleep"}
	validate := func(name, value string) bool {
		switch name {
		case "sessionName", "description":
			return bananaSettingsText(value, 4096)
		case "accessLevel":
			return value == "Private" || value == "LAN" || value == "Contacts" || value == "ContactsPlus" || value == "RegisteredUsers" || value == "Anyone"
		case "maxUsers":
			// Positive Int32 is a conservative editor policy, not a published capacity recommendation.
			n, e := strconv.ParseInt(value, 10, 32)
			return e == nil && n > 0 && strconv.FormatInt(n, 10) == value
		default:
			return value == "true" || value == "false"
		}
	}
	parsed := gameSettingsParsed{}
	present := map[string]string{}
	if root != "" {
		s := spans[root]
		raw := body[s.start:s.end]
		if string(raw) != "null" {
			if len(raw) == 0 || raw[0] != '[' {
				return invalid()
			}
			var worlds []json.RawMessage
			if json.Unmarshal(raw, &worlds) != nil {
				return invalid()
			}
			for i, world := range worlds {
				base := root + "/" + strconv.Itoa(i)
				if bytes.Equal(bytes.TrimSpace(world), []byte("null")) {
					continue
				}
				if !spans[base].object {
					return invalid()
				}
				for path := range spans {
					if !strings.HasPrefix(path, base+"/") {
						continue
					}
					name := strings.TrimPrefix(path, base+"/")
					if strings.Contains(name, "/") {
						continue
					}
					for canonical := range kinds {
						if strings.EqualFold(name, canonical) && name != canonical {
							return invalid()
						}
					}
				}
				for _, name := range order {
					key := base + "/" + name
					span, ok := spans[key]
					if !ok {
						continue
					}
					value := string(body[span.start:span.end])
					if value == "null" && (name == "sessionName" || name == "description") {
						continue
					}
					if kinds[name] == "text" {
						if json.Unmarshal(body[span.start:span.end], &value) != nil {
							return invalid()
						}
					}
					if !validate(name, value) {
						return invalid()
					}
					parsed.fields = append(parsed.fields, gameSetting{key: key, value: value, kind: kinds[name], on: "true", off: "false"})
					present[key] = name
				}
			}
		}
	}
	original := append([]byte(nil), data...)
	parsed.patch = func(changes map[string]string) ([]byte, error) {
		keys := []string{}
		for key, value := range changes {
			name, ok := present[key]
			if !ok || !validate(name, value) {
				return nil, bad("Unsupported Resonite startup-world setting or value.")
			}
			keys = append(keys, key)
		}
		sort.Slice(keys, func(i, j int) bool { return spans[keys[i]].start > spans[keys[j]].start })
		out := append([]byte(nil), original...)
		for _, key := range keys {
			value := []byte(changes[key])
			if kinds[present[key]] == "text" {
				value, _ = json.Marshal(changes[key])
			}
			s := spans[key]
			start, end := s.start+offset, s.end+offset
			next := append([]byte(nil), out[:start]...)
			next = append(next, value...)
			out = append(next, out[end:]...)
		}
		return out, nil
	}
	return parsed, nil
}
