package panel

import (
	"bytes"
	"math"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"
)

const astrocolonySettingsRecipe = "astro_colony/egg-astro-colony.json"
const astrocolonySettingsPath = "/AstroColony/Saved/Config/LinuxServer/ServerSettings.ini"

// Publisher dedicated-server guide v1.5 (2026-10-20), configuration section.
// Parse existing CONFIG only: do not synthesize publisher example values as defaults.
const astrocolonySection = "/Script/ACFeature.EHServerSubsystem"

var astrocolonyScalarSpecs = map[string]struct{ label, group, kind string }{
	astrocolonySection + "/ServerPassword":           {"Server password", "General", "text"},
	astrocolonySection + "/Seed":                     {"Map seed", "World", "integer"},
	astrocolonySection + "/MapName":                  {"Map name", "General", "text"},
	astrocolonySection + "/MaxPlayers":               {"Maximum players", "General", "integer"},
	astrocolonySection + "/ShouldLoadLatestSavegame": {"Load latest save", "World", "boolean"},
	astrocolonySection + "/AdminList":                {"Administrator Steam IDs", "Access", "text"},
	astrocolonySection + "/SharedTechnologies":       {"Shared technologies", "Gameplay", "boolean"},
	astrocolonySection + "/OxygenConsumption":        {"Oxygen consumption", "Gameplay", "boolean"},
	astrocolonySection + "/FreeConstruction":         {"Free construction", "Gameplay", "boolean"},
	astrocolonySection + "/AutosaveInterval":         {"Autosave interval (minutes)", "Saves", "number"},
	astrocolonySection + "/AutosavesCount":           {"Autosave count", "Saves", "integer"},
	astrocolonySection + "/Sandbox":                  {"Sandbox", "Gameplay", "boolean"},
	astrocolonySection + "/UnlimitedResourceStack":   {"Unlimited resource stack", "Gameplay", "boolean"},
}

var astrocolonySectionLine = regexp.MustCompile(`^[ \t]*\[([^\]]+)\][ \t]*(?:[;#].*)?$`)
var astrocolonyScalarLine = regexp.MustCompile(`^([ \t]*)([A-Za-z][A-Za-z0-9_]*)([ \t]*=[ \t]*)(.*?)([ \t]*(?:[;#].*)?)$`)

func validAstroColonyScalar(key, value string) bool {
	spec, ok := astrocolonyScalarSpecs[key]
	if !ok || !utf8.ValidString(value) {
		return false
	}
	for _, c := range value {
		if c < 32 || c == 127 || strings.ContainsRune("\"\\;#\u0085\u2028\u2029", c) {
			return false
		}
	}
	if spec.kind == "boolean" {
		return value == "0" || value == "1" || strings.EqualFold(value, "true") || strings.EqualFold(value, "false")
	}
	if spec.kind == "integer" {
		n, err := strconv.ParseInt(value, 10, 32)
		return err == nil && n >= -2147483648
	}
	if spec.kind == "number" {
		n, err := strconv.ParseFloat(value, 32)
		return err == nil && !math.IsNaN(n) && !math.IsInf(n, 0)
	}
	if strings.HasSuffix(key, "/ServerPassword") {
		return utf8.RuneCountInString(value) <= 20
	}
	if strings.HasSuffix(key, "/MapName") {
		return strings.TrimSpace(value) != "" && utf8.RuneCountInString(value) <= 30
	}
	if strings.HasSuffix(key, "/AdminList") {
		return value == "" || regexp.MustCompile(`^[0-9]+(?:,[ ]*[0-9]+)*$`).MatchString(value)
	}
	return false
}

// Requires exact recipe and active startup/config-path authority plus normal API
// admission before dispatch. It never inserts missing fields or interprets INI
// arrays. Every edit replaces one existing value span only.
func parseAstroColonySettings(data []byte) (gameSettingsParsed, error) {
	out := gameSettingsParsed{fields: []gameSetting{}}
	if len(data) > 8*1024*1024 || !utf8.Valid(data) || bytes.ContainsRune(data, 0) {
		return out, bad("Invalid AstroColony settings document.")
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
			m := astrocolonySectionLine.FindStringSubmatch(line)
			if m == nil {
				return out, bad("Ambiguous AstroColony section; use Files.")
			}
			section = m[1]
			for key := range astrocolonyScalarSpecs {
				group := key[:strings.LastIndex(key, "/")]
				if strings.EqualFold(section, group) {
					if sections[strings.ToLower(group)] {
						return out, bad("Duplicate AstroColony section; use Files.")
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
		for candidate := range astrocolonyScalarSpecs {
			if strings.EqualFold(candidate, section+"/"+strings.TrimLeft(name, "+-.!")) && strings.TrimLeft(name, "+-.!") != name {
				return out, bad("AstroColony scalar has array or removal syntax; use Files.")
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
			return out, bad("Duplicate AstroColony setting; use Files.")
		}
		m := astrocolonyScalarLine.FindStringSubmatchIndex(line)
		if !hasEqual || m == nil {
			return out, bad("Unsupported AstroColony setting syntax; use Files.")
		}
		start, end := m[8], m[9]
		value := line[start:end]
		quoted := len(value) >= 2 && strings.HasPrefix(value, "\"") && strings.HasSuffix(value, "\"")
		if quoted {
			value = value[1 : len(value)-1]
		}
		if !validAstroColonyScalar(key, value) {
			return out, bad("Invalid AstroColony scalar; use Files.")
		}
		spans[key] = span{i, start + offset, end + offset, quoted, value}
		spec := astrocolonyScalarSpecs[key]
		out.fields = append(out.fields, gameSetting{key: key, value: value, kind: spec.kind, on: "1", off: "0", secret: strings.HasSuffix(key, "/ServerPassword")})
	}
	out.patch = func(changes map[string]string) ([]byte, error) {
		updated := append([]string(nil), lines...)
		for key, value := range changes {
			s, exists := spans[key]
			if !exists || !validAstroColonyScalar(key, value) {
				return nil, bad("Unsupported AstroColony setting change.")
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

func astrocolonySettingPresentation(field M) {
	if spec, ok := astrocolonyScalarSpecs[str(field["key"])]; ok {
		field["label"], field["group"] = spec.label, spec.group
	}
}
