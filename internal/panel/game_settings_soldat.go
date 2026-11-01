package panel

import (
	"strconv"
	"strings"
	"unicode/utf8"
)

// Soldat classic 1.7.1/2.8.2 uses integer bits in its native INI files.
// These exact names are documented by the publisher-hosted Soldat wiki.
func soldatNativeBit(file, key string) bool {
	key = strings.ToLower(key)
	switch file {
	case "/soldat.ini":
		return map[string]bool{
			"network/lobby_register": true,
			"game/friendly_fire":     true, "game/guns_collide": true, "game/kits_collide": true,
			"game/realistic_mode": true, "game/survival_mode": true, "game/advance_mode": true,
		}[key]
	case "/server.ini":
		return map[string]bool{
			"game/punishtk": true, "game/echokills": true, "game/botbalanceteams": true,
			"game/timestampconsole": true, "game/autorecord": true, "game/steamidashwid": true,
			"game/oldlogfilesformat": true, "network/antimassflag": true, "network/scripting": true,
		}[key]
	}
	return false
}

func soldatNativeManaged(file, key string) bool {
	return file == "/soldat.ini" && strings.EqualFold(key, "NETWORK/Port")
}

func soldatNativeSettingsSafety(file string, parsed gameSettingsParsed) gameSettingsParsed {
	if file != "/soldat.ini" && file != "/server.ini" {
		return parsed
	}
	fields := map[string]gameSetting{}
	for i := range parsed.fields {
		f := &parsed.fields[i]
		if soldatNativeManaged(file, f.key) {
			f.kind = "readonly"
		}
		if f.kind != "readonly" && soldatNativeBit(file, f.key) && (f.value == "0" || f.value == "1") {
			f.kind, f.on, f.off = "boolean", "1", "0"
		}
		if f.kind != "readonly" && file == "/soldat.ini" {
			switch strings.ToLower(f.key) {
			case "network/server_name", "network/admin_password", "network/game_password":
				f.kind = "text"
			}
		}
		fields[f.key] = *f
	}
	original := parsed.patch
	parsed.patch = func(changes map[string]string) ([]byte, error) {
		for key, value := range changes {
			field, exists := fields[key]
			if !exists || field.kind == "readonly" || soldatNativeManaged(file, key) {
				return nil, bad("Unknown or managed Soldat setting.")
			}
			if soldatNativeBit(file, key) && value != "0" && value != "1" {
				return nil, bad("Choose a Soldat boolean value.")
			}
			if file == "/soldat.ini" {
				switch strings.ToLower(key) {
				case "network/max_players":
					n, e := strconv.Atoi(value)
					if e != nil || strconv.Itoa(n) != value || n < 1 || n > 20 {
						return nil, bad("Soldat supports 1 through 20 players.")
					}
				case "network/server_name", "network/admin_password", "network/game_password":
					if strings.EqualFold(key, "NETWORK/Admin_Password") && strings.TrimSpace(value) == "" {
						return nil, bad("Soldat requires a nonempty administrator password.")
					}
					limit := 20
					if strings.EqualFold(key, "NETWORK/Server_Name") {
						limit = 100
					}
					if !utf8.ValidString(value) || utf8.RuneCountInString(value) > limit || strings.ContainsAny(value, "\r\n\x00") {
						return nil, bad("Enter a single-line Soldat value within its original limit.")
					}
					for _, r := range value {
						if r < 32 || r == 127 {
							return nil, bad("Soldat control characters are not permitted.")
						}
					}
				}
			}
		}
		return original(changes)
	}
	return parsed
}
