package gamesettings

import (
	"bytes"
	"sort"
	"strconv"
	"strings"
)

const ValheimPlusSettingsRecipe = "valheim/valheim_plus/egg-valheim-plus-mod.json"
const ValheimPlusSettingsPath = "/BepInEx/config/org.bepinex.plugins.valheim_plus.cfg"
const ValheimPlusPluginPath = "/BepInEx/plugins/ValheimPlus.dll"
const valheimPlusPluginSHA = "9f6070177a0c58a2edb598b78a7e444dab533d87855c5ecc476e2be244aaae6b"

var valheimPlusLabels = map[string][2]string{
	"Server/enabled":           {"Server settings", "Apply the server settings in this section."},
	"Server/maxPlayers":        {"Maximum players", "Set how many players can join the server."},
	"Game/enabled":             {"Game settings", "Apply the game settings in this section."},
	"Game/disablePortals":      {"Disable portals", "Prevent players from using portals."},
	"Game/bigPortalNames":      {"Large portal names", "Show portal names in large text in the center of the screen."},
	"Building/enabled":         {"Building settings", "Apply the building settings in this section."},
	"Building/noWeatherDamage": {"Prevent weather damage", "Prevent rain and water erosion from damaging buildings."},
}

// The generated 10.4.0.0 schema supplies this small existing-only allowlist.
// The shared span patcher owns serialization; unknown bytes remain untouched.
func parseValheimPlusSettings(data []byte) (Parsed, error) {
	var bom []byte
	if bytes.HasPrefix(data, []byte{239, 187, 191}) {
		bom = bytes.Clone(data[:3])
		data = data[3:]
	}
	parsed, err := parseGameSettingsLines("/valheim-plus.ini", data)
	if err != nil {
		return Parsed{}, err
	}
	out := Parsed{Fields: []Setting{}}
	allowed := map[string]bool{}
	keys := make([]string, 0, len(valheimPlusLabels))
	for key := range valheimPlusLabels {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		count := 0
		var selected Setting
		for _, f := range parsed.Fields {
			if strings.EqualFold(key, f.Key) {
				count++
				selected = f
			}
		}
		if count > 1 {
			return out, bad("Ambiguous Valheim Plus setting.")
		}
		if count == 0 {
			continue
		}
		if selected.Key != key {
			return out, bad("Noncanonical Valheim Plus setting.")
		}
		if key == "Server/maxPlayers" {
			n, e := strconv.Atoi(selected.Value)
			if e != nil || n < 1 || n > 32 {
				return out, bad("Maximum players must be between 1 and 32.")
			}
			selected.Kind = "number"
		} else {
			if selected.Value != "true" && selected.Value != "false" {
				return out, bad("Valheim Plus requires a boolean value.")
			}
			selected.Kind, selected.On, selected.Off = "boolean", "true", "false"
		}
		allowed[key] = true
		out.Fields = append(out.Fields, selected)
	}
	out.Patch = func(changes map[string]string) ([]byte, error) {
		for key, value := range changes {
			if !allowed[key] {
				return nil, bad("Only reviewed existing Valheim Plus settings can be changed.")
			}
			if key == "Server/maxPlayers" {
				n, e := strconv.Atoi(value)
				if e != nil || n < 1 || n > 32 {
					return nil, bad("Maximum players must be between 1 and 32.")
				}
			} else if value != "true" && value != "false" {
				return nil, bad("Valheim Plus requires a boolean value.")
			}
		}
		b, e := parsed.Patch(changes)
		if e != nil {
			return nil, e
		}
		return append(bytes.Clone(bom), b...), nil
	}
	return out, nil
}
