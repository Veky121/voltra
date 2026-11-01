package panel

import (
	"bytes"
	"encoding/json"
	"strconv"
	"unicode/utf8"
)

const coreKeeperSettingsRecipe = "core_keeper/egg-core-keeper.json"
const coreKeeperSettingsPath = "/CoreKeeperSaves/ServerConfig.json"

// Only the independently observed live player cap is editable. World generation,
// credentials, transport and unknown engine properties are deliberately withheld.
func parseCoreKeeperSettings(data []byte) (gameSettingsParsed, error) {
	invalid := func() (gameSettingsParsed, error) { return gameSettingsParsed{}, bad("Invalid Core Keeper settings.") }
	if len(data) > 1024*1024 || !utf8.Valid(data) || !json.Valid(data) {
		return invalid()
	}
	spans, err := bananaJSONSpans(data)
	if err != nil {
		return invalid()
	}
	root, ok := spans[""]
	if !ok || !root.object {
		return invalid()
	}
	span, ok := spans["/maxNumberPlayers"]
	if !ok {
		return invalid()
	}
	value := string(data[span.start:span.end])
	n, err := strconv.Atoi(value)
	if err != nil || n < 1 || n > 100 || strconv.Itoa(n) != value {
		return invalid()
	}
	out := gameSettingsParsed{fields: []gameSetting{{key: "/maxNumberPlayers", value: value, kind: "number"}}}
	out.patch = func(changes map[string]string) ([]byte, error) {
		next := append([]byte(nil), data...)
		for key, value := range changes {
			n, err := strconv.Atoi(value)
			if key != "/maxNumberPlayers" || err != nil || n < 1 || n > 100 || strconv.Itoa(n) != value {
				return nil, bad("Invalid Core Keeper player limit.")
			}
			next = bytes.Join([][]byte{data[:span.start], []byte(value), data[span.end:]}, nil)
		}
		return next, nil
	}
	return out, nil
}

func coreKeeperSettingPresentation(field M) {
	if str(field["key"]) == "/maxNumberPlayers" {
		field["label"], field["description"] = "Player limit", "Maximum number of players who can join."
		field["min"], field["max"] = 1, 100
	}
}
