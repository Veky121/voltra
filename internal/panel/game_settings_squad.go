package panel

import (
	"bytes"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"
)

const squadSettingsRecipe = "squad/egg-squad.json"
const squadSettingsPath = "/SquadGame/ServerConfig/Server.cfg"

// Only the eight keys already proved by the imported egg and seed-once helper.
// Passwords, ports, admin lists and rotation/config commands remain in Files.
var squadScalarSpecs = map[string]struct{ label, group, kind string }{
	"ServerName":                    {"Server name", "General", "text"},
	"MaxPlayers":                    {"Maximum players", "Players", "number"},
	"NumReservedSlots":              {"Reserved slots", "Players", "number"},
	"AllowTeamChanges":              {"Allow team changes", "Players", "boolean"},
	"ShouldAdvertise":               {"Advertise server", "Privacy", "boolean"},
	"PreventTeamChangeIfUnbalanced": {"Prevent unbalanced team changes", "Players", "boolean"},
	"EnforceTeamBalance":            {"Enforce team balance", "Players", "boolean"},
	"RecordDemos":                   {"Record demos", "General", "boolean"},
}
var squadScalarLine = regexp.MustCompile(`^([ \t]*)([A-Za-z][A-Za-z0-9_]*)([ \t]*=[ \t]*)("[^"\\\r\n]*"|[^ \t"\\/;#={}()]+)([ \t]*)(?://.*)?$`)

func validSquadScalar(key, value string) bool {
	spec, ok := squadScalarSpecs[key]
	if !ok || strings.ContainsAny(value, "\x00\r\n\"\\\u0085\u2028\u2029") || !utf8.ValidString(value) {
		return false
	}
	for _, c := range value {
		if c < 32 || c == 127 {
			return false
		}
	}
	switch spec.kind {
	case "text":
		return strings.TrimSpace(value) != "" && utf8.RuneCountInString(value) <= 80
	case "boolean":
		return value == "true" || value == "false"
	default:
		if value == "" || strings.Trim(value, "0123456789") != "" || len(value) > 3 {
			return false
		}
		n, err := strconv.Atoi(value)
		return err == nil && n <= 100 && (n >= 1 || key == "NumReservedSlots")
	}
}

// No insertion or default seeding. Replacements touch only existing scalar spans.
// Duplicate/case-variant known keys refuse the whole document conservatively.
func parseSquadSettings(data []byte) (gameSettingsParsed, error) {
	out := gameSettingsParsed{fields: []gameSetting{}}
	if len(data) > 8*1024*1024 || !utf8.Valid(data) || bytes.ContainsRune(data, 0) {
		return out, bad("Invalid Squad configuration.")
	}
	type span struct {
		line, start, end int
		quoted           bool
		value            string
	}
	spans := map[string]span{}
	seen := map[string]bool{}
	lines := strings.SplitAfter(string(data), "\n")
	for i, raw := range lines {
		line := strings.TrimSuffix(strings.TrimSuffix(raw, "\n"), "\r")
		offset := 0
		if i == 0 && strings.HasPrefix(line, "\ufeff") {
			line = strings.TrimPrefix(line, "\ufeff")
			offset = 3
		}
		trim := strings.TrimSpace(line)
		if trim == "" || strings.HasPrefix(trim, "//") {
			continue
		}
		name, _, hasEqual := strings.Cut(trim, "=")
		name = strings.TrimSpace(name)
		key := ""
		for k := range squadScalarSpecs {
			if strings.EqualFold(k, name) {
				key = k
				break
			}
		}
		if key == "" {
			continue
		}
		if seen[key] {
			return out, bad("Duplicate Squad scalar; use Files to resolve ambiguity.")
		}
		seen[key] = true
		match := squadScalarLine.FindStringSubmatchIndex(line)
		if !hasEqual || match == nil {
			return out, bad("Unsupported Squad scalar syntax; use Files.")
		}
		start, end := match[8], match[9]
		value := line[start:end]
		quoted := strings.HasPrefix(value, "\"")
		if quoted {
			value = value[1 : len(value)-1]
		}
		if !validSquadScalar(key, value) || key == "ServerName" && !quoted {
			return out, bad("Invalid Squad scalar; use Files.")
		}
		spans[key] = span{i, start + offset, end + offset, quoted, value}
		spec := squadScalarSpecs[key]
		out.fields = append(out.fields, gameSetting{key: key, value: value, kind: spec.kind, on: "true", off: "false"})
	}
	out.patch = func(changes map[string]string) ([]byte, error) {
		values := map[string]string{}
		for k, s := range spans {
			values[k] = s.value
		}
		for k, v := range changes {
			if _, ok := spans[k]; !ok || !validSquadScalar(k, v) {
				return nil, bad("Unsupported Squad scalar change.")
			}
			values[k] = v
		}
		if values["MaxPlayers"] != "" && values["NumReservedSlots"] != "" {
			m, _ := strconv.Atoi(values["MaxPlayers"])
			r, _ := strconv.Atoi(values["NumReservedSlots"])
			if r > m {
				return nil, bad("Reserved slots exceed maximum players.")
			}
		}
		updated := append([]string(nil), lines...)
		for k, v := range changes {
			s := spans[k]
			if v == s.value {
				continue
			}
			if s.quoted {
				v = "\"" + v + "\""
			}
			line := updated[s.line]
			updated[s.line] = line[:s.start] + v + line[s.end:]
		}
		return []byte(strings.Join(updated, "")), nil
	}
	return out, nil
}

// Root calls this only after exact recipe/path and startup authority checks.
func squadSettingPresentation(field M) {
	if spec, ok := squadScalarSpecs[str(field["key"])]; ok {
		field["label"], field["group"] = spec.label, spec.group
	}
}
