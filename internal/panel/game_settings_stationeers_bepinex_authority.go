package panel

import (
	"encoding/json"
	"errors"
)

const stationeersBepinexAuthorityStartup = "exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/stationeers_bepinex_owner.py"

var stationeersBepinexAuthoritySources = map[string]string{
	".voltra/stationeers_bepinex_owner.py":          "ddbbcc5f714b8d3d6324a704d125da19ad2d61a114a0b8aaa71a74a5cb39a513",
	".voltra/stationeers_wurm_starbound_runtime.py": "03471cf78268aa397d3114ca2c0ca578186e65944cffe5300f5aab5c89d4de7d",
}

// stationeersBepinexSettingsAuthority selects source authority from panel startup,
// effective daemon environment and confined file snapshots. Recipe is the exact
// catalog identity; eggStartup is the imported egg startup, not its display name.
// Files must be bounded regular-file reads at the volume root through the normal
// daemon file API. Read failures are errors, never absence. This needs no native
// binary attestation and establishes no BepInEx version/schema compatibility.
//
// Integration must repeat selection and document reads after the settings lock,
// compare this Revision AND the shared document revision, require stopped state,
// and enforce existing settings/file RBAC. This helper grants no write access.
func stationeersBepinexSettingsAuthority(recipe, eggStartup string, in settingsAuthorityInput) (settingsPathAuthority, error) {
	refuse := errors.New("Stationeers BepInEx settings authority is unsupported or ambiguous")
	if recipe != stationeersBepinexRecipe || eggStartup != stationeersBepinexAuthorityStartup || in.Startup != eggStartup ||
		in.Env["VOLTRA_NATIVE_FAMILY"] != "stationeers" || in.Env["VOLTRA_STATIONEERS_VARIANT"] != "bepinex" ||
		!settingsAuthoritySources(in, stationeersBepinexAuthoritySources) {
		return settingsPathAuthority{}, refuse
	}
	// The reviewed adapter fixes cwd-relative setting.xml. Extra CLI switches,
	// wrappers and custom paths cannot match the exact startup above. Unconsumed
	// environment names cannot redirect it. Never create the first-boot document.
	data, exists := in.Files["setting.xml"]
	if !exists {
		return settingsPathAuthority{}, refuse
	}
	if _, err := parseStationeersBepinexGameSettings(data); err != nil {
		return settingsPathAuthority{}, refuse
	}
	// Only these env values influence launch-owned world/port selection. Ordinary
	// settings and passwords are removed from -settings when the file exists.
	// Hash exact observations without logging secrets or requiring write tokens.
	selection := map[string]string{}
	for _, key := range []string{"SAVE_NAME", "WORLD_NAME", "SERVER_PORT", "UPDATE_PORT", "VOLTRA_ALLOCATED_PORTS", "STATIONEERS_MOD_FRAMEWORK", "VOLTRA_STEAM_AUTO_UPDATE"} {
		if value, ok := in.Env[key]; ok {
			selection[key] = value
		}
	}
	identity, _ := json.Marshal(selection)
	return settingsAuthorityResult(stationeersBepinexSettingsPath, "stationeers-bepinex-authority-v1:"+in.Startup+string(identity)), nil
}
