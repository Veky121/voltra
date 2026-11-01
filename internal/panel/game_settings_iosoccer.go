package panel

import (
	"bytes"
	"math"
	"strconv"
	"strings"
	"unicode/utf8"
)

const iosoccerSettingsRecipe = "iosoccer/eggs-iosoccer.json"
const iosoccerSettingsPath = "/iosoccer/cfg/server.cfg"

// CONFIG editing only. Publisher sdk_gamerules.cpp consumes this float in
// minutes, including a negative warmup sentinel. Do not impose guessed bounds
// or expose mp_timelimit, which historical native evidence found unsupported.
func iosoccerSettingValue(key, value string) bool {
	if key != "mp_timelimit_warmup" || !sourceNumber.MatchString(value) {
		return false
	}
	n, err := strconv.ParseFloat(value, 32)
	return err == nil && !math.IsNaN(n) && !math.IsInf(n, 0)
}

// Root must verify the launcher, helper bytes, path and managed overrides under
// the save lock. This parser makes no claim about arbitrary plugin precedence.
func parseIOSoccerSettings(data []byte) (gameSettingsParsed, error) {
	if len(data) > 8*1024*1024 || !utf8.Valid(data) || bytes.HasPrefix(data, []byte{239, 187, 191}) || strings.ContainsAny(string(data), "\u0085\u2028\u2029") {
		return gameSettingsParsed{}, bad("Unsupported IOSoccer configuration encoding.")
	}
	for _, line := range strings.Split(string(data), "\n") {
		if len(line) > 65536 || strings.Contains(strings.TrimSuffix(line, "\r"), "\r") {
			return gameSettingsParsed{}, bad("Unsupported IOSoccer configuration line.")
		}
	}
	return parseSourceSettingsWithSchema(data, map[string]string{"mp_timelimit_warmup": "number"}, iosoccerSettingValue)
}
