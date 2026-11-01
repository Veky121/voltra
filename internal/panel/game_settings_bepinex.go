package panel

import (
	"bytes"
	"strings"
)

const bepinexLoggingRecipe = "valheim/valheim_bepinex/egg-valheim-bep-i-nex.json"
const bepinexLoggingPath = "/BepInEx/config/BepInEx.cfg"
const bepinexLoggingKey = "Logging.Disk/Enabled"

// Only an existing native boolean receives edit authority. Loader and plugin
// controls remain untouched, including unknown settings and their exact bytes.
func parseBepinexLoggingSettings(data []byte) (gameSettingsParsed, error) {
	bom := []byte{}
	if bytes.HasPrefix(data, []byte{239, 187, 191}) {
		bom = data[:3]
		data = data[3:]
	}
	parsed, err := parseGameSettingsLines("/BepInEx.ini", data)
	if err != nil {
		return gameSettingsParsed{}, err
	}
	parsed = gameSettingsINICaseSafety("/BepInEx.ini", data, parsed)
	out := gameSettingsParsed{fields: []gameSetting{}}
	aliases := 0
	for _, f := range parsed.fields {
		if strings.EqualFold(f.key, bepinexLoggingKey) {
			aliases++
		}
	}
	if aliases != 1 {
		return out, bad("An unambiguous disk logging key is required.")
	}
	for _, f := range parsed.fields {
		if f.key == bepinexLoggingKey && f.kind == "boolean" && (f.value == "true" || f.value == "false") {
			f.on, f.off = "true", "false"
			out.fields = append(out.fields, f)
		}
	}
	if len(out.fields) != 1 {
		return out, bad("An existing unambiguous disk logging boolean is required.")
	}
	out.patch = func(changes map[string]string) ([]byte, error) {
		for key, value := range changes {
			if key != bepinexLoggingKey || value != "true" && value != "false" {
				return nil, bad("Only disk logging can be changed here.")
			}
		}
		patched, err := parsed.patch(changes)
		if err != nil {
			return nil, err
		}
		return append(bytes.Clone(bom), patched...), nil
	}
	return out, nil
}
