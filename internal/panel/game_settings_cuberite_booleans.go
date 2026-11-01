package panel

import "strings"

// Cuberite reads these observed native flags as integer 0/1. Keep this list
// recipe- and document-specific: arbitrary INI numbers are not booleans.
func cuberiteGameSettingsBooleans(egg M, file string, parsed gameSettingsParsed) gameSettingsParsed {
	if file != "/settings.ini" || !nativeSettingsIsRecipe(egg, "minecraft/java/cuberite/egg-cuberite.json") {
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
	parsed.fields = append([]gameSetting(nil), parsed.fields...)
	allowed := map[string]bool{}
	blocked := map[string]bool{}
	for canonical := range keys {
		count := 0
		for _, f := range parsed.fields {
			if strings.EqualFold(canonical, f.key) {
				count++
			}
		}
		if count > 1 {
			for _, f := range parsed.fields {
				if strings.EqualFold(canonical, f.key) {
					blocked[f.key] = true
				}
			}
		}
	}
	for i := range parsed.fields {
		f := &parsed.fields[i]
		if blocked[f.key] {
			f.kind = "readonly"
			continue
		}
		if !keys[f.key] || f.secret || f.kind == "readonly" {
			continue
		}
		if (f.value == "0" || f.value == "1") && (f.kind == "number" || f.kind == "boolean" && f.on == "1" && f.off == "0") {
			f.kind, f.on, f.off = "boolean", "1", "0"
			allowed[f.key] = true
		} else {
			// Quoted integers and textual booleans are not native integer flags.
			f.kind = "readonly"
		}
	}
	patch := parsed.patch
	parsed.patch = func(changes map[string]string) ([]byte, error) {
		for key, value := range changes {
			if blocked[key] || keys[key] && (!allowed[key] || value != "0" && value != "1") {
				return nil, bad("This native flag requires an unquoted 0 or 1.")
			}
		}
		return patch(changes)
	}
	return parsed
}
