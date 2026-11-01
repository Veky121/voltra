package panel

import "strings"

// soldat2SettingsSafety is called only for the verified Soldat 2 native launcher.
// Its Startup values are written on every launch and therefore cannot have a
// second writable authority in autoconfig.ini. Keep these visible but read-only.
func soldat2SettingsSafety(parsed gameSettingsParsed) gameSettingsParsed {
	managed := map[string]bool{}
	for _, name := range []string{"Name", "Port", "WebSocketsPort", "WebSocketsRconPort", "MaxPlayers", "ServerPassword", "RconPassword", "GreetMessage", "AdminPlayfabId", "VisibleInGamesList"} {
		managed[strings.ToLower("GameServerConfig/"+name)] = true
	}
	counts := map[string]int{}
	for _, f := range parsed.fields {
		counts[strings.ToLower(f.key)]++
	}
	allowed := map[string]bool{}
	booleans := map[string]bool{}
	for i := range parsed.fields {
		f := &parsed.fields[i]
		key := strings.ToLower(f.key)
		// The native updater owns its migration marker. Ambiguous case variants
		// must never choose an arbitrary operator row to replace.
		if managed[key] || strings.HasPrefix(key, "configupdater/") || counts[key] != 1 {
			f.kind = "readonly"
		}
		if f.kind != "readonly" && (f.value == "True" || f.value == "False") {
			f.kind, f.on, f.off = "boolean", "True", "False"
			booleans[f.key] = true
		}
		allowed[f.key] = f.kind != "readonly"
	}
	original := parsed.patch
	parsed.patch = func(changes map[string]string) ([]byte, error) {
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
