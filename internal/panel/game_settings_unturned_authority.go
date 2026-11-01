package panel

import (
	"errors"
	"regexp"
)

const unturnedSettingsRecipe = "unturned/egg-unturned.json"
const unturnedSettingsStartup = "exec bash .voltra/unturned-entry.sh"

var unturnedSettingsIdentity = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)

// unturnedSettingsAuthority uses ordinary confined Wings file snapshots. It does
// not grant permissions or prove native consumption. Re-resolve after the shared
// settings lock and compare both this revision and the document revision.
func unturnedSettingsAuthority(recipe, eggStartup string, in settingsAuthorityInput) (settingsPathAuthority, error) {
	refuse := errors.New("Unturned settings authority is unsupported or ambiguous")
	if recipe != unturnedSettingsRecipe || eggStartup != unturnedSettingsStartup || in.Startup != eggStartup || !settingsAuthoritySources(in, unturnedSettingsSources) {
		return settingsPathAuthority{}, refuse
	}
	// Match configure(): only absence uses the default; an explicit empty ID fails.
	identity, ok := in.Env["SRV_ID"]
	if !ok {
		identity = "PterodactylUnturned"
	}
	if !unturnedSettingsIdentity.MatchString(identity) {
		return settingsPathAuthority{}, refuse
	}
	file := "Servers/" + identity + "/Server/Commands.dat"
	data, exists := in.Files[file]
	if !exists {
		return settingsPathAuthority{}, refuse
	}
	if _, err := parseUnturnedCommandsSettings(data); err != nil {
		return settingsPathAuthority{}, err
	}
	return settingsAuthorityResult("/"+file, "unturned-authority-v1:"+recipe+":"+in.Startup+":"+identity), nil
}

var unturnedSettingsSources = map[string]string{
	".voltra/unturned-entry.sh":   "64e62401d4f012cc9a264638857af0a3d91304054d694c4e93b2466038d9d9a9",
	".voltra/unturned_runtime.py": "d97f9f31be8d7935847696b4caf40ce13a3f4fd093254fba370450ab4431a01a",
}
