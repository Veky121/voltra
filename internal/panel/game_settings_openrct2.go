package panel

import (
	"bytes"
	"crypto/sha256"
	"fmt"
	"strconv"
	"strings"
	"unicode/utf8"
)

const openRCT2SettingsRecipe = "openrct2/egg-openrct2.json"

// Reviewed OpenRCT2 configuration. Only existing native scalars are edited;
// native generation owns defaults. Allocation-managed ports stay read-only.
// Existing fields only. Bounds match configure_openrct2 pure preflight.
var openRCT2SettingKinds = map[string]string{
	"general/autosave": "number", "general/autosave_amount": "number",
	"network/maxplayers": "number", "network/advertise": "boolean",
	"network/pause_server_if_no_clients": "boolean", "network/log_chat": "boolean",
	"network/log_server_actions": "boolean", "network/server_name": "text",
	"network/server_description": "text", "network/server_greeting": "text",
	"network/player_name": "text", "network/provider_name": "text",
	"network/provider_email": "text", "network/provider_website": "text",
}

func openRCT2SettingValue(key, value string) bool {
	kind, ok := openRCT2SettingKinds[key]
	if !ok || !utf8.ValidString(value) || strings.ContainsAny(value, "\r\n\x00\"'\\;#\u0085\u2028\u2029") {
		return false
	}
	for _, c := range value {
		if c < 32 || c == 127 {
			return false
		}
	}
	switch kind {
	case "boolean":
		return value == "true" || value == "false"
	case "number":
		// Representation guard only; no undocumented gameplay maximum or default.
		if value == "" || strings.Trim(value, "0123456789") != "" {
			return false
		}
		n, err := strconv.ParseUint(value, 10, 31)
		bounds := map[string][2]uint64{"general/autosave": {0, 5}, "general/autosave_amount": {0, 10000}, "network/maxplayers": {1, 255}}[key]
		return err == nil && n >= bounds[0] && n <= bounds[1]
	default:
		return len(value) <= 1024
	}
}

func parseOpenRCT2Settings(data []byte) (gameSettingsParsed, error) {
	invalid := func() error { return bad("Invalid or ambiguous OpenRCT2 native settings.") }
	if len(data) > 4*1024*1024 || !utf8.Valid(data) || bytes.ContainsRune(data, 0) {
		return gameSettingsParsed{}, invalid()
	}
	// Refuse duplicate/case-variant sections and keys before the shared INI span
	// parser can choose a value. Unknown rows remain byte-for-byte untouched.
	seen, sections := map[string]bool{}, map[string]bool{}
	section := ""
	for _, line := range strings.Split(string(data), "\n") {
		t := strings.TrimSpace(line)
		if t == "" || strings.HasPrefix(t, ";") || strings.HasPrefix(t, "#") {
			continue
		}
		if strings.HasPrefix(t, "[") {
			if !strings.HasSuffix(t, "]") || strings.Count(t, "[") != 1 || strings.Count(t, "]") != 1 {
				return gameSettingsParsed{}, invalid()
			}
			section = t[1 : len(t)-1]
			low := strings.ToLower(section)
			if sections[low] {
				return gameSettingsParsed{}, invalid()
			}
			sections[low] = true
			continue
		}
		key, _, ok := strings.Cut(t, "=")
		if !ok {
			return gameSettingsParsed{}, invalid()
		}
		full := section + "/" + strings.TrimSpace(key)
		low := strings.ToLower(full)
		if seen[low] {
			return gameSettingsParsed{}, invalid()
		}
		seen[low] = true
		for known := range openRCT2SettingKinds {
			if strings.EqualFold(known, full) && known != full {
				return gameSettingsParsed{}, invalid()
			}
		}
	}
	parsed, err := parseGameSettingsLines(openRCT2SettingsPath, data)
	if err != nil {
		return parsed, err
	}
	fields := []gameSetting{}
	for _, f := range parsed.fields {
		if f.key == "network/default_port" {
			f.kind = "readonly"
			f.structured = false
			fields = append(fields, f)
			continue
		}
		if kind, ok := openRCT2SettingKinds[f.key]; ok {
			if !openRCT2SettingValue(f.key, f.value) {
				return gameSettingsParsed{}, invalid()
			}
			f.kind = kind
			f.structured = false
			f.on = "true"
			f.off = "false"
			fields = append(fields, f)
		}
	}
	originalPatch := parsed.patch
	parsed.fields = fields
	parsed.patch = func(changes map[string]string) ([]byte, error) {
		for key, value := range changes {
			if !seen[strings.ToLower(key)] || !openRCT2SettingValue(key, value) {
				return nil, invalid()
			}
		}
		return originalPatch(changes)
	}
	return parsed, nil
}

const openRCT2SettingsPath = "/ServerData/config.ini"

// Pure selector validation only. Root must obtain these inputs from bounded
// Wings reads after locking and authorization. This does not attest a process.
func validateOpenRCT2SettingsAuthority(recipe, startup, file string, helpers map[string][]byte) error {
	if recipe != "openrct2/egg-openrct2.json" || startup != openRCT2SettingsStartup || file != openRCT2SettingsPath {
		return notFound()
	}
	if len(helpers) != len(openRCT2SettingsPins) {
		return notFound()
	}
	for name, pin := range openRCT2SettingsPins {
		if fmt.Sprintf("%x", sha256.Sum256(helpers[name])) != pin {
			return notFound()
		}
	}
	return nil
}

const openRCT2SettingsStartup = "exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/openrct2-runtime.py"

var openRCT2SettingsPins = map[string]string{
	".voltra/small-native-install.py": "1a1d9ddc0b7d62b16bdc0e368779662825dd2bc35aae2f7dc5ce405fd224fbe3",
	".voltra/small-native-runtime.py": "11fc92b85edc537c02fceee87280329a788062ea929e7d5d4679c2fea759909a",
	".voltra/native-release.py":       "31f274542a9d0b85a7a2cf86ad48b62d9ce8a8549b3e0f631de7b8043e88f193",
	".voltra/native-config.py":        "8c125bb526b38896eeba57143ec2fc70bfb94f1c9783e4c6d652d8f57e3b52a2",
	".voltra/native-console.py":       "e8274872cb9ccbf7c60bca3615aed0d200c66bc28dc54b7fdd3b243070f9f3e5",
	".voltra/bundle-debian-python.py": "16b2ebdcfa2656b591624c9d627defa4c3940be4c8a69d8842778ff25ea0cdc0",
	".voltra/openrct2-runtime.py":     "1af575eb56d5fdcaf1b586ec236b42c2152553ed451a74b74551c150cdd39f91",
	".voltra/steam_template.py":       "7d908cdc739fbb999fdfb13f48f3e8d3a5fdf26fbfa48091dee1442913078897",
}
