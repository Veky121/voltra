package panel

import (
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"
)

const longvinterSettingsPath = "/longvinter-linux-server/Longvinter/Saved/Config/LinuxServer/Game.ini"
const longvinterGeneral = "/Game/Blueprints/Server/GI_AdvancedSessions.GI_AdvancedSessions_C/"
const longvinterGameplay = "/Game/Blueprints/Server/GM_Longvinter.GM_Longvinter_C/"

var longvinterEOS = regexp.MustCompile(`^[a-z0-9]{32}$`)

// Publisher wiki configuration, retrieved 2026-10-30. No undocumented numeric limits.
var longvinterKinds = map[string]string{
	longvinterGeneral + "ServerName": "text", longvinterGeneral + "ServerMOTD": "text",
	longvinterGeneral + "MaxPlayers": "integer", longvinterGeneral + "Password": "text",
	longvinterGeneral + "CommunityWebsite": "text", longvinterGeneral + "CoopPlay": "boolean",
	longvinterGeneral + "CheckVPN": "boolean", longvinterGeneral + "CoopSpawn": "integer",
	longvinterGeneral + "ChestRespawnTime": "integer", longvinterGeneral + "DisableWanderingTraders": "boolean",
	longvinterGameplay + "AdminSteamID": "text", longvinterGameplay + "PVP": "boolean",
	longvinterGameplay + "TentDecay": "boolean", longvinterGameplay + "MaxTents": "integer",
	longvinterGameplay + "RestartTime24h": "integer", longvinterGameplay + "SaveBackups": "boolean",
}

func validLongvinterSetting(key, value string) bool {
	kind, ok := longvinterKinds[key]
	if !ok || !utf8.ValidString(value) {
		return false
	}
	for _, r := range value {
		if r < 32 || r == 127 || strings.ContainsRune("\"\\;#", r) {
			return false
		}
	}
	if kind == "boolean" {
		return value == "true" || value == "false"
	}
	if kind == "integer" {
		_, e := strconv.ParseInt(value, 10, 32)
		return e == nil
	}
	if strings.HasSuffix(key, "/AdminSteamID") {
		for _, id := range strings.Fields(value) {
			if !longvinterEOS.MatchString(id) {
				return false
			}
		}
	}
	if strings.HasSuffix(key, "/Password") {
		for _, r := range value {
			if !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9') {
				return false
			}
		}
	}
	return true
}
func parseLongvinterSettings(data []byte) (gameSettingsParsed, error) {
	parsed, err := parseGameSettingsLines(longvinterSettingsPath, data)
	if err != nil {
		return parsed, err
	}
	// Unreal identities are case insensitive. Refuse aliases and array operators
	// targeting known scalar identities rather than guessing precedence.
	seen := map[string]bool{}
	for _, f := range parsed.fields {
		for known := range longvinterKinds {
			slash := strings.LastIndex(f.key, "/")
			normalized := f.key
			if slash >= 0 {
				normalized = f.key[:slash+1] + strings.TrimLeft(f.key[slash+1:], "+-.!")
			}
			if strings.EqualFold(normalized, known) {
				folded := strings.ToLower(known)
				if f.key != known || seen[folded] {
					return gameSettingsParsed{}, bad("Ambiguous Longvinter scalar identity.")
				}
				seen[folded] = true
			}
		}
	}
	writable := map[string]bool{}
	for i := range parsed.fields {
		f := &parsed.fields[i]
		kind, ok := longvinterKinds[f.key]
		if !ok || f.kind == "readonly" || f.structured || !validLongvinterSetting(f.key, f.value) {
			f.kind = "readonly"
			continue
		}
		f.kind = kind
		f.secret = strings.HasSuffix(f.key, "/Password")
		if kind == "boolean" {
			f.on = "true"
			f.off = "false"
		}
		writable[f.key] = true
	}
	patch := parsed.patch
	parsed.patch = func(changes map[string]string) ([]byte, error) {
		for k, v := range changes {
			if !writable[k] || !validLongvinterSetting(k, v) {
				return nil, bad("Unsupported Longvinter setting change.")
			}
		}
		return patch(changes)
	}
	return parsed, nil
}

// Root must check the actual server startup at GET and again before PUT.
// Plugin overrides do not alter this decision unless they alter this startup.
func longvinterSettingsAuthority(server, egg M) bool {
	const expected = "exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/longvinter_wave28.py run"
	return str(server["startup"]) == expected && str(egg["startup"]) == expected
}
