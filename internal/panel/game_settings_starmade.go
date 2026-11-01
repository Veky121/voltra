package panel

import (
	"bytes"
	"errors"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"
)

const starmadeSettingsRecipe = "starmade/egg-starmade.json"
const starmadeSettingsPath = "/server.cfg"

// Schema and parser semantics are from the pinned 0.305.11 publisher JAR.
// The publisher collects every line before applying any values. A malformed
// non-comment line, including a blank line, aborts the entire read.
func parseStarmadeSettings(input []byte) (gameSettingsParsed, error) {
	invalid := func() (gameSettingsParsed, error) {
		return gameSettingsParsed{}, bad("Unsupported StarMade configuration. Keep one KEY = value assignment or // comment per line, without blank lines.")
	}
	if len(input) > 4*1024*1024 || !utf8.Valid(input) || bytes.ContainsRune(input, 0) || bytes.HasPrefix(input, []byte{0xef, 0xbb, 0xbf}) {
		return invalid()
	}
	data := append([]byte(nil), input...)
	type record struct {
		start, end int
		value      string
	}
	records := map[string]record{}
	fields := []gameSetting{}
	offset := 0
	for _, line := range bytes.SplitAfter(data, []byte("\n")) {
		if len(line) == 0 {
			continue
		}
		raw := bytes.TrimSuffix(bytes.TrimSuffix(line, []byte("\n")), []byte("\r"))
		if bytes.ContainsRune(raw, '\r') {
			return invalid()
		}
		text := string(raw)
		if strings.HasPrefix(starmadeTrim(text), "//") {
			offset += len(line)
			continue
		}
		if i := strings.Index(text, "//"); i >= 0 {
			text = text[:i]
		}
		eq := strings.IndexByte(text, '=')
		if eq < 0 {
			return invalid()
		}
		key := starmadeTrim(text[:eq])
		rhs := text[eq+1:]
		low, high := 0, len(rhs)
		for low < high && rhs[low] <= 32 {
			low++
		}
		for high > low && rhs[high-1] <= 32 {
			high--
		}
		value := rhs[low:high]
		kind := "boolean"
		switch key {
		case "MAX_CLIENTS":
			kind = "number"
		case "COLLISION_DAMAGE", "SKIN_ALLOW_UPLOAD", "USE_WHITELIST":
		default:
			offset += len(line)
			continue
		}
		if _, exists := records[key]; exists {
			return invalid()
		}
		normalized := value
		if kind == "number" {
			n, e := strconv.ParseInt(value, 10, 32)
			if e != nil {
				return invalid()
			}
			// IntegerStates.getFromString uses the publisher's declared clamp.
			if n < 1 {
				n = 1
			}
			if n > 1024 {
				n = 1024
			}
			normalized = strconv.FormatInt(n, 10)
		} else if value != "true" && value != "false" {
			return invalid()
		}
		records[key] = record{offset + eq + 1 + low, offset + eq + 1 + high, normalized}
		fields = append(fields, gameSetting{key: key, value: normalized, kind: kind, on: "true", off: "false"})
		offset += len(line)
	}
	out := gameSettingsParsed{fields: fields}
	out.patch = func(changes map[string]string) ([]byte, error) {
		type edit struct {
			start, end int
			value      string
		}
		edits := []edit{}
		for key, value := range changes {
			record, ok := records[key]
			if !ok {
				return nil, bad("This StarMade setting is not editable here.")
			}
			if key == "MAX_CLIENTS" {
				n, e := strconv.Atoi(value)
				if e != nil || n < 1 || n > 1024 || strconv.Itoa(n) != value {
					return nil, bad("Choose a player limit from 1 to 1024.")
				}
			} else if value != "true" && value != "false" {
				return nil, bad("Choose enabled or disabled.")
			}
			if value != record.value {
				edits = append(edits, edit{record.start, record.end, value})
			}
		}
		next := append([]byte(nil), data...)
		sort.Slice(edits, func(i, j int) bool { return edits[i].start > edits[j].start })
		for _, e := range edits {
			next = bytes.Join([][]byte{next[:e.start], []byte(e.value), next[e.end:]}, nil)
		}
		return next, nil
	}
	return out, nil
}

func starmadeTrim(value string) string {
	start, end := 0, len(value)
	for start < end && value[start] <= 32 {
		start++
	}
	for end > start && value[end-1] <= 32 {
		end--
	}
	return value[start:end]
}

func starmadeSettingPresentation(field M) {
	switch str(field["key"]) {
	case "MAX_CLIENTS":
		field["label"], field["description"] = "Player limit", "Maximum number of players who can join."
		field["min"], field["max"] = 1, 1024
	case "COLLISION_DAMAGE":
		field["label"], field["description"] = "Collision damage", "Collisions between objects cause damage."
	case "SKIN_ALLOW_UPLOAD":
		field["label"], field["description"] = "Allow skin uploads", "Players can upload skins to the server."
	case "USE_WHITELIST":
		field["label"], field["description"] = "Require whitelist", "Only listed player names and IP addresses may join."
	}
}

// Pure snapshot authority only. Caller owns confinement, locks and permissions.
func starmadeSettingsAuthority(recipe, eggStartup string, in settingsAuthorityInput) (settingsPathAuthority, error) {
	refuse := errors.New("StarMade settings authority drift or unsupported launcher")
	if recipe != starmadeSettingsRecipe || eggStartup != starmadeSettingsStartup || in.Startup != eggStartup {
		return settingsPathAuthority{}, refuse
	}
	for path, digest := range starmadeSettingsSources {
		b, ok := in.Files[path]
		if !ok || (settingsAuthorityHash(b) != digest && settingsAuthorityHash(append(append([]byte(nil), b...), '\n')) != digest) {
			return settingsPathAuthority{}, refuse
		}
	}
	// The reviewed recipe installs this jar only. Custom jars require independent
	// proof of server.cfg parsing and cwd, even if runtime accepts their paths.
	if jar, ok := in.Env["SERVER_JARFILE"]; ok && jar != "StarMade.jar" {
		return settingsPathAuthority{}, refuse
	}
	for key := range in.Env {
		if strings.EqualFold(key, "SERVER_JARFILE") && key != "SERVER_JARFILE" {
			return settingsPathAuthority{}, refuse
		}
	}
	for key, value := range in.Env {
		for _, controlled := range []string{"VOLTRA_SERVER_ROOT", "HOME", "PYTHONHOME", "LD_LIBRARY_PATH", "JAVA_TOOL_OPTIONS", "JDK_JAVA_OPTIONS", "_JAVA_OPTIONS"} {
			if strings.EqualFold(key, controlled) && (key != controlled || value != "" && !(key == "VOLTRA_SERVER_ROOT" && value == "/home/container")) {
				return settingsPathAuthority{}, refuse
			}
		}
	}
	data, ok := in.Files["server.cfg"]
	if !ok {
		return settingsPathAuthority{}, refuse
	}
	if _, e := parseStarmadeSettings(data); e != nil {
		return settingsPathAuthority{}, e
	}
	return settingsAuthorityResult(starmadeSettingsPath, "starmade-native-v3-publisher-30511:"+recipe+":"+in.Startup+":StarMade.jar"), nil
}

const starmadeSettingsStartup = "exec env VOLTRA_GAME_LD_LIBRARY_PATH=\"$LD_LIBRARY_PATH\" PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/java_games_runtime.py starmade"

var starmadeSettingsSources = map[string]string{
	".voltra/steam_template.py":       "7d908cdc739fbb999fdfb13f48f3e8d3a5fdf26fbfa48091dee1442913078897",
	".voltra/bundle_debian_python.py": "16b2ebdcfa2656b591624c9d627defa4c3940be4c8a69d8842778ff25ea0cdc0",
	".voltra/native_config.py":        "8c125bb526b38896eeba57143ec2fc70bfb94f1c9783e4c6d652d8f57e3b52a2",
	".voltra/native_console.py":       "e8274872cb9ccbf7c60bca3615aed0d200c66bc28dc54b7fdd3b243070f9f3e5",
	".voltra/java_games_runtime.py":   "ab2ae9ad5484cb2cfb2e65c518140328d47a8b7e0ee3b0c15bda206e2c7483a2",
	".voltra/java_games_install.py":   "0882eb3d400ed5d67ceb84c5be2f3be6d86f712c0ad3607871a5a856739d98cf",
}
