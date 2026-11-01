package panel

import (
	"bytes"
	"strings"
	"unicode/utf8"
)

const aapgSettingsRecipe = "americas_army/proving_grounds/egg-america-s-army--proving-grounds.json"
const aapgSettingsPath = "/AAGame/Config/PCServerLinux-AAGame.ini"
const aapgSettingsStartup = "exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/aapg_runtime.py"

func aapgSettingsDocument(egg M, file string) bool {
	return file == aapgSettingsPath && nativeSettingsIsRecipe(egg, aapgSettingsRecipe) && str(egg["startup"]) == aapgSettingsStartup
}

// Defaults and key spellings come from the retained app203300 build8671920
// publisher INI. Only existing scalar rows are editable; never seed over files.
func aapgSettingKinds() map[string]string {
	return map[string]string{
		"Engine.AccessControl/bAuthenticateClients":                       "boolean",
		"Engine.AccessControl/bAuthenticateServer":                        "boolean",
		"Engine.AccessControl/bAuthenticateListenHost":                    "boolean",
		"AAGame.AAGameMultiplayerBase/bPlayAllRounds":                     "boolean",
		"AAGame.AAGameMultiplayerBase/bServerSteamUGCAutoUpdate":          "boolean",
		"AAGame.AAGamePVPBase/bScaleWithNumPlayers":                       "boolean",
		"AAGame.AAGameReplicationInfo/bDefaultOnlyAllowAutoPick":          "boolean",
		"AAGame.AAGameReplicationInfo/bDefaultAllowControllerAimAssist":   "boolean",
		"AAGame.AAGameReplicationInfo/bOnlineVoiceEnabled":                "boolean",
		"AAGame.AAGameReplicationInfo/bDefaultAllowKickPlayerVoting":      "boolean",
		"AAGame.AAGameReplicationInfo/bDefaultAllowChangeMapVoting":       "boolean",
		"AAGame.AAGameReplicationInfo/bDefaultAllowSetNextMapVoting":      "boolean",
		"AAGame.AAGameReplicationInfo/bDefaultAllowRestartMissionVoting":  "boolean",
		"AAGame.AAGameReplicationInfo/bDefaultAllowScrambleTeamsVoting":   "boolean",
		"AAGame.AAGameReplicationInfo/bDefaultAllowAARMapVoting":          "boolean",
		"AAGame.AAGameReplicationInfo/bDefaultHardcoreMode":               "boolean",
		"AAGame.AAGameReplicationInfo/bDefaultAutoBalanceTeams":           "boolean",
		"AAGame.AAGameReplicationInfo/bDefaultReduceFriendlyFire":         "boolean",
		"AAGame.AAGameReplicationInfo/bDefaultROEEnabled":                 "boolean",
		"AAGame.AAGameReplicationInfo/bDefaultAllowBleedOut":              "boolean",
		"AAGame.AAGameReplicationInfo/bDefaultAllowEnemyFireMapDot":       "boolean",
		"AAGame.AAGameReplicationInfo/bDefaultAutoReloadEnabled":          "boolean",
		"AAGame.AAGameReplicationInfo/bDefaultReviveOnHeadshots":          "boolean",
		"AAGame.AAGameReplicationInfo/bDefaultShadowsAllowed":             "boolean",
		"AAGame.AAGameReplicationInfo/bDefaultAnchoringAllowed":           "boolean",
		"AAGame.AAGameReplicationInfo/bHUD_ForceMinimalHUD":               "boolean",
		"AAGame.AAGameReplicationInfo/bDefaultHUD_ForcePlayerCountOff":    "boolean",
		"AAGame.AAGameReplicationInfo/bDefaultHUD_ForceInWorldEnemySpots": "boolean",
		"AAGame.AAGameReplicationInfo/bDefaultHUD_ForceActivityFeedOff":   "boolean",
		"AAGame.AAGameReplicationInfo/bHUD_ForceHitIndicatorOff":          "boolean",
		"AAGame.AAGameReplicationInfo/bAllowAdminSpectate":                "boolean",
		"AAGame.AAGameReplicationInfo/bAllowSpectateMode_ActionCam":       "boolean",
		"AAGame.AAGameReplicationInfo/bAllowSpectateMode_3pOrbit":         "boolean",
		"AAGame.AAGameReplicationInfo/bAllowSpectateMode_FreeCam":         "boolean",
		"AAGame.AAGameReplicationInfo/bDefaultForceSpectateTeamScreenFX":  "boolean",
		"AAGame.AAGameReplicationInfo/bDefaultAllowOccludedMeshSpectate":  "boolean",
		"AAGame.AAGameReplicationInfo/bDefaultUseRoles":                   "boolean",
		"AAGame.AAGameReplicationInfo/bDefaultUseServerSideHitDetection":  "boolean",
		"AAGame.AAGameReplicationInfo/bDefaultAllowGlobalVoiceChat":       "boolean",
		"AAGame.AAGameReplicationInfo/bDefaultAllowSpectatorVoiceChat":    "boolean",
		"AAGame.AAGameReplicationInfo/bDefaultAllowGlobalTextChat":        "boolean",
		"AAGame.AAGameReplicationInfo/bAllowRPGPickup":                    "boolean",
		"AAGame.AAGameReplicationInfo/bEnableAAUDatabaseService":          "boolean",
		"AAGame.AAGameReplicationInfo/bEnableAWSServiceServer":            "boolean",
		"AAGame.AAGameReplicationInfo/bEnableAWSServiceClient":            "boolean",
		"AAGame.AAGameReplicationInfo/bDefaultAllowSpecial":               "boolean",
		"Engine.AccessControl/AdminPassword":                              "text",
		"Engine.AccessControl/GamePassword":                               "text",
	}
}

// Unreal INI treats apostrophes in unquoted strings literally. Do not feed
// the whole document to the generic TOML-like quote scanner. Patch only value
// spans, retaining repeated arrays, structs, unknown rows and all other bytes.
func parseAAPGSettings(data []byte) (gameSettingsParsed, error) {
	out := gameSettingsParsed{fields: []gameSetting{}}
	if len(data) > 8*1024*1024 || !utf8.Valid(data) || bytes.IndexByte(data, 0) >= 0 {
		return out, bad("Invalid AAPG INI encoding or size.")
	}
	bom := ""
	source := string(data)
	if strings.HasPrefix(source, "\ufeff") {
		bom = "\ufeff"
		source = strings.TrimPrefix(source, bom)
	}
	lines := strings.SplitAfter(source, "\n")
	type span struct{ line, start, end int }
	spans := map[string]span{}
	seen := map[string]bool{}
	section := ""
	for i, line := range lines {
		trim := strings.TrimSpace(line)
		if trim == "" || strings.HasPrefix(trim, ";") || strings.HasPrefix(trim, "#") {
			continue
		}
		if strings.HasPrefix(trim, "[") {
			if !strings.HasSuffix(trim, "]") {
				return out, bad("Unsupported AAPG section syntax.")
			}
			section = trim[1 : len(trim)-1]
			continue
		}
		eq := strings.IndexByte(line, '=')
		if eq < 0 {
			return out, bad("Unsupported AAPG INI row.")
		}
		name := strings.TrimSpace(line[:eq])
		identity := strings.ToLower(section + "/" + name)
		// Case variants and array operators on an exposed scalar are ambiguous.
		scalar := strings.ToLower(section + "/" + strings.TrimLeft(name, "+-.!"))
		for key := range aapgSettingKinds() {
			if strings.ToLower(key) != scalar {
				continue
			}
			if seen[identity] || name != strings.TrimLeft(name, "+-.!") {
				return out, bad("Ambiguous AAPG scalar or array override.")
			}
			seen[identity] = true
			start := eq + 1
			for start < len(line) && (line[start] == ' ' || line[start] == '\t') {
				start++
			}
			end := len(strings.TrimRight(line, "\r\n"))
			for end > start && (line[end-1] == ' ' || line[end-1] == '\t') {
				end--
			}
			kind := aapgSettingKinds()[key]
			value := line[start:end]
			if kind == "boolean" && !strings.EqualFold(value, "true") && !strings.EqualFold(value, "false") {
				return out, bad("Unsupported AAPG boolean syntax.")
			}
			spans[key] = span{i, start, end}
			out.fields = append(out.fields, gameSetting{key: key, value: value, kind: kind, on: "true", off: "false", secret: strings.Contains(key, "Password")})
		}
	}
	out.patch = func(changes map[string]string) ([]byte, error) {
		next := append([]string(nil), lines...)
		for key, value := range changes {
			sp, ok := spans[key]
			if !ok {
				return nil, bad("AAPG setting is absent or managed.")
			}
			if aapgSettingKinds()[key] == "boolean" {
				if value != "true" && value != "false" {
					return nil, bad("Enter true or false.")
				}
			} else {
				if strings.TrimSpace(value) != value || strings.ContainsAny(value, "\r\n\x00\";#\\") {
					return nil, bad("Unsupported AAPG credential syntax.")
				}
			}
			line := next[sp.line]
			next[sp.line] = line[:sp.start] + value + line[sp.end:]
		}
		return []byte(bom + strings.Join(next, "")), nil
	}
	return out, nil
}
