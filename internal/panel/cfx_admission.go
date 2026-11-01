package panel

import "strconv"

// Cfx capacity is dependent on the selected game, rather than a per-field rule.
func validateCfxRecipeEnvironment(recipe string, env M) error {
	if recipe != fiveMRecipe || eggEnvironmentString(env["TXHOST_GAME_NAME"]) != "redm" {
		return nil
	}
	slots, err := strconv.Atoi(eggEnvironmentString(env["MAX_PLAYERS"]))
	if err != nil || slots < 1 || slots > 32 {
		return bad("RedM requires MAX_PLAYERS between 1 and 32. Choose a valid capacity explicitly before selecting RedM.")
	}
	return nil
}
func validateCfxEnvironment(egg M, env M) error {
	if !nativeSettingsIsRecipe(egg, fiveMRecipe) {
		return nil
	}
	return validateCfxRecipeEnvironment(fiveMRecipe, env)
}
