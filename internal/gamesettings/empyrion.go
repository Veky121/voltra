package gamesettings

import "strings"

const EmpyrionSettingsRecipe = "empyrion/egg-empyrion--galactic-survival.json"
const EmpyrionSettingsPath = "/dedicated.yaml"

func empyrionSettingsDocument(egg M, file string) bool {
	return file == EmpyrionSettingsPath && IsRecipe(egg, EmpyrionSettingsRecipe)
}

func EmpyrionSettingsManaged(egg M, file, key string) bool {
	if !empyrionSettingsDocument(egg, file) {
		return false
	}
	switch INIFold(key) {
	case INIFold("/ServerConfig/Srv_Port"), INIFold("/ServerConfig/Tel_Port"), INIFold("/ServerConfig/Tel_Enabled"), INIFold("/ServerConfig/Tel_Pwd"):
		return true
	}
	return false
}

// The private console credential and its transport are runtime-owned. This is
// scoped to the native Empyrion document; it does not change global pwd rules.
func EmpyrionSettingsFields(egg M, file string, parsed Parsed) Parsed {
	if !empyrionSettingsDocument(egg, file) {
		return parsed
	}
	for i := range parsed.Fields {
		field := &parsed.Fields[i]
		key := INIFold(field.Key)
		if key == INIFold("/ServerConfig/Tel_Pwd") {
			field.Secret = true
		}
		// Native ServerConfig is a mapping. A malformed scalar/list parent must
		// not expose a nested Tel_Pwd or bypass managed-child checks as one edit.
		if key == INIFold("/ServerConfig") || field.Key == "" {
			field.Secret, field.Kind = true, "readonly"
		}
	}
	patch := parsed.Patch
	parsed.Patch = func(changes map[string]string) ([]byte, error) {
		for key := range changes {
			if EmpyrionSettingsManaged(egg, file, key) || strings.EqualFold(key, "/ServerConfig") || key == "" {
				return nil, bad("Empyrion listener and private console settings are managed by the runtime.")
			}
		}
		return patch(changes)
	}
	return parsed
}
