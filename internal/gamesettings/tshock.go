package gamesettings

import "strings"

func tshockNativeBoolean(egg M, file, key, kind string) bool {
	return kind == "boolean" && file == "/tshock/config.json" && key == "/Settings/EnableTokenEndpointAuthentication" && IsRecipe(egg, "terraria/tshock/egg-tshock.json")
}

// Apply only to the modern TShock recipe after generic parsing. Native keys
// below were observed in the installed publisher 6.2.1 configuration.
func tshockNativeSettingsSafety(file string, parsed Parsed) Parsed {
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
	fields := map[string]Setting{}
	for i := range parsed.Fields {
		field := &parsed.Fields[i]
		folded := strings.ToLower(field.Key)
		if managed[folded] {
			field.Kind = "readonly"
		}
		if file == "/tshock/config.json" {
			switch folded {
			case "/settings/mysqlconnectionstring", "/settings/postgresconnectionstring", "/settings/sqliteconnectionstring":
				field.Secret = true
				field.Kind = "text"
			}
			if field.Key == "/Settings/EnableTokenEndpointAuthentication" && field.Node != nil && field.Node.Tag == "!!bool" && (field.Value == "true" || field.Value == "false") {
				field.Secret = false
				field.Kind, field.On, field.Off = "boolean", "true", "false"
			}
		}
		fields[field.Key] = *field
	}
	original := parsed.Patch
	parsed.Patch = func(changes map[string]string) ([]byte, error) {
		for key, value := range changes {
			field, exists := fields[key]
			if !exists {
				return nil, bad("Unknown TShock setting.")
			}
			if managed[strings.ToLower(key)] {
				return nil, bad("This TShock path or network setting is managed by the server.")
			}
			if field.Kind == "boolean" && key == "/Settings/EnableTokenEndpointAuthentication" && value != "true" && value != "false" {
				return nil, bad("Choose a boolean value.")
			}
		}
		return original(changes)
	}
	return parsed
}
