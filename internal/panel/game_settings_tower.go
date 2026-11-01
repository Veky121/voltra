package panel

import (
	"bytes"
	"regexp"
	"strings"
	"unicode/utf8"
)

const towerSettingsRecipe = "tower_unite/egg-tower-unite.json"
const towerSettingsPath = "/Tower/Saved/Config/TowerServer.ini"

// Only scalar controls established by the Tower seed-once adapter. Tokens,
// repeated admin IDs, maps, capacity and network allocations stay opaque.
var towerScalarSpecs = map[string]struct{ label, group, kind string }{
	"/Script/TowerNetworking.DedicatedServerOptions/ServerTitle": {"Server title", "General", "text"},
	"DedicatedCondoOptions/CondoAutoSave":                        {"Autosave condo", "Condo", "boolean"},
	"DedicatedCondoOptions/CondoBackupsEnabled":                  {"Back up condo", "Condo", "boolean"},
}

var towerSectionLine = regexp.MustCompile(`^[ \t]*\[([^\]]+)\][ \t]*(?:[;#].*)?$`)
var towerScalarLine = regexp.MustCompile(`^([ \t]*)([A-Za-z][A-Za-z0-9_]*)([ \t]*=[ \t]*)(.*?)([ \t]*)$`)

func validTowerScalar(key, value string) bool {
	spec, ok := towerScalarSpecs[key]
	if !ok || !utf8.ValidString(value) {
		return false
	}
	for _, c := range value {
		if c < 32 || c == 127 || strings.ContainsRune("\"\\;#\u0085\u2028\u2029", c) {
			return false
		}
	}
	if spec.kind == "boolean" {
		return value == "True" || value == "False"
	}
	return strings.TrimSpace(value) != "" && utf8.RuneCountInString(value) <= 512
}

// Requires exact recipe, active startup/config-path authority and stopped-state
// admission before dispatch. It never inserts missing fields or interprets INI
// arrays. Every edit replaces one existing value span only.
func parseTowerSettings(data []byte) (gameSettingsParsed, error) {
	out := gameSettingsParsed{fields: []gameSetting{}}
	if len(data) > 8*1024*1024 || !utf8.Valid(data) || bytes.ContainsRune(data, 0) {
		return out, bad("Invalid Tower settings document.")
	}
	type span struct {
		line, start, end int
		quoted           bool
		value            string
	}
	lines := strings.SplitAfter(string(data), "\n")
	spans := map[string]span{}
	sections := map[string]bool{}
	section := ""
	for i, raw := range lines {
		line := strings.TrimSuffix(strings.TrimSuffix(raw, "\n"), "\r")
		offset := 0
		if i == 0 && strings.HasPrefix(line, "\ufeff") {
			line, offset = strings.TrimPrefix(line, "\ufeff"), 3
		}
		trim := strings.TrimSpace(line)
		if trim == "" || strings.HasPrefix(trim, ";") || strings.HasPrefix(trim, "#") {
			continue
		}
		if strings.HasPrefix(trim, "[") {
			m := towerSectionLine.FindStringSubmatch(line)
			if m == nil {
				return out, bad("Ambiguous Tower section; use Files.")
			}
			section = m[1]
			for key := range towerScalarSpecs {
				group := key[:strings.LastIndex(key, "/")]
				if strings.EqualFold(section, group) {
					if sections[strings.ToLower(group)] {
						return out, bad("Duplicate Tower section; use Files.")
					}
					sections[strings.ToLower(group)] = true
					break
				}
			}
			continue
		}
		name, _, hasEqual := strings.Cut(trim, "=")
		name = strings.TrimSpace(name)
		key := ""
		for candidate := range towerScalarSpecs {
			if strings.EqualFold(candidate, section+"/"+strings.TrimLeft(name, "+-.!")) && strings.TrimLeft(name, "+-.!") != name {
				return out, bad("Tower scalar has array or removal syntax; use Files.")
			}
			if strings.EqualFold(candidate, section+"/"+name) {
				key = candidate
				break
			}
		}
		if key == "" {
			continue
		}
		if _, duplicate := spans[key]; duplicate {
			return out, bad("Duplicate Tower setting; use Files.")
		}
		m := towerScalarLine.FindStringSubmatchIndex(line)
		if !hasEqual || m == nil {
			return out, bad("Unsupported Tower setting syntax; use Files.")
		}
		start, end := m[8], m[9]
		value := line[start:end]
		quoted := len(value) >= 2 && strings.HasPrefix(value, "\"") && strings.HasSuffix(value, "\"")
		if quoted {
			value = value[1 : len(value)-1]
		}
		if !validTowerScalar(key, value) {
			return out, bad("Invalid Tower scalar; use Files.")
		}
		spans[key] = span{i, start + offset, end + offset, quoted, value}
		spec := towerScalarSpecs[key]
		out.fields = append(out.fields, gameSetting{key: key, value: value, kind: spec.kind, on: "True", off: "False"})
	}
	out.patch = func(changes map[string]string) ([]byte, error) {
		updated := append([]string(nil), lines...)
		for key, value := range changes {
			s, exists := spans[key]
			if !exists || !validTowerScalar(key, value) {
				return nil, bad("Unsupported Tower setting change.")
			}
			if value == s.value {
				continue
			}
			if s.quoted {
				value = "\"" + value + "\""
			}
			line := updated[s.line]
			updated[s.line] = line[:s.start] + value + line[s.end:]
		}
		return []byte(strings.Join(updated, "")), nil
	}
	return out, nil
}

func towerSettingPresentation(field M) {
	if spec, ok := towerScalarSpecs[str(field["key"])]; ok {
		field["label"], field["group"] = spec.label, spec.group
	}
}
