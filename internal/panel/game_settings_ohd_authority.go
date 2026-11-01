package panel

import "errors"

// Pure root integration hook. Caller supplies confined regular-file snapshots,
// checks permissions, and repeats authority/revision checks under the write lock.
func ohdSettingsAuthority(recipe, eggStartup string, in settingsAuthorityInput) (settingsPathAuthority, error) {
	refuse := errors.New("OHD native settings authority is unsupported or ambiguous")
	if recipe != ohdSettingsRecipe || eggStartup != ohdSettingsStartup || in.Startup != eggStartup || !settingsAuthoritySources(in, ohdSettingsSources) {
		return settingsPathAuthority{}, refuse
	}
	data, ok := in.Files[ohdSettingsPath[1:]]
	if !ok {
		return settingsPathAuthority{}, refuse
	}
	if _, err := parseOHDSettings(data); err != nil {
		return settingsPathAuthority{}, err
	}
	return settingsAuthorityResult(ohdSettingsPath, "ohd-wave30:"+recipe+":"+in.Startup), nil
}

var ohdSettingsSources = map[string]string{
	".voltra/vr_tower_ohd.py":            "1a9a3f7557159780ad45e23b7b316454e31004d69296591660124d5ea6df2818",
	".voltra/vr-tower-ohd-releases.json": "205e427c0f9030b4052409befb6de911821187f5663554adb0f6723e58d1239c",
	".voltra/ark_family.py":              "866b2f39d6e4c7240a94e01a98459f2f6c69b72764dd8b6466f16c546ee09dbe",
	".voltra/native_config.py":           "8c125bb526b38896eeba57143ec2fc70bfb94f1c9783e4c6d652d8f57e3b52a2",
	".voltra/native_console.py":          "7f0c2a6e4050d12fc3bb2af9dcd723df6b80109fed91a26ccd1ae52d2bb1b3a4",
	".voltra/steam_template.py":          "7d908cdc739fbb999fdfb13f48f3e8d3a5fdf26fbfa48091dee1442913078897",
	".voltra/bundle_debian_python.py":    "8da05c31a5aeebc8b6096223508a9e7314fc853bf1682ae31da52ec46db11aad",
	".voltra/ohd_runtime.py":             "1a1484af1d61d2de27f7d3e75b55f13b9f584557a2f1025fb4ed3748db8fc1c6",
}
