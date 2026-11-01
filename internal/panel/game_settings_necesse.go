package panel

import (
	"bytes"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"
)

const necesseSettingsRecipe = "necesse/egg-necesse.json"
const necesseSettingsPath = "/cfg/server.cfg"

// Necesse SaveData is a named brace block, not Quake CFG or INI.
// Existing primitive defaults only; private and managed fields cannot be patched.
var necesseScalarLine = regexp.MustCompile(`^\s*([A-Za-z][A-Za-z0-9]*)\s*=\s*(.*?)\s*$`)
var necesseNativeKinds = map[string]string{
	"port": "number", "slots": "number", "pauseWhenEmpty": "boolean",
	"logging": "boolean", "strictServerAuthority": "boolean", "maxClientLatencySeconds": "number",
	"unloadLevelsCooldown": "number", "droppedItemsLifeMinutes": "number", "unloadSettlements": "boolean",
	"maxSettlementsPerPlayer": "number", "maxSettlersPerSettlement": "number", "zipSaves": "boolean",
}

// Native Settings.loadServerData uses signed Java ints; only the cooldown is clamped.
func necesseEditable(key string) bool {
	_, ok := necesseNativeKinds[key]
	return ok && key != "port" && key != "slots" && key != "pauseWhenEmpty"
}
func necesseValue(key, value string) error {
	if necesseNativeKinds[key] == "boolean" {
		if value != "true" && value != "false" {
			return bad("Expected true or false.")
		}
	} else {
		if !regexp.MustCompile(`^[+-]?[0-9]+$`).MatchString(value) {
			return bad("Expected a signed integer.")
		}
		n, err := strconv.ParseInt(value, 10, 32)
		if err != nil || (key == "unloadLevelsCooldown" && n < 2) {
			return bad("Native integer outside supported range.")
		}
	}
	return nil
}
func parseNecesseSettings(data []byte) (gameSettingsParsed, error) {
	out := gameSettingsParsed{}
	if !utf8.Valid(data) || bytes.IndexByte(data, 0) >= 0 || bytes.HasPrefix(data, []byte{239, 187, 191}) {
		return out, bad("Unsafe native encoding.")
	}
	type span struct {
		start, end int
		key        string
	}
	spans := []span{}
	opened, closed, pending := false, false, false
	seen := map[string]bool{}
	offset := 0
	linePattern := regexp.MustCompile(`^[ \t]*([A-Za-z][A-Za-z0-9]*)[ \t]*=[ \t]*(.*?)[ \t]*$`)
	for _, raw := range bytes.SplitAfter(data, []byte("\n")) {
		line := strings.TrimSuffix(strings.TrimSuffix(string(raw), "\n"), "\r")
		if strings.ContainsAny(line, "\r\v\f") {
			return out, bad("Unsupported native whitespace.")
		}
		code := strings.SplitN(line, "//", 2)[0]
		trimmed := strings.Trim(code, " \t")
		if trimmed != "" {
			if !opened {
				if trimmed != "SERVER = {" {
					return out, bad("Expected native SERVER block.")
				}
				opened = true
			} else if trimmed == "}" && !closed {
				closed = true
			} else {
				if closed || pending {
					return out, bad("Ambiguous native topology.")
				}
				m := linePattern.FindStringSubmatchIndex(code)
				if m == nil {
					return out, bad("Unsupported native syntax.")
				}
				key := code[m[2]:m[3]]
				if seen[key] {
					return out, bad("Repeated native setting.")
				}
				seen[key] = true
				start, end := m[4], m[5]
				for end > start && (code[end-1] == ' ' || code[end-1] == '\t') {
					end--
				}
				if end > start && code[end-1] == ',' {
					end--
					for end > start && (code[end-1] == ' ' || code[end-1] == '\t') {
						end--
					}
				} else {
					pending = true
				}
				value := code[start:end]
				// Refuse constructs whose native nesting/escaping could hide another assignment.
				if strings.ContainsAny(value, "{},;=\"'\\[]") {
					return out, bad("Ambiguous native scalar.")
				}
				if kind, ok := necesseNativeKinds[key]; ok {
					effective := value
					if key == "unloadLevelsCooldown" {
						if n, err := strconv.ParseInt(value, 10, 32); err == nil && n < 2 {
							effective = "2"
						}
					}
					if err := necesseValue(key, effective); err != nil {
						return out, err
					}
					out.fields = append(out.fields, gameSetting{key: key, value: effective, kind: kind, on: "true", off: "false"})
					spans = append(spans, span{offset + start, offset + end, key})
				}
			}
		}
		offset += len(raw)
	}
	if !opened || !closed {
		return out, bad("Incomplete native SERVER block.")
	}
	original := append([]byte(nil), data...)
	out.patch = func(updates map[string]string) ([]byte, error) {
		for key, value := range updates {
			if !seen[key] || !necesseEditable(key) {
				return nil, bad("Setting is private, unknown, absent or managed by Startup/Network.")
			}
			if err := necesseValue(key, value); err != nil {
				return nil, err
			}
		}
		result := []byte{}
		last := 0
		for _, s := range spans {
			if value, ok := updates[s.key]; ok {
				// Preserve native spellings and clamped raw defaults on semantic no-ops.
				unchanged := false
				for _, field := range out.fields {
					if field.key != s.key {
						continue
					}
					unchanged = value == field.value
					if field.kind == "number" {
						a, ea := strconv.ParseInt(value, 10, 32)
						b, eb := strconv.ParseInt(field.value, 10, 32)
						unchanged = ea == nil && eb == nil && a == b
					}
				}
				if unchanged {
					continue
				}
				result = append(result, original[last:s.start]...)
				result = append(result, []byte(value)...)
				last = s.end
			}
		}
		result = append(result, original[last:]...)
		return result, nil
	}
	return out, nil
}
func necesseSettingPresentation(field M) {
	key := str(field["key"])
	if !necesseEditable(key) {
		field["readonly"] = true
	}
	labels := map[string]string{
		"port": "Port", "slots": "Player slots", "pauseWhenEmpty": "Pause when empty",
		"logging": "Write log files", "strictServerAuthority": "Strict server checks",
		"maxClientLatencySeconds": "Maximum client latency (seconds)",
		"unloadLevelsCooldown":    "Level unload delay (seconds)",
		"droppedItemsLifeMinutes": "Dropped item lifetime (minutes)",
		"unloadSettlements":       "Unload inactive settlements", "maxSettlementsPerPlayer": "Settlements per player",
		"maxSettlersPerSettlement": "Settlers per settlement", "zipSaves": "Store new worlds as ZIP files",
	}
	field["label"] = labels[key]
	if !necesseEditable(key) {
		field["label"] = "Saved default: " + labels[key]
	}
	field["description"] = "Saved server setting. Changes take effect on the next start."
	switch key {
	case "port":
		field["description"] = "The allocated Network port overrides this saved default."
	case "slots":
		field["description"] = "Change player capacity through Startup. The launcher overrides this saved default."
	case "pauseWhenEmpty":
		field["description"] = "Change pause when empty through Startup. The launcher overrides this saved default."
	case "logging":
		field["description"] = "Write a log file each time the server starts."
	case "strictServerAuthority":
		field["description"] = "Apply stricter checks to actions sent by clients."
	case "maxClientLatencySeconds":
		field["description"] = "Set the allowed client latency in seconds."
	case "unloadLevelsCooldown":
		field["description"] = "Keep empty levels loaded for this many seconds."
		field["min"], field["max"] = 2, 2147483647
	case "droppedItemsLifeMinutes":
		field["description"] = "Keep dropped items for this many minutes; zero or less keeps them indefinitely."
	case "unloadSettlements":
		field["description"] = "Allow unused player settlements to unload."
	case "maxSettlementsPerPlayer":
		field["description"] = "Limit settlements per player; -1 or less means no limit."
	case "maxSettlersPerSettlement":
		field["description"] = "Limit settlers per settlement; -1 or less means no limit."
	case "zipSaves":
		field["description"] = "Choose ZIP files for new worlds; existing worlds keep their saved format."
	}
}
