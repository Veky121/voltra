package panel

import (
	"bytes"
	"math"
	"strconv"
	"strings"
	"unicode/utf8"
)

const tf2SettingsRecipe = "team_fortress_2/egg-team-fortress-2.json"

const tf2SettingsPath = "/tf/cfg/server.cfg"

// Deliberately limited to the scalar already observed in tf2-live-acceptance.
// Valve source-sdk-2013 multiplay_gamerules.cpp defines minutes, float access,
// and negative-value normalization. No publisher maximum or default is imposed.
func tf2SettingValue(key, value string) bool {
	if key != "mp_timelimit" || !sourceNumber.MatchString(value) {
		return false
	}
	n, err := strconv.ParseFloat(value, 32)
	return err == nil && !math.IsInf(n, 0) && !math.IsNaN(n) && n >= 0
}

// This parses file bytes only. Root must establish effective startup/path
// authority before dispatch, and repeat that check after acquiring the save lock.
func parseTF2Settings(data []byte) (gameSettingsParsed, error) {
	if len(data) > 8*1024*1024 || !utf8.Valid(data) || bytes.HasPrefix(data, []byte{0xef, 0xbb, 0xbf}) {
		return gameSettingsParsed{}, bad("Invalid TF2 settings document.")
	}
	out, err := parseSourceSettingsWithSchema(data, map[string]string{"mp_timelimit": "number"}, tf2SettingValue)
	if err != nil {
		return out, err
	}
	unsafe := false
	for _, raw := range strings.Split(string(data), "\n") {
		line := strings.TrimSuffix(raw, "\r")
		if len(line) > 65536 || strings.ContainsAny(line, "\r\u0085\u2028\u2029") {
			return gameSettingsParsed{}, bad("Unsupported TF2 settings line.")
		}
		trim := strings.TrimSpace(line)
		if trim == "" || strings.HasPrefix(trim, "//") {
			continue
		}
		// Every other executable statement may change precedence or the command
		// namespace. Preserve it, but require the native editor for such documents.
		m := sourceCvarLine.FindStringSubmatch(line)
		if m == nil {
			unsafe = true
			continue
		}
		switch strings.ToLower(m[2]) {
		case "mp_timelimit", "hostname", "sv_password", "rcon_password", "sv_lan", "tv_enable", "tv_port":
		default:
			unsafe = true
		}
	}
	if unsafe {
		for i := range out.fields {
			out.fields[i].kind = "readonly"
		}
		out.patch = func(changes map[string]string) ([]byte, error) {
			if len(changes) > 0 {
				return nil, bad("TF2 executable or unreviewed configuration requires the native file editor.")
			}
			return append([]byte(nil), data...), nil
		}
	}
	return out, nil
}
