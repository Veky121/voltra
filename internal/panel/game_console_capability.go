package panel

// Unknown and custom launchers retain command input. Only the reviewed catalog
// launchers whose native child has stdin closed are advertised as logs only.
func serverConsoleInputSupported(server, egg M) bool {
	entry, ok := gameSettingsProfile(egg)
	if !ok || str(server["startup"]) != str(entry.Egg["startup"]) || str(egg["startup"]) != str(entry.Egg["startup"]) {
		return true
	}
	switch entry.Path {
	case "core_keeper/egg-core-keeper.json",
		"valheim/valheim_vanilla/egg-valheim.json",
		"valheim/valheim_bepinex/egg-valheim-bep-i-nex.json",
		"valheim/valheim_plus/egg-valheim-plus-mod.json":
		return false
	}
	return true
}
