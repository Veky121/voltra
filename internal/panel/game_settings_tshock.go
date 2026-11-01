package panel

import "strings"

func tshockNativeBoolean(egg M, file, key, kind string) bool {
	return kind == "boolean" && file == "/tshock/config.json" && key == "/Settings/EnableTokenEndpointAuthentication" && nativeSettingsIsRecipe(egg, "terraria/tshock/egg-tshock.json")
}

// Apply only to the modern TShock recipe after generic parsing. Native keys
// below were observed in the installed publisher 6.2.1 configuration.
func tshockNativeSettingsSafety(file string, parsed gameSettingsParsed) gameSettingsParsed {
	managed := map[string]bool{}
	switch file {
	case "/serverconfig.txt":
		for _, key := range []string{"world", "worldpath", "upnp"} {
			managed[key] = true
		}
	case "/tshock/config.json":
		managed["/settings/logpath"] = true
	default:
		return parsed
	}
	fields := map[string]gameSetting{}
	for i := range parsed.fields {
		field := &parsed.fields[i]
		folded := strings.ToLower(field.key)
		if managed[folded] {
			field.kind = "readonly"
		}
		if file == "/tshock/config.json" {
			switch folded {
			case "/settings/mysqlconnectionstring", "/settings/postgresconnectionstring", "/settings/sqliteconnectionstring":
				field.secret = true
				field.kind = "text"
			}
			if field.key == "/Settings/EnableTokenEndpointAuthentication" && field.node != nil && field.node.Tag == "!!bool" && (field.value == "true" || field.value == "false") {
				field.secret = false
				field.kind, field.on, field.off = "boolean", "true", "false"
			}
		}
		fields[field.key] = *field
	}
	original := parsed.patch
	parsed.patch = func(changes map[string]string) ([]byte, error) {
		for key, value := range changes {
			field, exists := fields[key]
			if !exists {
				return nil, bad("Unknown TShock setting.")
			}
			if managed[strings.ToLower(key)] {
				return nil, bad("This TShock path or network setting is managed by the server.")
			}
			if field.kind == "boolean" && key == "/Settings/EnableTokenEndpointAuthentication" && value != "true" && value != "false" {
				return nil, bad("Choose a boolean value.")
			}
		}
		return original(changes)
	}
	return parsed
}
