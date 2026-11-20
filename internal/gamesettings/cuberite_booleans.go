package gamesettings

import "strings"

// Cuberite reads these observed native flags as integer 0/1. Keep this list
// recipe- and document-specific: arbitrary INI numbers are not booleans.
func CuberiteGameSettingsBooleans(egg M, file string, parsed Parsed) Parsed {
	if file != "/settings.ini" || !IsRecipe(egg, "minecraft/java/cuberite/egg-cuberite.json") {
		return parsed
	}
	keys := map[string]bool{
		"AntiCheat/LimitPlayerBlockChanges":   true,
		"Authentication/AllowBungeeCord":      true,
		"Authentication/Authenticate":         true,
		"Authentication/OnlyAllowBungeeCord":  true,
		"Server/AllowMultiLogin":              true,
		"Server/AllowMultiWorldTabCompletion": true,
		"Server/RequireResourcePack":          true,
		"Plugins/Core":                        true,
		"Plugins/ChatLog":                     true,
	}
	parsed.Fields = append([]Setting(nil), parsed.Fields...)
	allowed := map[string]bool{}
	blocked := map[string]bool{}
	for canonical := range keys {
		count := 0
		for _, f := range parsed.Fields {
			if strings.EqualFold(canonical, f.Key) {
				count++
			}
		}
		if count > 1 {
			for _, f := range parsed.Fields {
				if strings.EqualFold(canonical, f.Key) {
					blocked[f.Key] = true
				}
			}
		}
	}
	for i := range parsed.Fields {
		f := &parsed.Fields[i]
		if blocked[f.Key] {
			f.Kind = "readonly"
			continue
		}
		if !keys[f.Key] || f.Secret || f.Kind == "readonly" {
			continue
		}
		if (f.Value == "0" || f.Value == "1") && (f.Kind == "number" || f.Kind == "boolean" && f.On == "1" && f.Off == "0") {
			f.Kind, f.On, f.Off = "boolean", "1", "0"
			allowed[f.Key] = true
		} else {
			// Quoted integers and textual booleans are not native integer flags.
			f.Kind = "readonly"
		}
	}
	patch := parsed.Patch
	parsed.Patch = func(changes map[string]string) ([]byte, error) {
		for key, value := range changes {
			if blocked[key] || keys[key] && (!allowed[key] || value != "0" && value != "1") {
				return nil, bad("This native flag requires an unquoted 0 or 1.")
			}
		}
		return patch(changes)
	}
	return parsed
}
