package panel

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"math"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"
)

const abioticSettingsPath = "/AbioticFactor/Saved/SaveGames/Server/Worlds/Cascade/SandboxSettings.ini"
const abioticSettingsSection = "SandboxSettings"
const abioticSettingsRecipe = "abiotic_factor/egg-abiotic-factor.json"
const abioticSettingsStartup = "exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/unreal_survival_runtime.py abiotic"

// Existing native keys only: no defaults are inserted. Integration must verify
// exact launcher, emitted modules, empty Wings mappings, regular path and revision.
// Arbitrary operator mods may override these CONFIG values.
func parseAbioticSettings(data []byte) (gameSettingsParsed, error) {
	out := gameSettingsParsed{}
	invalid := func() error { return fmt.Errorf("Unsupported or ambiguous Abiotic host settings") }
	if len(data) > 8*1024*1024 || !utf8.Valid(data) || bytes.ContainsAny(data, "\x00") {
		return out, invalid()
	}
	original := bytes.Clone(data)
	body := strings.TrimPrefix(string(original), "\ufeff")
	lines := strings.SplitAfter(body, "\n")
	type span struct {
		line, start, end int
		value            string
	}
	found := map[string]span{}
	order := []string{"GameDifficulty", "HardcoreMode", "AllowLocalOnlyMods", "LootRespawnEnabled", "PowerSocketsOffAtNight", "DayNightCycleState", "DayNightCycleSpeedMultiplier", "WeatherFrequency", "SinkRefillRate", "FoodSpoilSpeedMultiplier", "RefrigerationEffectivenessMultiplier", "EnemySpawnRate", "EnemyHealthMultiplier", "EnemyPlayerDamageMultiplier", "EnemyDeployableDamageMultiplier", "DamageToAlliesMultiplier", "HungerSpeedMultiplier", "ThirstSpeedMultiplier", "FatigueSpeedMultiplier", "ContinenceSpeedMultiplier", "DetectionSpeedMultiplier", "BonusPerkPoints", "PlayerXPGainMultiplier", "ItemStackSizeMultiplier", "ItemWeightMultiplier", "ItemDurabilityMultiplier", "DurabilityLossOnDeathMultiplier", "ShowDeathMessages", "AllowRecipeSharing", "AllowPagers", "AllowTransmog", "DisableResearchMinigame", "DeathPenalties", "FirstTimeStartingWeapon", "HostAccessPlayerCorpses", "StorageByTag", "StructuralSupportLimit", "AllowCharacterReset", "BridgeSupports", "HomeWorlds", "InvisibleRadiation", "BaseInventorySize", "TaintedSinkWater", "RadiationDealsDamage", "PlayerFurnitureDestruction", "AllowIronMode", "EnemyAccuracy", "ApocalypticAbilities", "MaximizeEnemySpawns"}
	active, seenSection := false, false
	for i, raw := range lines {
		line := strings.TrimSuffix(strings.TrimSuffix(raw, "\n"), "\r")
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, ";") || strings.HasPrefix(trimmed, "#") {
			continue
		}
		if strings.HasPrefix(trimmed, "[") {
			if !strings.HasSuffix(trimmed, "]") {
				return out, invalid()
			}
			name := trimmed[1 : len(trimmed)-1]
			active = name == abioticSettingsSection
			if strings.EqualFold(name, abioticSettingsSection) {
				if !active || seenSection {
					return out, invalid()
				}
				seenSection = true
			}
			continue
		}
		if !active {
			continue
		}
		eq := strings.IndexByte(line, '=')
		if eq < 0 {
			return out, invalid()
		}
		key := strings.TrimSpace(line[:eq])
		alias := strings.TrimLeft(key, "+-.!")
		if bracket := strings.IndexByte(alias, '['); bracket >= 0 {
			alias = alias[:bracket]
		}
		for _, known := range order {
			if !strings.EqualFold(alias, known) {
				continue
			}
			if key != known {
				return out, invalid()
			}
			if _, exists := found[key]; exists {
				return out, invalid()
			}
			start := eq + 1
			for start < len(line) && (line[start] == ' ' || line[start] == '\t') {
				start++
			}
			end := len(strings.TrimRight(line, " \t"))
			if end < start {
				end = start
			}
			found[key] = span{i, start, end, line[start:end]}
		}
	}
	valid := func(key, value string) bool {
		if strings.ContainsFunc(value, unicode.IsControl) || !utf8.ValidString(value) || strings.ContainsAny(value, "\x00\r\n\";#=[]\\") || strings.TrimSpace(value) != value {
			return false
		}
		switch key {
		case "HardcoreMode", "AllowLocalOnlyMods", "LootRespawnEnabled", "PowerSocketsOffAtNight", "ShowDeathMessages", "AllowRecipeSharing", "AllowPagers", "AllowTransmog", "DisableResearchMinigame", "HostAccessPlayerCorpses", "StorageByTag", "AllowCharacterReset", "HomeWorlds", "InvisibleRadiation", "TaintedSinkWater", "RadiationDealsDamage", "PlayerFurnitureDestruction", "AllowIronMode", "ApocalypticAbilities", "MaximizeEnemySpawns":
			return value == "True" || value == "False"
		case "GameDifficulty", "DayNightCycleState", "WeatherFrequency", "BonusPerkPoints", "DeathPenalties", "FirstTimeStartingWeapon", "StructuralSupportLimit", "BridgeSupports", "BaseInventorySize", "EnemyAccuracy":
			n, e := strconv.ParseInt(value, 10, 32)
			return e == nil && strconv.FormatInt(n, 10) == value
		default:
			n, e := strconv.ParseFloat(value, 64)
			return e == nil && !math.IsNaN(n) && !math.IsInf(n, 0)
		}
	}

	for _, key := range order {
		s, ok := found[key]
		if !ok {
			continue
		}
		kind := "number"
		switch key {
		case "HardcoreMode", "AllowLocalOnlyMods", "LootRespawnEnabled", "PowerSocketsOffAtNight", "ShowDeathMessages", "AllowRecipeSharing", "AllowPagers", "AllowTransmog", "DisableResearchMinigame", "HostAccessPlayerCorpses", "StorageByTag", "AllowCharacterReset", "HomeWorlds", "InvisibleRadiation", "TaintedSinkWater", "RadiationDealsDamage", "PlayerFurnitureDestruction", "AllowIronMode", "ApocalypticAbilities", "MaximizeEnemySpawns":
			kind = "boolean"
		}
		if !valid(key, s.value) {
			return gameSettingsParsed{}, invalid()
		}
		out.fields = append(out.fields, gameSetting{key: abioticSettingsSection + "/" + key, value: s.value, kind: kind, on: "True", off: "False"})
	}

	out.patch = func(changes map[string]string) ([]byte, error) {
		next := append([]string(nil), lines...)
		for full, value := range changes {
			key := strings.TrimPrefix(full, abioticSettingsSection+"/")
			s, ok := found[key]
			if !ok || full != abioticSettingsSection+"/"+key {
				return nil, invalid()
			}
			// Validate again before any source bytes are changed.
			if !valid(key, value) {
				return nil, invalid()
			}
			next[s.line] = next[s.line][:s.start] + value + next[s.line][s.end:]
		}
		result := []byte(strings.Join(next, ""))
		if bytes.HasPrefix(original, []byte{0xef, 0xbb, 0xbf}) {
			result = append([]byte{0xef, 0xbb, 0xbf}, result...)
		}
		return result, nil
	}
	return out, nil
}

// abioticSettingsAuthority validates installed emitted source and fixed active path.
// Call only after shared no-symlink regular-file reads and permission/state checks.
func abioticSettingsAuthority(recipe, startup string, mappings int, files map[string][]byte) bool {
	if recipe != abioticSettingsRecipe || startup != abioticSettingsStartup || mappings != 0 {
		return false
	}
	pins := map[string]string{
		"/.voltra/steam_template.py":            "dc8ff0a9e462751878aad55da80bea8fd2a2d4ef16dbf8d37b798ea8d4c476dd",
		"/.voltra/bundle_debian_python.py":      "16b2ebdcfa2656b591624c9d627defa4c3940be4c8a69d8842778ff25ea0cdc0",
		"/.voltra/native_config.py":             "8c125bb526b38896eeba57143ec2fc70bfb94f1c9783e4c6d652d8f57e3b52a2",
		"/.voltra/native_console.py":            "e8274872cb9ccbf7c60bca3615aed0d200c66bc28dc54b7fdd3b243070f9f3e5",
		"/.voltra/enshrouded_proton.py":         "b204044a0cb0dc250c46450410a49fcecabfb2c5581ba2f7dd9c99d86e961a26",
		"/.voltra/unreal_survival_install.py":   "83b327fae6f782e0009094bb256bb6161c2c44657ccec71c63a3a79eadca297a",
		"/.voltra/unreal_survival_runtime.py":   "8e79348fd834ff24b2e08328830fab1263cdde4b479f9750c9d2ec7be37d1417",
		"/.voltra/unreal_survival_release.json": "796dcf63221a71f7de2c047dbe40eb26ceaeff89d8cc3747db73583a7406870a",
	}
	for name, pin := range pins {
		data, ok := files[name]
		if !ok {
			return false
		}
		sum := sha256.Sum256(data)
		if hex.EncodeToString(sum[:]) != pin {
			return false
		}
	}
	_, ok := files[abioticSettingsPath]
	return ok
}
