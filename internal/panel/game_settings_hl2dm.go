package panel

import (
	"bytes"
	"math"
	"math/big"
	"strconv"
	"strings"
	"unicode/utf8"
)

const hl2dmSettingsPath = "/hl2mp/cfg/voltra-gameplay.cfg"
const hl2dmSettingsRecipe = "half_life_2_deathmatch/egg-half--life2--deathmatch.json"
const hl2dmSettingsStartup = "exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/hl2dm_runtime.py"

func hl2dmSettingsDocument(egg M, file string) bool {
	return file == hl2dmSettingsPath && nativeSettingsIsRecipe(egg, hl2dmSettingsRecipe) && str(egg["startup"]) == hl2dmSettingsStartup
}

// Actual app232370 build24600426 help/cvar output establishes these names and
// native spellings. Only mp_chattime advertises native min/max bounds. Other
// numeric limits below are representation guards, not publisher gameplay limits.
func hl2dmSettingKinds() map[string]string {
	return map[string]string{
		"mp_timelimit": "number", "mp_fraglimit": "number",
		"mp_teamplay": "boolean", "mp_weaponstay": "boolean",
		"mp_friendlyfire": "boolean", "mp_flashlight": "boolean",
		"mp_forcerespawn": "boolean", "sv_alltalk": "boolean",
		"sv_voiceenable": "boolean", "sv_gravity": "number",
		"mp_chattime": "number", "sv_hl2mp_weapon_respawn_time": "number",
		"sv_hl2mp_item_respawn_time": "number",
	}
}

func hl2dmSettingValue(key, value string) bool {
	kind, known := hl2dmSettingKinds()[key]
	if !known || len(value) > 32 || !sourceNumber.MatchString(value) {
		return false
	}
	if kind == "boolean" {
		return value == "0" || value == "1"
	}
	exact, ok := new(big.Rat).SetString(value)
	ceiling, _ := new(big.Rat).SetString("340282340000000000000000000000000000000")
	if !ok || exact.Sign() < 0 || exact.Cmp(ceiling) > 0 {
		return false
	}
	if key == "mp_chattime" && (exact.Cmp(big.NewRat(1, 1)) < 0 || exact.Cmp(big.NewRat(120, 1)) > 0) {
		return false
	}
	// Source's time callback inspects GetInt; kill counters also use integers.
	// The largest float32 strictly below 2^31 avoids a float-rounded int overflow.
	// This is a conservative conversion guard, not a claimed native cvar clamp.
	if (key == "mp_timelimit" || key == "mp_fraglimit") && exact.Cmp(big.NewRat(2147483520, 1)) > 0 || key == "mp_fraglimit" && !exact.IsInt() {
		return false
	}
	n, err := strconv.ParseFloat(value, 64)
	if err != nil || math.IsNaN(n) || math.IsInf(n, 0) {
		return false
	}
	f := float32(n)
	return !math.IsInf(float64(f), 0) && (n == 0 || f != 0)
}

func parseHL2DMSettings(data []byte) (gameSettingsParsed, error) {
	if len(data) > 65536 || !utf8.Valid(data) || bytes.HasPrefix(data, []byte{0xef, 0xbb, 0xbf}) {
		return gameSettingsParsed{}, bad("Invalid or oversized HL2DM gameplay document.")
	}
	if bytes.Contains(bytes.ReplaceAll(data, []byte("\r\n"), nil), []byte{'\r'}) {
		return gameSettingsParsed{}, bad("Unsupported HL2DM line separator.")
	}
	text := string(data)
	for _, c := range text {
		if c < 32 && c != '\t' && c != '\r' && c != '\n' || c == 127 || c == '\u0085' || c == '\u2028' || c == '\u2029' {
			return gameSettingsParsed{}, bad("Unsupported HL2DM control character.")
		}
	}
	out, err := parseSourceSettingsWithSchema(data, hl2dmSettingKinds(), hl2dmSettingValue)
	if err != nil {
		return out, err
	}
	unsafe := false
	seen := map[string]bool{}
	for _, raw := range strings.Split(text, "\n") {
		line := strings.TrimSuffix(raw, "\r")
		trim := strings.Trim(line, " \t")
		if trim == "" || strings.HasPrefix(trim, "//") {
			continue
		}
		parts := sourceCvarLine.FindStringSubmatch(line)
		if parts == nil {
			unsafe = true
			continue
		}
		key, value := strings.ToLower(parts[2]), strings.Trim(parts[4], "\"")
		if seen[key] || !hl2dmSettingValue(key, value) {
			unsafe = true
		}
		seen[key] = true
	}
	if unsafe {
		for i := range out.fields {
			out.fields[i].kind = "readonly"
		}
		out.patch = func(changes map[string]string) ([]byte, error) {
			if len(changes) != 0 {
				return nil, bad("This HL2DM document contains unknown, repeated or unsupported commands; review it in Files.")
			}
			return bytes.Clone(data), nil
		}
	}
	return out, nil
}

// Existing shared labels/controls suffice; no game-specific frontend is needed.
func hl2dmSettingPresentation(egg M, file string, field M) {
	if !hl2dmSettingsDocument(egg, file) {
		return
	}
	labels := map[string]string{
		"mp_timelimit": "Map time limit (minutes)", "mp_fraglimit": "Kill limit",
		"mp_teamplay": "Team play", "mp_weaponstay": "Keep picked-up weapons available",
		"mp_friendlyfire": "Friendly fire", "mp_flashlight": "Allow flashlights",
		"mp_forcerespawn": "Automatic respawn", "sv_alltalk": "Voice chat across teams",
		"sv_voiceenable": "Enable voice chat", "sv_gravity": "World gravity",
		"mp_chattime":                  "Postgame chat duration (seconds)",
		"sv_hl2mp_weapon_respawn_time": "Weapon respawn duration",
		"sv_hl2mp_item_respawn_time":   "Item respawn duration",
	}
	key, _ := field["key"].(string)
	if label, ok := labels[key]; ok {
		field["label"] = label
	}
	if field["type"] == "number" && field["readonly"] != true && field["secret"] != true {
		field["min"] = 0
		if key == "mp_chattime" {
			field["min"], field["max"] = 1, 120
		}
		if key == "mp_timelimit" || key == "mp_fraglimit" {
			field["max"] = 2147483520
		}
	}
}
