package panel

import (
	"bytes"
	"strconv"
	"strings"
	"unicode/utf8"
)

const veinSettingsRecipe = "vein/egg-v-e-i-n.json"
const veinSettingsPath = "/Vein/Saved/Config/LinuxServer/Game.ini"
const veinSettingsStartup = "exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/frontier-native.py run vein"

// veinSettingIdentity describes only identities reviewed against vein_configuration.
// A single case alias is supported by that runtime; arrays and aliases together
// are refused. Unknown settings are opaque and never enter the scalar editor.
func veinSettingIdentity(key string) (string, bool) {
	for _, k := range []string{"/Script/Engine.GameSession/MaxPlayers", "/Script/Vein.VeinGameSession/ServerName", "/Script/Vein.VeinGameSession/Password", "/Script/Vein.VeinGameSession/bPublic", "/Script/Vein.VeinGameSession/bShouldAdvertise", "/Script/Vein.VeinGameSession/BindAddr", "OnlineSubsystemSteam/GameServerQueryPort"} {
		if strings.EqualFold(key, k) {
			return k, true
		}
	}
	return "", false
}

func veinSettingManaged(key string) bool {
	k, ok := veinSettingIdentity(key)
	return ok && (strings.HasSuffix(k, "/BindAddr") || strings.HasSuffix(k, "/GameServerQueryPort"))
}

func validVeinSetting(key, value string) bool {
	if !utf8.ValidString(value) || strings.IndexFunc(value, func(r rune) bool { return r < 32 || r == 127 }) >= 0 {
		return false
	}
	switch key[strings.LastIndexByte(key, '/')+1:] {
	case "ServerName":
		return utf8.RuneCountInString(value) <= 64
	case "Password":
		return utf8.RuneCountInString(value) <= 32
	case "MaxPlayers":
		if value == "" || strings.IndexFunc(value, func(r rune) bool { return r < '0' || r > '9' }) >= 0 {
			return false
		}
		n, e := strconv.ParseUint(value, 10, 32)
		return e == nil && n >= 1 && n <= 10000
	case "bPublic", "bShouldAdvertise":
		v := strings.ToLower(value)
		return v == "true" || v == "false" || v == "0" || v == "1"
	}
	return false
}

// parseVeinSettings is pure and grants no file authority. Root must bind the
// exact recipe/startup/emitted modules and confined active file before calling.
// Existing scalars only: no seeding, environment writes or port reconciliation.
func parseVeinSettings(data []byte) (gameSettingsParsed, error) {
	if len(data) > 8*1024*1024 || !utf8.Valid(data) {
		return gameSettingsParsed{}, bad("Invalid VEIN configuration.")
	}
	bom := []byte{0xef, 0xbb, 0xbf}
	body := bytes.TrimPrefix(data, bom)
	p, err := parseGameSettingsLines(veinSettingsPath, body)
	if err != nil {
		return p, err
	}
	p = gameSettingsINICaseSafety(veinSettingsPath, body, p)
	fields := []gameSetting{}
	allowed := map[string]string{}
	seen := map[string]bool{}
	for _, f := range p.fields {
		candidate := f.key
		cut := strings.LastIndexByte(candidate, '/')
		name := candidate[cut+1:]
		if strings.HasPrefix(name, "+") || strings.HasPrefix(name, "-") || strings.HasPrefix(name, "!") || strings.HasPrefix(name, ".") {
			candidate = candidate[:cut+1] + name[1:]
		}
		canonical, known := veinSettingIdentity(candidate)
		if !known {
			continue
		}
		if candidate != f.key || f.kind == "readonly" || seen[canonical] {
			return gameSettingsParsed{}, bad("Ambiguous VEIN scalar identity.")
		}
		seen[canonical] = true
		f.structured = false
		if veinSettingManaged(f.key) {
			f.kind = "readonly"
		} else {
			if !validVeinSetting(canonical, f.value) {
				return gameSettingsParsed{}, bad("Invalid VEIN scalar.")
			}
			allowed[f.key] = canonical
			f.kind = "text"
			if strings.HasSuffix(canonical, "/MaxPlayers") {
				f.kind = "number"
			}
			if strings.HasSuffix(canonical, "/bPublic") || strings.HasSuffix(canonical, "/bShouldAdvertise") {
				f.kind = "boolean"
				f.on = "True"
				f.off = "False"
				if strings.EqualFold(f.value, "true") || f.value == "1" {
					f.value = "True"
				} else {
					f.value = "False"
				}
			}
		}
		f.secret = strings.HasSuffix(canonical, "/Password")
		fields = append(fields, f)
	}
	patch := p.patch
	p.fields = fields
	p.patch = func(changes map[string]string) ([]byte, error) {
		for k, v := range changes {
			canonical, ok := allowed[k]
			if !ok || !validVeinSetting(canonical, v) {
				return nil, bad("Unsupported VEIN change.")
			}
		}
		result, e := patch(changes)
		if e != nil {
			return nil, e
		}
		if len(body) != len(data) {
			result = append(bytes.Clone(bom), result...)
		}
		return result, nil
	}
	return p, nil
}
