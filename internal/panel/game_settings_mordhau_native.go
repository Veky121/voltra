package panel

import (
	"strconv"
	"strings"
	"unicode/utf8"
)

const mordhauLinuxSettingsRecipe = "mordhau/egg-mordhau.json"
const mordhauLinuxSettingsPath = "/Mordhau/Saved/Config/LinuxServer/Game.ini"
const mordhauLinuxSession = "/Script/Mordhau.MordhauGameSession/"
const mordhauLinuxSettingsStartup = `exec env VOLTRA_NATIVE_LD_LIBRARY_PATH="${LD_LIBRARY_PATH}" PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/melee-native.py run mordhau`

// Pure portion of admission only. Root additionally verifies emitted helper
// bytes, config_files, regular confined files and the environment under lock.
func mordhauLinuxSettingsAdmission(recipe, file, serverStartup, eggStartup string, game, query, beacon int, allocated []int) bool {
	if !mordhauLinuxSettingsDocument(recipe, file) || serverStartup != mordhauLinuxSettingsStartup || eggStartup != mordhauLinuxSettingsStartup {
		return false
	}
	available := map[int]bool{}
	for _, p := range allocated {
		if p < 1 || p > 65535 {
			return false
		}
		available[p] = true
	}
	return game != query && game != beacon && query != beacon && available[game] && available[query] && available[beacon]
}

// This is a document identity check, not installed-helper or runtime admission.
// Root must attest launcher, helpers, allocation environment and regular paths.
func mordhauLinuxSettingsDocument(recipe, file string) bool {
	return recipe == mordhauLinuxSettingsRecipe && file == mordhauLinuxSettingsPath
}

// Only the four native fields consumed by mordhau_plan are reviewed here.
// Native MaxSlots is seed-once authority; Engine.GameSession/MaxPlayers is
// deliberately excluded because effective capacity enforcement is unproved.
func mordhauLinuxSetting(key string) (kind string, secret bool) {
	cut := strings.LastIndexByte(key, '/')
	if cut < 0 || !strings.EqualFold(key[:cut+1], mordhauLinuxSession) {
		return "", false
	}
	switch strings.ToLower(key[cut+1:]) {
	case "servername":
		return "text", false
	case "serverpassword", "adminpassword":
		return "text", true
	case "maxslots":
		return "number", false
	}
	return "", false
}

// Reuse the shared INI span editor. Never seed keys or reserialize arrays.
// Apply before structured expansion so unknown structures stay opaque.
func parseMordhauLinuxSettings(file string, data []byte) (gameSettingsParsed, error) {
	if file != mordhauLinuxSettingsPath {
		return gameSettingsParsed{}, bad("Inactive Mordhau configuration.")
	}
	parsed, err := parseGameSettingsLines(file, data)
	if err != nil {
		return parsed, err
	}
	parsed = gameSettingsINICaseSafety(file, data, parsed)
	fields := map[string]gameSetting{}
	for i := range parsed.fields {
		f := &parsed.fields[i]
		kind, secret := mordhauLinuxSetting(f.key)
		f.secret = secret || gameSettingSecret.MatchString(f.key)
		if kind == "" || f.kind == "readonly" {
			f.kind, f.structured = "readonly", false
			if f.secret {
				f.value = ""
			}
		} else {
			f.kind, f.structured = kind, false
		}
		fields[f.key] = *f
	}
	patch := parsed.patch
	parsed.patch = func(changes map[string]string) ([]byte, error) {
		for key, value := range changes {
			f, ok := fields[key]
			if !ok || f.kind == "readonly" {
				return nil, bad("Unknown or unreviewed Mordhau setting.")
			}
			if f.kind == "number" {
				n, e := strconv.Atoi(value)
				if e != nil || n < 1 || n > 60 || value == "" || strings.Trim(value, "0123456789") != "" {
					return nil, bad("MaxSlots must satisfy the original recipe policy of 1 through 60.")
				}
			} else {
				if !utf8.ValidString(value) || utf8.RuneCountInString(value) > 4096 {
					return nil, bad("Invalid Mordhau text value.")
				}
				for _, r := range value {
					if r < 32 || r == 127 {
						return nil, bad("Mordhau text must be a single line without controls.")
					}
				}
			}
		}
		return patch(changes)
	}
	return parsed, nil
}
