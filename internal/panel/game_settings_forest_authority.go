package panel

import "errors"

const forestAuthorityStartup = "exec python3 .voltra/forest-native.py run"

// forestSettingsAuthority admits only the launcher that reads existing native
// values before constructing CLI. -configfilepath selects Path explicitly;
// admin credentials remain in that file and -inittype repeats its native value.
// SERVER_NAME/MAX_PLAYERS/SERVER_PASS/ADMIN_PASS/STEAM_ACC/VAC/INIT_TYPE/
// SERVER_DIFFICULTY are missing-key seeds only. Allocation port keys stay managed.
func forestSettingsAuthority(in settingsAuthorityInput) (settingsPathAuthority, error) {
	refuse := errors.New("Forest settings authority is unsupported or ambiguous")
	if in.Startup != forestAuthorityStartup || !settingsAuthoritySources(in, map[string]string{
		".voltra/forest-native.py":   "00cf0652a7c9a646e8fd1eefc515e8f946f1d1774440ea38a46d5a34db128b35",
		".voltra/forest-survival.py": "ef5196d92181d171daecd550f9cd6c3c90293c149641b272e7a5659d08364f5d",
	}) {
		return settingsPathAuthority{}, refuse
	}
	for _, key := range []string{"CONFIG_FILE", "CONFIG_PATH", "CONFIG_FILEPATH", "SAVE_PATH", "SAVE_FOLDER_PATH", "EXTRA_ARGS", "ADDITIONAL_ARGS"} {
		if in.Env[key] != "" {
			return settingsPathAuthority{}, refuse
		}
	}
	if v := in.Env["SRCDS_APPID"]; v != "" && v != "556450" {
		return settingsPathAuthority{}, refuse
	}
	if v := in.Env["WINDOWS_INSTALL"]; v != "" && v != "1" {
		return settingsPathAuthority{}, refuse
	}
	return settingsAuthorityResult("/TheForestDedicatedServer_Data/forest/config/config.cfg", "forest-authority-v1:"+in.Startup), nil
}
