package panel

import (
	"bytes"
	"encoding/json"
	"sort"
	"strings"
	"unicode/utf8"
)

// Existing-only booleans documented in guide 2992700419. The guide carries
// removed/incompatible banners; this is no claim of current native consumption.
// No defaults, containers, secrets, arrays or unknown keys are synthesized.
var sonsGameplayLabels = map[string]string{
	"/GameSettings/Gameplay.TreeRegrowth":                                  "Tree regrowth",
	"/GameSettings/Structure.Damage":                                       "Building damage",
	"/CustomGameModeSettings/GameSetting.Multiplayer.Cheats":               "Allow cheats",
	"/CustomGameModeSettings/GameSetting.Vail.EnemySpawn":                  "Spawn enemies",
	"/CustomGameModeSettings/GameSetting.Survival.ReducedFoodInContainers": "Reduced container food",
	"/CustomGameModeSettings/GameSetting.Survival.SingleUseContainers":     "Single-use containers",
	"/CustomGameModeSettings/GameSetting.Survival.CreativeMode":            "Creative mode",
	"/CustomGameModeSettings/GameSetting.Survival.PlayersImmortalMode":     "Immortal players",
	"/CustomGameModeSettings/GameSetting.FreeForm.ForcePlaceFullLoad":      "Place full carried load",
	"/CustomGameModeSettings/GameSetting.Construction.NoCuttingsSpawn":     "Disable cuttings",
}

func parseSonsGameplaySettings(data []byte) (gameSettingsParsed, error) {
	invalid := func() (gameSettingsParsed, error) {
		return gameSettingsParsed{}, bad("Invalid or ambiguous Sons gameplay configuration. Review it in Files.")
	}
	if len(data) > 4*1024*1024 || !utf8.Valid(data) {
		return invalid()
	}
	original := append([]byte(nil), data...)
	prefix := 0
	if bytes.HasPrefix(data, []byte{0xef, 0xbb, 0xbf}) {
		prefix = 3
	}
	body := data[prefix:]
	if !json.Valid(body) {
		return invalid()
	}
	spans, err := bananaJSONSpans(body)
	if err != nil || !spans[""].object {
		return invalid()
	}
	reserved := []string{"/GameSettings", "/CustomGameModeSettings"}
	for key := range sonsGameplayLabels {
		reserved = append(reserved, key)
	}
	for key := range spans {
		for _, expected := range reserved {
			if key != expected && strings.EqualFold(key, expected) {
				return invalid()
			}
		}
	}
	parsed := gameSettingsParsed{}
	allowed := map[string]bananaJSONSpan{}
	keys := []string{}
	for key := range sonsGameplayLabels {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		parent := key[:strings.LastIndex(key, "/")]
		if !spans[parent].object {
			continue
		}
		span, exists := spans[key]
		if !exists {
			continue
		}
		value := string(body[span.start:span.end])
		// Unsupported existing types remain opaque, including explicit null.
		if value != "true" && value != "false" {
			continue
		}
		allowed[key] = span
		parsed.fields = append(parsed.fields, gameSetting{key: key, value: value, kind: "boolean", on: "true", off: "false"})
	}
	parsed.patch = func(changes map[string]string) ([]byte, error) {
		keys := []string{}
		for key, value := range changes {
			if _, ok := allowed[key]; !ok || (value != "true" && value != "false") {
				return nil, bad("Unsupported Sons gameplay setting or value.")
			}
			keys = append(keys, key)
		}
		sort.Slice(keys, func(i, j int) bool { return allowed[keys[i]].start > allowed[keys[j]].start })
		out := append([]byte(nil), original...)
		for _, key := range keys {
			span := allowed[key]
			next := append([]byte(nil), out[:span.start+prefix]...)
			next = append(next, changes[key]...)
			out = append(next, out[span.end+prefix:]...)
		}
		return out, nil
	}
	return parsed, nil
}

func sonsGameplaySettingPresentation(egg M, file string, field M) {
	if !nativeSettingsIsRecipe(egg, sonsSettingsRecipe) || !reviewedNewDocument(egg, file) {
		return
	}
	key := str(field["key"])
	label, ok := sonsGameplayLabels[key]
	if !ok {
		return
	}
	field["label"], field["group"], field["type"] = label, "Gameplay", "boolean"
	field["help"] = "Existing native value only. Requires restart; current game-version support is unverified."
	if strings.HasPrefix(key, "/CustomGameModeSettings/") {
		field["group"] = "Custom game (new saves)"
		field["help"] = "Applies only when creating a new custom-mode save; ignored when loading an existing save. Current game-version support is unverified."
	}
}
