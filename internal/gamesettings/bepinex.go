package gamesettings

import (
	"bytes"
	"strings"
)

const BepinexLoggingRecipe = "valheim/valheim_bepinex/egg-valheim-bep-i-nex.json"
const BepinexLoggingPath = "/BepInEx/config/BepInEx.cfg"
const BepinexLoggingKey = "Logging.Disk/Enabled"

// Only an existing native boolean receives edit authority. Loader and plugin
// controls remain untouched, including unknown settings and their exact bytes.
func ParseBepinexLoggingSettings(data []byte) (Parsed, error) {
	bom := []byte{}
	if bytes.HasPrefix(data, []byte{239, 187, 191}) {
		bom = data[:3]
		data = data[3:]
	}
	parsed, err := parseGameSettingsLines("/BepInEx.ini", data)
	if err != nil {
		return Parsed{}, err
	}
	parsed = gameSettingsINICaseSafety("/BepInEx.ini", data, parsed)
	out := Parsed{Fields: []Setting{}}
	aliases := 0
	for _, f := range parsed.Fields {
		if strings.EqualFold(f.Key, BepinexLoggingKey) {
			aliases++
		}
	}
	if aliases != 1 {
		return out, bad("An unambiguous disk logging key is required.")
	}
	for _, f := range parsed.Fields {
		if f.Key == BepinexLoggingKey && f.Kind == "boolean" && (f.Value == "true" || f.Value == "false") {
			f.On, f.Off = "true", "false"
			out.Fields = append(out.Fields, f)
		}
	}
	if len(out.Fields) != 1 {
		return out, bad("An existing unambiguous disk logging boolean is required.")
	}
	out.Patch = func(changes map[string]string) ([]byte, error) {
		for key, value := range changes {
			if key != BepinexLoggingKey || value != "true" && value != "false" {
				return nil, bad("Only disk logging can be changed here.")
			}
		}
		patched, err := parsed.Patch(changes)
		if err != nil {
			return nil, err
		}
		return append(bytes.Clone(bom), patched...), nil
	}
	return out, nil
}
