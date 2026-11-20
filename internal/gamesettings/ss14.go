package gamesettings

import (
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"
)

const Ss14SettingsPath = "/ss14/server_config.toml"
const Ss14SettingsRecipe = "spacestation_14/egg-spacestation14.json"

func ss14SettingsDocument(egg M, file string) bool {
	return file == Ss14SettingsPath && IsRecipe(egg, Ss14SettingsRecipe)
}

// Wrap the existing byte-span TOML editor; never reserialize native contents.
// Root applies listener/listing ownership separately in gameSettingManaged.
func Ss14GameSettingsSafety(egg M, file string, parsed Parsed) Parsed {
	if !ss14SettingsDocument(egg, file) || parsed.Patch == nil {
		return parsed
	}
	patch := parsed.Patch
	wrongType := map[string]bool{}
	for i := range parsed.Fields {
		field := &parsed.Fields[i]
		expected := ""
		switch field.Key {
		case "game/hostname":
			expected = "text"
		case "game/soft_max_players", "net/max_connections", "net/tickrate":
			expected = "number"
		}
		if expected != "" && field.Kind != expected {
			wrongType[field.Key] = true
			field.Kind = "readonly"
		}
	}
	parsed.Patch = func(changes map[string]string) ([]byte, error) {
		for key, value := range changes {
			if wrongType[key] {
				return nil, bad("Repair this setting's native TOML type in Files before editing it here.")
			}
			switch key {
			case "game/hostname":
				if !utf8.ValidString(value) || utf8.RuneCountInString(value) > 48 || strings.IndexFunc(value, unicode.IsControl) >= 0 {
					return nil, bad("Use a server name of at most 48 characters without control characters.")
				}
			case "game/soft_max_players", "net/max_connections", "net/tickrate":
				maximum := 256
				if key == "net/tickrate" {
					maximum = 80
				}
				n, err := strconv.Atoi(value)
				if err != nil || strconv.Itoa(n) != value || n < 1 || n > maximum {
					return nil, bad("Choose a whole number from 1 to " + strconv.Itoa(maximum) + ".")
				}
			}
		}
		return patch(changes)
	}
	return parsed
}
