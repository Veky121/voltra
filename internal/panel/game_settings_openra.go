package panel

import (
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"
)

const openraSettingsRecipe = "openra/openra_red_alert/egg-open-r-a.json"

const openraSettingsPath = "/OpenRAData/settings.yaml"

func openraSettingsStartup(egg M) string {
	for recipe, startup := range map[string]string{
		openraSettingsRecipe: "exec python3 .voltra/openra-ra-runtime.py",
		"openra/openra_dune2000/egg-open-r-a--dune2000.json":           "exec python3 .voltra/openra-family.py d2k",
		"openra/openra_tiberian_dawn/egg-open-r-a--tiberian-dawn.json": "exec python3 .voltra/openra-family.py cnc",
	} {
		if nativeSettingsIsRecipe(egg, recipe) {
			return startup
		}
	}
	return ""
}

func openraSettingsDocument(egg M, file string) bool {
	startup := openraSettingsStartup(egg)
	return file == openraSettingsPath && startup != "" && str(egg["startup"]) == startup
}

// OpenRA MiniYaml is not YAML. Only reviewed, existing, flat Server scalar
// fields are exposed. CLI-managed fields, arrays and unknown/nested data remain
// opaque, preserving bytes without returning possible credentials to the API.
var openraNativeKinds = map[string]string{
	"QueryMapRepository": "boolean", "EnableSyncReports": "boolean",
	"EnableLintChecks": "boolean", "EnableVoteKick": "boolean",
	"FloodLimitJoinCooldown": "number", "FloodLimitInterval": "number",
	"FloodLimitMessageCount": "number", "FloodLimitCooldown": "number",
	"VoteKickTimer": "number", "VoteKickerCooldown": "number",
}

var openraMiniKey = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)
var openraMiniInteger = regexp.MustCompile(`^[+-]?[0-9]+$`)

func openraScalarValid(name, value string) bool {
	switch openraNativeKinds[name] {
	case "boolean":
		for i := 0; i < len(value); i++ {
			if value[i] >= 128 {
				return false
			}
		}
		return strings.EqualFold(value, "true") || strings.EqualFold(value, "false")
	case "number":
		_, err := strconv.ParseInt(value, 10, 32)
		return openraMiniInteger.MatchString(value) && err == nil
	}
	return false
}

func parseOpenRAMiniYAMLSettings(data []byte) (gameSettingsParsed, error) {
	out := gameSettingsParsed{fields: []gameSetting{}}
	if len(data) > 8*1024*1024 || !utf8.Valid(data) || strings.ContainsRune(string(data), 0) {
		return out, bad("Invalid native OpenRA MiniYaml document.")
	}
	type span struct{ line, start, end int }
	spans := map[string]span{}
	lines := strings.SplitAfter(string(data), "\n")
	server, foundServer := false, false
	seen := map[string]bool{}
	previous := ""
	previousIndent := -1
	for index, raw := range lines {
		line := strings.TrimRight(raw, "\r\n")
		prefix := 0
		if index == 0 && strings.HasPrefix(line, "\ufeff") {
			prefix = len("\ufeff")
		}
		body := line[prefix:]
		trim := strings.TrimSpace(body)
		if trim == "" || strings.HasPrefix(trim, "#") {
			continue
		}
		indent := len(body) - len(strings.TrimLeft(body, "\t"))
		body = body[indent:]
		if indent > 64 || indent > previousIndent+1 {
			return out, bad("Unsupported native OpenRA MiniYaml nesting.")
		}
		previousIndent = indent
		// Bounded subset: native tab-indented settings only. Do not reinterpret
		// space indentation, inheritance, duplicate merges or block scalars.
		if strings.HasPrefix(body, " ") || strings.ContainsRune(body, '\r') {
			return out, bad("Unsupported native OpenRA MiniYaml layout.")
		}
		// Publisher MiniYaml treats an unescaped # as a comment delimiter.
		// Keep its entire suffix outside the scalar span, including spacing.
		content := body
		for i := 0; i < len(body); i++ {
			if body[i] == '#' && (i == 0 || body[i-1] != '\\') {
				content = body[:i]
				break
			}
		}
		body = content
		colon := strings.IndexByte(body, ':')
		if colon < 1 || !openraMiniKey.MatchString(body[:colon]) {
			return out, bad("Unsupported native OpenRA MiniYaml syntax.")
		}
		name := body[:colon]
		if indent == 0 {
			server, previous = false, ""
			if strings.EqualFold(name, "Server") {
				if foundServer || name != "Server" || strings.TrimSpace(body[colon+1:]) != "" {
					return out, bad("Ambiguous native OpenRA Server section.")
				}
				server, foundServer = true, true
			}
			continue
		}
		if !server {
			continue
		}
		if indent > 1 {
			if openraNativeKinds[previous] != "" {
				return out, bad("Native OpenRA scalar has nested contents.")
			}
			continue
		}
		lower := strings.ToLower(name)
		if seen[lower] {
			return out, bad("Repeated native OpenRA Server setting.")
		}
		seen[lower], previous = true, name
		for known := range openraNativeKinds {
			if strings.EqualFold(known, name) && known != name {
				return out, bad("Ambiguous native OpenRA scalar identity.")
			}
		}
		kind := openraNativeKinds[name]
		if kind == "" {
			continue
		}
		start, end := prefix+indent+colon+1, prefix+indent+len(content)
		for start < end && (line[start] == ' ' || line[start] == '\t') {
			start++
		}
		for end > start && (line[end-1] == ' ' || line[end-1] == '\t') {
			end--
		}
		value := line[start:end]
		if !openraScalarValid(name, value) {
			return out, bad("Invalid native OpenRA scalar value.")
		}
		field := gameSetting{key: "Server." + name, value: value, kind: kind}
		if kind == "boolean" {
			field.on, field.off = "True", "False"
			field.value = "False"
			if strings.EqualFold(value, "true") {
				field.value = "True"
			}
		}
		out.fields = append(out.fields, field)
		spans[field.key] = span{index, start, end}
	}
	out.patch = func(changes map[string]string) ([]byte, error) {
		updated := append([]string(nil), lines...)
		for key, value := range changes {
			position, exists := spans[key]
			name := strings.TrimPrefix(key, "Server.")
			if !exists || !openraScalarValid(name, value) {
				return nil, bad("This native OpenRA scalar cannot be changed here.")
			}
			line := updated[position.line]
			updated[position.line] = line[:position.start] + value + line[position.end:]
		}
		return []byte(strings.Join(updated, "")), nil
	}
	return out, nil
}
