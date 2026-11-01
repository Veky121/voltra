package panel

import (
	"bytes"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"
)

const assaultCubeSettingsPath = "/assaultcube/config/voltra-options.txt"
const sauerCubeSettingsPath = "/sauerbraten/server-init.cfg"

type cubeSettingSpec struct {
	key, command, label, kind, defaultValue string
	low, high                               int64
}

func cubeSettingSpecs(kind string) []cubeSettingSpec {
	if kind == "assaultcube" {
		return []cubeSettingSpec{
			{"log-game-status", "-l", "Log match status", "boolean", "1", 0, 1},
			{"afk-limit", "-kA", "AFK kick delay in seconds", "number", "45", 0, 2147483},
			{"ban-duration", "-kB", "Temporary ban duration in minutes", "number", "20", 0, 35791},
		}
	}
	if kind == "sauerbraten" {
		return []cubeSettingSpec{
			{"public-server-mode", "publicserver", "Client privilege mode", "number", "0", 0, 2},
			{"restrict-pause", "restrictpausegame", "Only administrators may pause", "boolean", "1", 0, 1},
			{"restrict-game-speed", "restrictgamespeed", "Only administrators may change game speed", "boolean", "1", 0, 1},
		}
	}
	return nil
}

func cubeGameSettingsKind(egg M, file string) string {
	if file == assaultCubeSettingsPath && nativeSettingsIsRecipe(egg, "cubeengine/assaultcube/egg-assault-cube.json") {
		return "assaultcube"
	}
	if file == sauerCubeSettingsPath && nativeSettingsIsRecipe(egg, "cubeengine/cube2/egg-cube2--sauerbraten.json") {
		return "sauerbraten"
	}
	return ""
}

func cubeGameSettingLabel(kind, key string) string {
	for _, spec := range cubeSettingSpecs(kind) {
		if spec.key == key {
			return spec.label
		}
	}
	return ""
}

var cubeSwitchScalar = regexp.MustCompile(`^([ \t]*)(-kA|-kB|-l)([ \t]*)([+-]?[0-9]+)([ \t]*(?://[^\r\n]*)?)(\r?\n)?$`)
var cubeScriptScalar = regexp.MustCompile(`^([ \t]*)(publicserver|restrictpausegame|restrictgamespeed)([ \t]+)(?:"([+-]?[0-9]+)"|([+-]?[0-9]+))([ \t]*(?://[^\r\n]*)?)(\r?\n)?$`)

func cubeSettingNumber(kind string, spec cubeSettingSpec, raw string, existing bool) (string, bool) {
	n, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		return "", false
	}
	// Native numeric arguments use C int/atoi; out-of-range source text is
	// implementation-dependent and must not be presented as an editable value.
	if existing && (n < -2147483648 || n > 2147483647) {
		return "", false
	}
	if existing && kind == "assaultcube" && spec.key == "log-game-status" {
		if n != 0 {
			return "1", true
		}
		return "0", true
	}
	if existing && kind == "assaultcube" && spec.key == "afk-limit" && n < 30 {
		return "0", true
	}
	if n < spec.low || n > spec.high || kind == "assaultcube" && spec.key == "afk-limit" && n != 0 && n < 30 {
		return "", false
	}
	return strconv.FormatInt(n, 10), true
}

// Only a small source-backed scalar surface is editable. These controls are
// not overwritten by startup flags. Unknown executable CFG stays untouched;
// includes/dynamic or ambiguous scripts are read-only, never parsed as INI.
func parseCubeGameSettings(kind string, data []byte) (gameSettingsParsed, error) {
	specs := cubeSettingSpecs(kind)
	if len(specs) == 0 || len(data) > 1024*1024 || !utf8.Valid(data) || bytes.IndexByte(data, 0) >= 0 {
		return gameSettingsParsed{}, bad("Invalid Cube native settings document.")
	}
	type span struct {
		line, start, end int
		value            string
	}
	lines := strings.SplitAfter(string(data), "\n")
	spans, seen, blocked := map[string]span{}, map[string]bool{}, map[string]bool{}
	dynamic, depth := false, 0
	for index, line := range lines {
		prefix := 0
		if index == 0 && strings.HasPrefix(line, "\ufeff") {
			prefix = len("\ufeff")
		}
		text := line[prefix:]
		trim := strings.TrimSpace(text)
		if trim == "" || strings.HasPrefix(trim, "//") {
			continue
		}
		if kind == "assaultcube" {
			if strings.HasPrefix(trim, "-C") || !strings.HasPrefix(trim, "-") {
				dynamic = true
			}
		} else {
			// Publisher map lists are opaque data, not control assignments.
			word := strings.Fields(trim)[0]
			if depth == 0 {
				known := false
				for _, spec := range specs {
					if word == spec.command {
						known = true
					}
				}
				if !known {
					switch word {
					case "maxclients", "serverbotlimit", "serverdesc", "serverpass", "adminpass", "servermotd", "updatemaster", "mastername", "serverip", "serverport", "ffamaps", "capturemaps", "ctfmaps", "spmaprot", "maprotationreset", "maprotation", "teamkillkickreset", "teamkillkick":
					default:
						dynamic = true
					}
				}
			}
			quoted, escaped := false, false
			beforeDepth := depth
			for offset := 0; offset < len(text); offset++ {
				c := text[offset]
				if escaped {
					escaped = false
					continue
				}
				if quoted && c == '^' {
					escaped = true
					continue
				}
				if c == '"' {
					quoted = !quoted
					continue
				}
				if quoted {
					continue
				}
				if c == '/' && offset+1 < len(text) && text[offset+1] == '/' {
					break
				}
				if c == '(' || c == ')' || c == ';' {
					dynamic = true
				}
				if c == '[' {
					depth++
				}
				if c == ']' {
					depth--
					if depth < 0 {
						dynamic = true
						depth = 0
					}
				}
			}
			if quoted {
				dynamic = true
			}
			if beforeDepth > 0 {
				continue
			}
		}
		var spec cubeSettingSpec
		found := false
		for _, candidate := range specs {
			if kind == "assaultcube" && strings.HasPrefix(trim, candidate.command) || kind == "sauerbraten" && (trim == candidate.command || strings.HasPrefix(trim, candidate.command+" ") || strings.HasPrefix(trim, candidate.command+"\t")) {
				spec = candidate
				found = true
				break
			}
		}
		if !found {
			continue
		}
		if seen[spec.key] {
			blocked[spec.key] = true
		}
		seen[spec.key] = true
		pattern := cubeSwitchScalar
		if kind == "sauerbraten" {
			pattern = cubeScriptScalar
		}
		match := pattern.FindStringSubmatchIndex(text)
		if match == nil {
			blocked[spec.key] = true
			continue
		}
		lo, hi := match[8], match[9]
		if lo < 0 {
			lo, hi = match[10], match[11]
		}
		value, ok := cubeSettingNumber(kind, spec, text[lo:hi], true)
		if !ok {
			blocked[spec.key] = true
			continue
		}
		spans[spec.key] = span{index, prefix + lo, prefix + hi, value}
	}
	if depth != 0 {
		dynamic = true
	}
	out := gameSettingsParsed{fields: []gameSetting{}}
	for _, spec := range specs {
		value := spec.defaultValue
		if s, ok := spans[spec.key]; ok {
			value = s.value
		}
		field := gameSetting{key: spec.key, value: value, kind: spec.kind, on: "1", off: "0"}
		if dynamic || blocked[spec.key] {
			field.kind = "readonly"
			field.value = "Use Files for included, dynamic or repeated native controls."
		}
		out.fields = append(out.fields, field)
	}
	out.patch = func(changes map[string]string) ([]byte, error) {
		if dynamic {
			return nil, bad("Included or dynamic Cube configuration must be edited in Files.")
		}
		updated := append([]string(nil), lines...)
		missing := []string{}
		for key, raw := range changes {
			var spec cubeSettingSpec
			found := false
			for _, s := range specs {
				if s.key == key {
					spec = s
					found = true
					break
				}
			}
			if !found || blocked[key] {
				return nil, bad("This native Cube control is not editable.")
			}
			value, ok := cubeSettingNumber(kind, spec, raw, false)
			if !ok {
				return nil, bad("Enter a valid native Cube setting.")
			}
			if s, ok := spans[key]; ok {
				if value != s.value {
					line := updated[s.line]
					updated[s.line] = line[:s.start] + value + line[s.end:]
				}
			} else {
				separator := " "
				if kind == "assaultcube" {
					separator = ""
				}
				missing = append(missing, spec.command+separator+value)
			}
		}
		result := strings.Join(updated, "")
		if len(missing) > 0 {
			newline := "\n"
			if strings.Contains(result, "\r\n") {
				newline = "\r\n"
			}
			if result != "" && !strings.HasSuffix(result, "\n") && !strings.HasSuffix(result, "\r") {
				result += newline
			}
			sort.Strings(missing)
			result += strings.Join(missing, newline) + newline
		}
		return []byte(result), nil
	}
	return out, nil
}
