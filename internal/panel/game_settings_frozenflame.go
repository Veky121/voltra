package panel

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strconv"
	"strings"
	"unicode/utf8"
)

const frozenflameSettingsPath = "/FrozenFlame/Saved/Config/LinuxServer/Game.ini"
const frozenflameSettingsRecipe = "frozen_flame/egg-frozen-flame.json"
const frozenflameSettingsStartup = "exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/frozenflame_owner.py run"

// Existing CONFIG values only. Launcher/module pins and managed mappings must
// be checked by root before dispatch. Plugins may override native CONFIG.
func parseFrozenflameSettings(data []byte) (gameSettingsParsed, error) {
	invalid := func() error { return fmt.Errorf("Unsupported Frozen Flame configuration") }
	if len(data) > 8*1024*1024 || !utf8.Valid(data) || bytes.ContainsRune(data, 0) {
		return gameSettingsParsed{}, invalid()
	}
	parsed, err := parseGameSettingsLines(frozenflameSettingsPath, bytes.TrimPrefix(data, []byte{239, 187, 191}))
	if err != nil {
		return parsed, err
	}
	parsed = gameSettingsINICaseSafety(frozenflameSettingsPath, data, parsed)
	allowed := map[string]string{
		"/Script/Engine.GameSession/MaxPlayers":           "number",
		"/Script/FrozenFlame.FGameSession/ServerPassword": "text",
	}
	for _, key := range []string{"bFreePVP", "bRestoreHealthOnLevelUp", "bIsAllowedToTeleportWithOverweight", "bIsAllowedToGlideWithOverweight", "bDropEquippedItems", "bDropEquipableItems", "bDropFoodItems", "bNoModuleCost", "bLimitlessSupport", "bInvulnerableModules", "bOnlyOneSentinelAllowed", "bRequireActiveSentinelForBuildingMode", "bDisallowToDestroyModulesWithoutOwnership", "bAllowCreaturesToDamageBuildings", "bAllowPlayersToDamageBuildings"} {
		allowed["/Script/FrozenFlame.GameBalance/"+key] = "boolean"
	}
	valid := func(key, value string) bool {
		switch allowed[key] {
		case "boolean":
			return value == "True" || value == "False"
		case "number":
			n, e := strconv.ParseUint(value, 10, 32)
			return e == nil && n > 0
		case "text":
			return !strings.ContainsAny(value, "\r\n\x00") && utf8.ValidString(value)
		}
		return false
	}
	fields := []gameSetting{}
	writable := map[string]bool{}
	for _, f := range parsed.fields {
		kind, ok := allowed[f.key]
		if !ok {
			continue
		}
		if f.kind == "readonly" || !valid(f.key, f.value) {
			f.kind = "readonly"
		} else {
			f.kind = kind
			writable[f.key] = true
		}
		if kind == "boolean" {
			f.on = "True"
			f.off = "False"
		}
		f.secret = strings.HasSuffix(f.key, "/ServerPassword")
		fields = append(fields, f)
	}
	patch := parsed.patch
	parsed.fields = fields
	parsed.patch = func(changes map[string]string) ([]byte, error) {
		for k, v := range changes {
			if !writable[k] || !valid(k, v) {
				return nil, invalid()
			}
		}
		result, e := patch(changes)
		if e == nil && bytes.HasPrefix(data, []byte{239, 187, 191}) {
			result = append([]byte{239, 187, 191}, result...)
		}
		return result, e
	}
	return parsed, nil
}

// Call only after shared permission, stopped-state, no-symlink reads and revision checks.
func frozenflameSettingsAuthority(recipe, startup string, mappings int, files map[string][]byte) bool {
	if recipe != frozenflameSettingsRecipe || startup != frozenflameSettingsStartup || mappings != 0 {
		return false
	}
	pins := map[string]string{
		"/.voltra/steam_template.py":            "7d908cdc739fbb999fdfb13f48f3e8d3a5fdf26fbfa48091dee1442913078897",
		"/.voltra/native_console.py":            "7f0c2a6e4050d12fc3bb2af9dcd723df6b80109fed91a26ccd1ae52d2bb1b3a4",
		"/.voltra/native_config.py":             "468a2e9b6cff276687fa9464a30927c4be77c1624a564958ee5d40298ff58051",
		"/.voltra/bundle_debian_python.py":      "8da05c31a5aeebc8b6096223508a9e7314fc853bf1682ae31da52ec46db11aad",
		"/.voltra/unreal_building.py":           "9b759b3fe875fb3474b26c1aaed6382a590bbba95e580caf28245a5713d5d6e1",
		"/.voltra/unreal_building_release.json": "19072d3d620127d263b04c0c2baec3e806bf9251aefc0c396e3baba5d4a05fe6",
		"/.voltra/frozenflame_owner.py":         "0bc339d968141b9145415521920be83f3374a10dc36fd6d4d221f26e932ed74b",
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
	_, ok := files[frozenflameSettingsPath]
	return ok
}
