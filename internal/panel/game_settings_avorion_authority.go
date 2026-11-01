package panel

import (
	"errors"
	"strings"
)

// Pure proposal for root dispatch. Files must be fresh confined regular-file
// snapshots as described by settingsAuthorityInput. Never synthesizes server.ini.
func avorionSettingsAuthority(recipe, eggStartup string, in settingsAuthorityInput) (settingsPathAuthority, error) {
	refuse := errors.New("Avorion native settings authority is unsupported or ambiguous")
	if recipe != avorionSettingsRecipe || eggStartup != avorionSettingsStartup || in.Startup != eggStartup || !settingsAuthoritySources(in, avorionSettingsSources) {
		return settingsPathAuthority{}, refuse
	}
	galaxy, ok := in.Env["GALAXY_NAME"]
	if !ok {
		galaxy = "Avorion"
	}
	if galaxy == "" || galaxy == "." || galaxy == ".." || len(galaxy) > 32 || strings.ContainsAny(galaxy, "/\\") {
		return settingsPathAuthority{}, refuse
	}
	for _, c := range galaxy {
		if c < 32 || c == 127 {
			return settingsPathAuthority{}, refuse
		}
	}
	file := "galaxy/" + galaxy + "/server.ini"
	data, exists := in.Files[file]
	if !exists {
		return settingsPathAuthority{}, refuse
	}
	if _, err := parseAvorionSettings(data); err != nil {
		return settingsPathAuthority{}, err
	}
	return settingsAuthorityResult("/"+file, "avorion-native-config-v1:"+recipe+":"+in.Startup+":"+galaxy), nil
}

const avorionSettingsStartup = "exec env VOLTRA_NATIVE_LIBRARY_PATH=\"$LD_LIBRARY_PATH\" PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/avorion_runtime.py"

var avorionSettingsSources = map[string]string{
	".voltra/steam_template.py":              "7d908cdc739fbb999fdfb13f48f3e8d3a5fdf26fbfa48091dee1442913078897",
	".voltra/bundle_debian_python.py":        "8da05c31a5aeebc8b6096223508a9e7314fc853bf1682ae31da52ec46db11aad",
	".voltra/additional_survival_install.py": "aa891c7f0afc1c492480b76caa8f4c63cdd288aa2cac057ba25be109de483c4d",
	".voltra/native_console.py":              "7f0c2a6e4050d12fc3bb2af9dcd723df6b80109fed91a26ccd1ae52d2bb1b3a4",
	".voltra/strategy_survival_install.py":   "80626d7286fc5691da935fda780f0be8606828bb33890bfb487143803d10dcd2",
	".voltra/avorion_runtime.py":             "f0b667c18dc0bf0eba48f1449587c9d2cfb3b350d20d53899893ccd96fecb32c",
	".voltra/private_nss.py":                 "17d933368c7e165521050b4b68cc9e72a134b4eea0784572a22e41d10900b16e",
}
