package panel

import "strings"

const cs2AuthorityRecipe = "counter_strike/counter_strike_2/egg-counter--strike2.json"

// The campaign loader compares every installed emitted helper byte to this
// exact current recipe before calling here. No standalone helper pins are used.
func cs2CurrentSettingsAuthority(in settingsAuthorityInput) (settingsPathAuthority, error) {
	if in.Env["VOLTRA_SOURCE_THIRD"] != "cs2" {
		return settingsPathAuthority{}, notFound()
	}
	for k, v := range in.Env {
		if v != "" && (strings.HasPrefix(k, "PYTHON") || strings.HasPrefix(k, "LD_") || k == "BASH_ENV" || k == "ENV") {
			return settingsPathAuthority{}, notFound()
		}
	}
	if root := in.Env["VOLTRA_SERVER_ROOT"]; root != "" && root != "/home/container" {
		return settingsPathAuthority{}, notFound()
	}
	return settingsAuthorityResult(sourceSettingsPath, in.Startup), nil
}
