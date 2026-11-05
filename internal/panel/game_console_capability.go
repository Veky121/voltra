package panel

// Unknown and custom launchers retain command input. Only the reviewed catalog
// launchers with no reviewed interactive interface are advertised as logs only.
// Nonstock plugins are not covered; custom startup strings retain command input.
func serverConsoleInputSupported(server, egg M) bool {
	entry, ok := gameSettingsProfile(egg)
	if !ok || str(server["startup"]) != str(entry.Egg["startup"]) || str(egg["startup"]) != str(entry.Egg["startup"]) {
		return true
	}
	switch entry.Path {
	case "among_us/bettercrewlink_server/egg-better-crewlink-server.json",
		"among_us/impostor_server/egg-among-us--impostor-server.json",
		"core_keeper/egg-core-keeper.json",
		"valheim/valheim_vanilla/egg-valheim.json",
		"valheim/valheim_bepinex/egg-valheim-bep-i-nex.json",
		"valheim/valheim_plus/egg-valheim-plus-mod.json":
		return false
	}
	return true
}
