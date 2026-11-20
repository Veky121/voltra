package gamesettings

import "strings"

const Cs2AuthorityRecipe = "counter_strike/counter_strike_2/egg-counter--strike2.json"

// The campaign loader compares every installed emitted helper byte to this
// exact current recipe before calling here. No standalone helper pins are used.
func cs2CurrentSettingsAuthority(in SettingsAuthorityInput) (SettingsPathAuthority, error) {
	if in.Env["VOLTRA_SOURCE_THIRD"] != "cs2" {
		return SettingsPathAuthority{}, notFound()
	}
	for k, v := range in.Env {
		if v != "" && (strings.HasPrefix(k, "PYTHON") || strings.HasPrefix(k, "LD_") || k == "BASH_ENV" || k == "ENV") {
			return SettingsPathAuthority{}, notFound()
		}
	}
	if root := in.Env["VOLTRA_SERVER_ROOT"]; root != "" && root != "/home/container" {
		return SettingsPathAuthority{}, notFound()
	}
	return settingsAuthorityResult(SourceSettingsPath, in.Startup), nil
}
