package panel

// Pure source contract. Installed modules are supplied by confined Wings reads;
// this does not attest Wine, the interpreter or native configuration consumption.
const conanAuthorityRecipe = "conan_exiles/egg-conan-exiles.json"
const conanAuthorityStartup = "exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/conan_legacy.py run conan"
const conanAuthorityDirectory = "/ConanSandbox/Saved/Config/WindowsServer/"

var conanAuthoritySources = map[string]string{
	".voltra/conan_empires.py":        "48e9f4042e2866405b1920a851982231539a1ebb715aa8aa3375500aa66d9b89",
	".voltra/ark_family.py":           "866b2f39d6e4c7240a94e01a98459f2f6c69b72764dd8b6466f16c546ee09dbe",
	".voltra/native_config.py":        "8c125bb526b38896eeba57143ec2fc70bfb94f1c9783e4c6d652d8f57e3b52a2",
	".voltra/steam_template.py":       "7d908cdc739fbb999fdfb13f48f3e8d3a5fdf26fbfa48091dee1442913078897",
	".voltra/bundle_debian_python.py": "8da05c31a5aeebc8b6096223508a9e7314fc853bf1682ae31da52ec46db11aad",
	".voltra/conan_legacy.py":         "d0e19609b752a66a0ec69f4af89e071f9a2f3a3eaf55df496c13b3d070ee5263",
}

func conanSettingsDocument(file string) bool {
	return file == conanAuthorityDirectory+"ServerSettings.ini" || file == conanAuthorityDirectory+"Engine.ini" || file == conanAuthorityDirectory+"Game.ini"
}
func conanSettingsAuthority(recipe, eggStartup string, in settingsAuthorityInput) (settingsPathAuthority, error) {
	if recipe != conanAuthorityRecipe || eggStartup != conanAuthorityStartup || in.Startup != conanAuthorityStartup || !settingsAuthoritySources(in, conanAuthoritySources) {
		return settingsPathAuthority{}, notFound()
	}
	return settingsAuthorityResult(conanAuthorityDirectory+"ServerSettings.ini", "conan-legacy-authority-v1:"+in.Startup), nil
}
