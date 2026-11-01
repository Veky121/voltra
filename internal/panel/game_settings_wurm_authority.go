package panel

import "fmt"

// Root must read confined regular files, repeat authority after its mutation lock,
// compare authority and document revisions, enforce stopped-only writes and existing RBAC.
func wurmSettingsAuthority(recipe, eggStartup string, in settingsAuthorityInput) (settingsPathAuthority, error) {
	refuse := fmt.Errorf("Wurm launcher settings authority unsupported or ambiguous")
	if recipe != wurmSettingsRecipe || eggStartup != wurmOwnerStartup || in.Startup != eggStartup || in.Env["VOLTRA_NATIVE_FAMILY"] != "wurm" {
		return settingsPathAuthority{}, refuse
	}
	if !settingsAuthoritySources(in, map[string]string{
		".voltra/wurm_owner.py":                         "1471851f0ff31a2b015f19df12ad44e6ab1208a88968075e1326e45d56acb580",
		".voltra/stationeers_wurm_starbound_install.py": "67eac9babb2a1471ae39749cdfa8d010a168ec4c302f79676c4932761e2789ba",
		".voltra/native_config.py":                      "8c125bb526b38896eeba57143ec2fc70bfb94f1c9783e4c6d652d8f57e3b52a2",
		".voltra/native_console.py":                     "7f0c2a6e4050d12fc3bb2af9dcd723df6b80109fed91a26ccd1ae52d2bb1b3a4",
		".voltra/steam_template.py":                     "7d908cdc739fbb999fdfb13f48f3e8d3a5fdf26fbfa48091dee1442913078897",
		".voltra/valheim_vrising_install.py":            "df2005c8fc7abdb2f5162811c211541c537caa3d4acede4b024dfa582ee596ba",
	}) {
		return settingsPathAuthority{}, refuse
	}
	data, exists := in.Files["LaunchConfig.ini"]
	if !exists {
		return settingsPathAuthority{}, refuse
	}
	if _, err := parseWurmSettings(data); err != nil {
		return settingsPathAuthority{}, err
	}
	return settingsAuthorityResult(wurmSettingsPath, "wurm-owner-v2:"+in.Startup), nil
}
