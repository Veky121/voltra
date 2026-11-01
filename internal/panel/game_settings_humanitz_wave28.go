package panel

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"math"
	"strconv"
	"strings"
	"unicode/utf8"
)

// Existing accepted recipe schema; omitted legacy controls have unproved native consumption.
func parseHumanitzSettings(data []byte) (gameSettingsParsed, error) {
	out := gameSettingsParsed{}
	invalid := func() error { return fmt.Errorf("Unsupported or ambiguous HumanitZ configuration") }
	if len(data) > 8*1024*1024 || !utf8.Valid(data) || bytes.ContainsRune(data, 0) {
		return out, invalid()
	}
	schema := map[string]string{"Host Settings/ServerName": "text", "Host Settings/NoDeathFeedback": "boolean", "Host Settings/Password": "text",
		"Host Settings/AdminPass":            "text",
		"Host Settings/MaxPlayers":           "number",
		"World Settings/SaveIntervalSec":     "number",
		"World Settings/NoDeathFeedback":     "boolean",
		"World Settings/PermaDeath":          "number",
		"World Settings/OnDeath":             "number",
		"World Settings/PVP":                 "boolean",
		"World Settings/AirDrop":             "boolean",
		"World Settings/WeaponBreak":         "boolean",
		"World Settings/MultiplayerSleep":    "boolean",
		"World Settings/LootRespawn":         "boolean",
		"World Settings/LootRespawnTimer":    "number",
		"World Settings/PickupRespawnTimer":  "number",
		"World Settings/AirDropInterval":     "number",
		"World Settings/ZombieDiffHealth":    "number",
		"World Settings/ZombieDiffSpeed":     "number",
		"World Settings/ZombieDiffDamage":    "number",
		"World Settings/ZombieAmountMulti":   "number",
		"World Settings/HumanAmountMulti":    "number",
		"World Settings/ZombieDogMulti":      "number",
		"World Settings/ZombieRespawnTimer":  "number",
		"World Settings/HumanRespawnTimer":   "number",
		"World Settings/AnimalRespawnTimer":  "number",
		"World Settings/StartingSeason":      "number",
		"World Settings/DaysPerSeason":       "number",
		"World Settings/DayDur":              "number",
		"World Settings/NightDur":            "number",
		"World Settings/VitalDrain":          "number",
		"World Settings/DogEnabled":          "boolean",
		"World Settings/DogNum":              "number",
		"World Settings/RecruitDog":          "boolean",
		"World Settings/BuildingHealth":      "number",
		"World Settings/CompanionHealth":     "number",
		"World Settings/CompanionDmg":        "number",
		"World Settings/AllowDismantle":      "boolean",
		"World Settings/AllowHouseDismantle": "boolean",
		"World Settings/Territory":           "boolean",
		"World Settings/Decay":               "number",
		"World Settings/PickupCleanup":       "number",
		"World Settings/FakeBuildingCleanup": "number"}
	lines := strings.SplitAfter(strings.TrimPrefix(string(data), "\ufeff"), "\n")
	type span struct{ i, start, end int }
	spans := map[string]span{}
	section := ""
	seen := map[string]bool{}
	valid := func(kind, value string) bool {
		if strings.ContainsAny(value, "\r\n\x00;#[]\"") || strings.TrimSpace(value) != value {
			return false
		}
		if kind == "boolean" {
			return value == "0" || value == "1"
		}
		if kind == "number" {
			n, e := strconv.ParseFloat(value, 64)
			return e == nil && !math.IsNaN(n) && !math.IsInf(n, 0)
		}
		return true
	}
	for i, line := range lines {
		t := strings.TrimSpace(line)
		if t == "" || strings.HasPrefix(t, ";") || strings.HasPrefix(t, "#") {
			continue
		}
		if strings.HasPrefix(t, "[") {
			if !strings.HasSuffix(t, "]") {
				return out, invalid()
			}
			section = t[1 : len(t)-1]
			if seen[strings.ToLower(section)] {
				return out, invalid()
			}
			seen[strings.ToLower(section)] = true
			continue
		}
		eq := strings.IndexByte(line, '=')
		if eq < 0 {
			return out, invalid()
		}
		key := strings.TrimSpace(line[:eq])
		full := section + "/" + key
		for known := range schema {
			if strings.EqualFold(known, section+"/"+strings.TrimLeft(key, "+-.!")) && known != full {
				return out, invalid()
			}
		}
		kind, ok := schema[full]
		if !ok {
			continue
		}
		if _, ok := spans[full]; ok {
			return out, invalid()
		}
		start := eq + 1
		for start < len(line) && (line[start] == ' ' || line[start] == '\t') {
			start++
		}
		end := len(strings.TrimRight(line, " \t\r\n"))
		if end < start {
			end = start
		}
		v := line[start:end]
		if !valid(kind, v) {
			return out, invalid()
		}
		spans[full] = span{i, start, end}
		out.fields = append(out.fields, gameSetting{key: full, value: v, kind: kind, on: "1", off: "0", secret: key == "Password" || key == "AdminPass"})
	}
	out.patch = func(changes map[string]string) ([]byte, error) {
		next := append([]string(nil), lines...)
		for k, v := range changes {
			s, ok := spans[k]
			if !ok || !valid(schema[k], v) {
				return nil, invalid()
			}
			next[s.i] = next[s.i][:s.start] + v + next[s.i][s.end:]
		}
		result := strings.Join(next, "")
		if bytes.HasPrefix(data, []byte{239, 187, 191}) {
			result = "\ufeff" + result
		}
		return []byte(result), nil
	}
	return out, nil
}

// Call after regular-file/no-symlink reads and shared permission, stopped-state and revision checks.
func humanitzWave28Authority(recipe, startup string, mappings int, files map[string][]byte) bool {
	if recipe != "humanitz/egg-humanit-z.json" || startup != "exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/humanitz_wave28_runtime.py" || mappings != 0 {
		return false
	}
	pins := map[string]string{"/.voltra/steam_template.py": "dc8ff0a9e462751878aad55da80bea8fd2a2d4ef16dbf8d37b798ea8d4c476dd", "/.voltra/bundle_debian_python.py": "16b2ebdcfa2656b591624c9d627defa4c3940be4c8a69d8842778ff25ea0cdc0", "/.voltra/native_config.py": "8c125bb526b38896eeba57143ec2fc70bfb94f1c9783e4c6d652d8f57e3b52a2", "/.voltra/native_console.py": "e8274872cb9ccbf7c60bca3615aed0d200c66bc28dc54b7fdd3b243070f9f3e5", "/.voltra/enshrouded_proton.py": "f11b447fc817b600fbf55c5608434a92d301e5746e60346686479452516240f9", "/.voltra/unreal_survival_install.py": "aa9073fd79c2578a1785c40bbf6d0675253e87c6ca288e5ba11dafa41f7835b9", "/.voltra/unreal_survival_runtime.py": "64ed21034a5e8406567d79d13a3a2d368e3750ad6e4f463e5a675c0317700050", "/.voltra/unreal_survival_release.json": "796dcf63221a71f7de2c047dbe40eb26ceaeff89d8cc3747db73583a7406870a", "/.voltra/humanitz_wave28_runtime.py": "55c236fed7bb2cb48f41e9020e22235f2d5b8420f3919bdb63d9b64621153947"}
	for name, pin := range pins {
		b, ok := files[name]
		if !ok {
			return false
		}
		sum := sha256.Sum256(b)
		if hex.EncodeToString(sum[:]) != pin {
			return false
		}
	}
	_, modern := files["/HumanitZServer/GameServerSettings.ini"]
	_, legacy := files["/TSSGame/GameServerSettings.ini"]
	return modern != legacy
}
