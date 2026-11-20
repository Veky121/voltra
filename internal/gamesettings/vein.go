package gamesettings

import (
	"bytes"
	"strconv"
	"strings"
	"unicode/utf8"
)

const VeinSettingsRecipe = "vein/egg-v-e-i-n.json"
const VeinSettingsPath = "/Vein/Saved/Config/LinuxServer/Game.ini"
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
func parseVeinSettings(data []byte) (Parsed, error) {
	if len(data) > 8*1024*1024 || !utf8.Valid(data) {
		return Parsed{}, bad("Invalid VEIN configuration.")
	}
	bom := []byte{0xef, 0xbb, 0xbf}
	body := bytes.TrimPrefix(data, bom)
	p, err := parseGameSettingsLines(VeinSettingsPath, body)
	if err != nil {
		return p, err
	}
	p = gameSettingsINICaseSafety(VeinSettingsPath, body, p)
	fields := []Setting{}
	allowed := map[string]string{}
	seen := map[string]bool{}
	for _, f := range p.Fields {
		candidate := f.Key
		cut := strings.LastIndexByte(candidate, '/')
		name := candidate[cut+1:]
		if strings.HasPrefix(name, "+") || strings.HasPrefix(name, "-") || strings.HasPrefix(name, "!") || strings.HasPrefix(name, ".") {
			candidate = candidate[:cut+1] + name[1:]
		}
		canonical, known := veinSettingIdentity(candidate)
		if !known {
			continue
		}
		if candidate != f.Key || f.Kind == "readonly" || seen[canonical] {
			return Parsed{}, bad("Ambiguous VEIN scalar identity.")
		}
		seen[canonical] = true
		f.structured = false
		if veinSettingManaged(f.Key) {
			f.Kind = "readonly"
		} else {
			if !validVeinSetting(canonical, f.Value) {
				return Parsed{}, bad("Invalid VEIN scalar.")
			}
			allowed[f.Key] = canonical
			f.Kind = "text"
			if strings.HasSuffix(canonical, "/MaxPlayers") {
				f.Kind = "number"
			}
			if strings.HasSuffix(canonical, "/bPublic") || strings.HasSuffix(canonical, "/bShouldAdvertise") {
				f.Kind = "boolean"
				f.On = "True"
				f.Off = "False"
				if strings.EqualFold(f.Value, "true") || f.Value == "1" {
					f.Value = "True"
				} else {
					f.Value = "False"
				}
			}
		}
		f.Secret = strings.HasSuffix(canonical, "/Password")
		fields = append(fields, f)
	}
	patch := p.Patch
	p.Fields = fields
	p.Patch = func(changes map[string]string) ([]byte, error) {
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
