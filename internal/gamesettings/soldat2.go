package gamesettings

import "strings"

// soldat2SettingsSafety is called only for the verified Soldat 2 native launcher.
// Its Startup values are written on every launch and therefore cannot have a
// second writable authority in autoconfig.ini. Keep these visible but read-only.
func soldat2SettingsSafety(parsed Parsed) Parsed {
	managed := map[string]bool{}
	for _, name := range []string{"Name", "Port", "WebSocketsPort", "WebSocketsRconPort", "MaxPlayers", "ServerPassword", "RconPassword", "GreetMessage", "AdminPlayfabId", "VisibleInGamesList"} {
		managed[strings.ToLower("GameServerConfig/"+name)] = true
	}
	counts := map[string]int{}
	for _, f := range parsed.Fields {
		counts[strings.ToLower(f.Key)]++
	}
	allowed := map[string]bool{}
	booleans := map[string]bool{}
	for i := range parsed.Fields {
		f := &parsed.Fields[i]
		key := strings.ToLower(f.Key)
		// The native updater owns its migration marker. Ambiguous case variants
		// must never choose an arbitrary operator row to replace.
		if managed[key] || strings.HasPrefix(key, "configupdater/") || counts[key] != 1 {
			f.Kind = "readonly"
		}
		if f.Kind != "readonly" && (f.Value == "True" || f.Value == "False") {
			f.Kind, f.On, f.Off = "boolean", "True", "False"
			booleans[f.Key] = true
		}
		allowed[f.Key] = f.Kind != "readonly"
	}
	original := parsed.Patch
	parsed.Patch = func(changes map[string]string) ([]byte, error) {
		for key, value := range changes {
			if !allowed[key] {
				return nil, bad("Unknown, ambiguous or Startup-owned Soldat 2 setting.")
			}
			if booleans[key] && value != "True" && value != "False" {
				return nil, bad("Choose a native Soldat 2 boolean value.")
			}
		}
		return original(changes)
	}
	return parsed
}
