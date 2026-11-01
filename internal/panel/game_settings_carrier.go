package panel

import (
	"bytes"
	"encoding/xml"
	"io"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"
)

const carrierSettingsPath = "/server_config.xml"

var carrierRootAttribute = regexp.MustCompile(`\s+([A-Za-z_:][A-Za-z0-9_.:-]*)\s*=\s*("([^"]*)"|'([^']*)')`)
var carrierNumberLimits = map[string][2]int{
	"max_players": {1, 16}, "island_count": {4, 32}, "island_count_per_team": {1, 8},
	"carrier_count_per_team": {1, 4}, "team_count_ai": {0, 4}, "team_count_human": {1, 4},
	"base_difficulty": {0, 2}, "loadout_type": {0, 2}, "blueprints": {0, 1},
}

func carrierSettingKnown(key string) bool {
	_, numeric := carrierNumberLimits[key]
	return numeric || key == "server_name" || key == "password" || key == "save_name"
}

func validCarrierSetting(key, value string) bool {
	if !utf8.ValidString(value) || strings.IndexFunc(value, func(r rune) bool { return r < 32 || r == 127 }) >= 0 {
		return false
	}
	if limits, ok := carrierNumberLimits[key]; ok {
		if value == "" || strings.IndexFunc(value, func(r rune) bool { return r < '0' || r > '9' }) >= 0 {
			return false
		}
		n, err := strconv.Atoi(value)
		return err == nil && n >= limits[0] && n <= limits[1]
	}
	switch key {
	case "server_name":
		return len(value) <= 128
	case "password":
		return len(value) <= 64
	case "save_name":
		return len(value) <= 100 && value != "." && value != ".." && !strings.ContainsAny(value, "/\\:")
	}
	return false
}

// Carrier's native document is a data root with attributes, not the property
// children in serverconfig.xml. Dispatch must use the exact recipe and path.
// Only source-backed match controls are editable; port, permissions, mods,
// game_data_path and unknown data stay opaque and retain their original bytes.
func parseCarrierGameSettings(data []byte) (gameSettingsParsed, error) {
	invalid := func() (gameSettingsParsed, error) {
		return gameSettingsParsed{}, bad("Invalid or unsupported Carrier settings XML.")
	}
	if len(data) > 8*1024*1024 || !utf8.Valid(data) {
		return invalid()
	}
	type span struct {
		start, end int
		value      string
	}
	source := append([]byte(nil), data...)
	base := 0
	if bytes.HasPrefix(source, []byte{0xef, 0xbb, 0xbf}) {
		base = 3
	}
	decoder := xml.NewDecoder(bytes.NewReader(source[base:]))
	spans := map[string]span{}
	out := gameSettingsParsed{fields: []gameSetting{}}
	depth, roots, declarations := 0, 0, 0
	for {
		start := base + int(decoder.InputOffset())
		token, err := decoder.Token()
		end := base + int(decoder.InputOffset())
		if err == io.EOF {
			break
		}
		if err != nil {
			return invalid()
		}
		switch element := token.(type) {
		case xml.Directive:
			return invalid()
		case xml.ProcInst:
			declarations++
			if element.Target != "xml" || roots != 0 || declarations != 1 || start != base {
				return invalid()
			}
		case xml.StartElement:
			depth++
			if depth > 128 {
				return invalid()
			}
			seen := map[xml.Name]bool{}
			for _, attribute := range element.Attr {
				if seen[attribute.Name] {
					return invalid()
				}
				seen[attribute.Name] = true
			}
			if depth != 1 {
				continue
			}
			roots++
			if roots != 1 || element.Name.Space != "" || element.Name.Local != "data" {
				return invalid()
			}
			matches := carrierRootAttribute.FindAllSubmatchIndex(source[start:end], -1)
			if len(matches) != len(element.Attr) {
				return invalid()
			}
			for index, attribute := range element.Attr {
				key := strings.ToLower(attribute.Name.Local)
				if !carrierSettingKnown(key) && key != "port" {
					continue
				}
				if attribute.Name.Space != "" || attribute.Name.Local != key {
					return invalid()
				}
				if key == "port" {
					continue
				}
				if !validCarrierSetting(key, attribute.Value) {
					return invalid()
				}
				match := matches[index]
				lo, hi := match[6], match[7]
				if lo < 0 {
					lo, hi = match[8], match[9]
				}
				value := attribute.Value
				if key == "blueprints" {
					// The runtime accepts decimal numeric forms. Render their real
					// truth value without rewriting a no-op source value such as 01.
					n, _ := strconv.Atoi(value)
					value = strconv.Itoa(n)
				}
				spans[key] = span{start + lo, start + hi, value}
				field := gameSetting{key: key, value: value, kind: "text", secret: key == "password"}
				if _, numeric := carrierNumberLimits[key]; numeric {
					field.kind = "number"
				}
				if key == "blueprints" {
					field.kind, field.on, field.off = "boolean", "1", "0"
				}
				out.fields = append(out.fields, field)
			}
		case xml.EndElement:
			depth--
		case xml.CharData:
			if depth == 0 && strings.TrimSpace(string(element)) != "" {
				return invalid()
			}
		}
	}
	if roots != 1 || depth != 0 {
		return invalid()
	}
	out.patch = func(changes map[string]string) ([]byte, error) {
		keys := make([]string, 0, len(changes))
		for key, value := range changes {
			if _, ok := spans[key]; !ok || !validCarrierSetting(key, value) {
				return nil, bad("Invalid or unsupported Carrier setting.")
			}
			keys = append(keys, key)
		}
		sort.Slice(keys, func(i, j int) bool { return spans[keys[i]].start > spans[keys[j]].start })
		result := append([]byte(nil), source...)
		for _, key := range keys {
			s := spans[key]
			if changes[key] == s.value {
				continue
			}
			var escaped bytes.Buffer
			if err := xml.EscapeText(&escaped, []byte(changes[key])); err != nil {
				return nil, bad("Invalid Carrier setting.")
			}
			next := append([]byte(nil), result[:s.start]...)
			next = append(next, escaped.Bytes()...)
			result = append(next, result[s.end:]...)
		}
		return result, nil
	}
	return out, nil
}

// carrierSettingPresentation supplies reviewed recipe metadata without inventing
// absent native attributes or replacing their values with creation defaults.
func carrierSettingPresentation(egg M, file string, field M) {
	if !nativeSettingsIsRecipe(egg, carrierAuthorityRecipe) || file != carrierSettingsPath {
		return
	}
	key := str(field["key"])
	if limits, ok := carrierNumberLimits[key]; ok {
		field["min"], field["max"] = limits[0], limits[1]
	}
	labels := map[string][]string{"base_difficulty": {"Easy", "Normal", "Hard"}, "loadout_type": {"Default", "Minimal", "Full"}}
	if choices, ok := labels[key]; ok {
		options := []M{}
		for i, label := range choices {
			options = append(options, M{"value": strconv.Itoa(i), "label": label})
		}
		field["type"] = "select"
		field["options"] = options
	}
}
