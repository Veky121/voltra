package panel

import "strings"

const empyrionSettingsRecipe = "empyrion/egg-empyrion--galactic-survival.json"
const empyrionSettingsPath = "/dedicated.yaml"

func empyrionSettingsDocument(egg M, file string) bool {
	return file == empyrionSettingsPath && nativeSettingsIsRecipe(egg, empyrionSettingsRecipe)
}

func empyrionSettingsManaged(egg M, file, key string) bool {
	if !empyrionSettingsDocument(egg, file) {
		return false
	}
	switch gameSettingsINIFold(key) {
	case gameSettingsINIFold("/ServerConfig/Srv_Port"), gameSettingsINIFold("/ServerConfig/Tel_Port"), gameSettingsINIFold("/ServerConfig/Tel_Enabled"), gameSettingsINIFold("/ServerConfig/Tel_Pwd"):
		return true
	}
	return false
}

// The private console credential and its transport are runtime-owned. This is
// scoped to the native Empyrion document; it does not change global pwd rules.
func empyrionSettingsFields(egg M, file string, parsed gameSettingsParsed) gameSettingsParsed {
	if !empyrionSettingsDocument(egg, file) {
		return parsed
	}
	for i := range parsed.fields {
		field := &parsed.fields[i]
		key := gameSettingsINIFold(field.key)
		if key == gameSettingsINIFold("/ServerConfig/Tel_Pwd") {
			field.secret = true
		}
		// Native ServerConfig is a mapping. A malformed scalar/list parent must
		// not expose a nested Tel_Pwd or bypass managed-child checks as one edit.
		if key == gameSettingsINIFold("/ServerConfig") || field.key == "" {
			field.secret, field.kind = true, "readonly"
		}
	}
	patch := parsed.patch
	parsed.patch = func(changes map[string]string) ([]byte, error) {
		for key := range changes {
			if empyrionSettingsManaged(egg, file, key) || strings.EqualFold(key, "/ServerConfig") || key == "" {
				return nil, bad("Empyrion listener and private console settings are managed by the runtime.")
			}
		}
		return patch(changes)
	}
	return parsed
}
