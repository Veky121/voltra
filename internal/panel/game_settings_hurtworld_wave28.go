package panel

import (
	"bytes"
	"strconv"
	"strings"
	"unicode/utf8"
)

const hurtworldSettingsRecipe = "hurtworld/egg-hurtworld.json"
const hurtworldSettingsPath = "/hurtworld-startup.cfg"

// Candidate only. Root must bind the exact launcher and document before dispatch.
// This command document is explicitly read by the adapter and passed to -exec;
// no assumption is made that the publisher reads autoexec.cfg.
func parseHurtworldSettings(data []byte) (gameSettingsParsed, error) {
	if len(data) > 65536 || !utf8.Valid(data) || bytes.HasPrefix(data, []byte{239, 187, 191}) {
		return gameSettingsParsed{}, bad("Invalid Hurtworld command document.")
	}
	for _, c := range string(data) {
		if c < 32 && c != '\n' && c != '\r' && c != '\t' || c == 127 || c == '\u0085' || c == '\u2028' || c == '\u2029' {
			return gameSettingsParsed{}, bad("Invalid Hurtworld control character.")
		}
	}
	if bytes.Contains(bytes.ReplaceAll(data, []byte("\r\n"), nil), []byte{'\r'}) {
		return gameSettingsParsed{}, bad("Invalid Hurtworld line ending.")
	}
	kinds := map[string]string{"servername": "text", "maxplayers": "number", "creativemode": "boolean"}
	valid := func(key, value string) bool {
		for _, c := range value {
			if c < 32 || c == 127 || c == '\u0085' || c == '\u2028' || c == '\u2029' {
				return false
			}
		}
		if strings.ContainsAny(value, ";\"\\\r\n\x00") {
			return false
		}
		switch key {
		case "servername":
			return len(value) > 0 && len(value) <= 50 && strings.TrimSpace(value) == value
		case "creativemode":
			return value == "0" || value == "1"
		case "maxplayers":
			n, e := strconv.ParseInt(value, 10, 32)
			return e == nil && n >= 1 && strconv.FormatInt(n, 10) == value
		}
		return false
	}
	return parseNativeConsoleSettings(data, nativeConsoleSettingsSchema{kind: func(k string) string { return kinds[k] }, valid: valid, barrier: func(k string) bool {
		return k == "exec" || k == "alias" || k == "host" || k == "queryport" || k == "bind"
	}})
}
