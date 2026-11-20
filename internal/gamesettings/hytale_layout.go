package gamesettings

import "strings"

// Require the actual new launcher as well as recipe identity. Old installed
// publisher launchers still use their prior layout and have not been upgraded.
func HytaleLayoutSettings(egg M) bool {
	return IsRecipe(egg, "hytale/egg-hytale.json") && strings.HasSuffix(str(egg["startup"]), " .voltra/hytale_runtime.py")
}
