package panel

import (
	"github.com/pelletier/go-toml/v2"
	"strings"
)

// parseSS14ReviewedSettings validates TOML semantics before using the shared
// value-span editor. It deliberately exposes only reviewed, already present keys.
// Root must wire this into exact-recipe dispatch; no file is seeded here.
func parseSS14ReviewedSettings(data []byte) (gameSettingsParsed, error) {
	var native map[string]any
	if err := toml.Unmarshal(data, &native); err != nil {
		return gameSettingsParsed{}, bad("Invalid or ambiguous SS14 TOML; repair it in Files.")
	}
	parsed, err := parseGameSettings(ss14SettingsPath, data)
	if err != nil {
		return parsed, err
	}
	fields := []gameSetting{}
	allowed := map[string]bool{}
	for _, f := range parsed.fields {
		if ss14ReviewedMetadata(f.key) == nil {
			continue
		}
		parts := strings.Split(f.key, "/")
		table, ok := native[parts[0]].(map[string]any)
		if !ok {
			return gameSettingsParsed{}, bad("Unsupported SS14 table syntax; use Files.")
		}
		value, exists := table[parts[1]]
		if !exists {
			return gameSettingsParsed{}, bad("Ambiguous SS14 key syntax; use Files.")
		}
		// Exact bare section/key syntax must agree with the semantic TOML decoder.
		// Quoted/dotted aliases are preserved but never gain editable authority.
		switch f.key {
		case "game/hostname", "game/desc":
			if _, ok := value.(string); !ok {
				f.kind = "readonly"
			}
		default:
			if _, ok := value.(int64); !ok {
				f.kind = "readonly"
			}
		}
		if f.kind != "readonly" {
			allowed[f.key] = true
		}
		fields = append(fields, f)
	}
	patch := parsed.patch
	parsed.fields = fields
	parsed.patch = func(changes map[string]string) ([]byte, error) {
		for key := range changes {
			if !allowed[key] {
				return nil, bad("This SS14 setting is absent, unreviewed, or requires Files.")
			}
		}
		updated, err := patch(changes)
		if err != nil {
			return nil, err
		}
		var check map[string]any
		if err := toml.Unmarshal(updated, &check); err != nil {
			return nil, bad("The change is not valid native TOML.")
		}
		return updated, nil
	}
	// Reuse existing campaign bounds, without creating defaults or broadening them.
	return ss14GameSettingsSafety(ss14ReviewedEgg(), ss14SettingsPath, parsed), nil
}

func ss14ReviewedEgg() M {
	for _, entry := range gameTemplates().Entries {
		if entry.Path == ss14SettingsRecipe {
			return M{"uuid": gameTemplateEggUUID(entry)}
		}
	}
	return M{}
}

// Metadata for existing scalar controls only. Bounds are existing adapter policy,
// not publisher defaults. Root merges these into shared field response objects.
func ss14ReviewedMetadata(key string) M {
	switch key {
	case "game/hostname":
		return M{"label": "Server name", "group": "General", "type": "text", "max_length": 48, "restart_required": true}
	case "game/desc":
		return M{"label": "Server description", "group": "General", "type": "text", "restart_required": true}
	case "game/soft_max_players":
		return M{"label": "Player limit excluding admins", "group": "General", "type": "number", "min": 1, "max": 256, "step": 1, "restart_required": true}
	case "net/max_connections":
		return M{"label": "Connection limit including admins", "group": "Capacity", "type": "number", "min": 1, "max": 256, "step": 1, "restart_required": true}
	case "net/tickrate":
		return M{"label": "Server tick rate", "group": "Performance", "type": "number", "min": 1, "max": 80, "step": 1, "restart_required": true}
	}
	return nil
}
