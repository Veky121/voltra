package panel

import "context"

// These are only initial environment inputs proved by the named source adapters.
// No native file or secret value is inspected to describe their effect.
var startupSeedKeys = map[string][]string{
	"among_us/impostor_server/egg-among-us--impostor-server.json":  {"PUBLIC_IP", "PUBLIC_PORT"},
	"brickadia/egg-brickadia.json":                                 {"SERVER_NAME", "SERVER_PASSWORD", "SERVER_LIST_PUBLIC"},
	"beamng/beammp/egg-beam-m-p-server.json":                       {"NAME", "DESCRIPTION", "AUTHKEY", "MAP", "PRIVATE", "LOGCHAT", "MAX_PLAYERS", "MAX_CARS", "TAGS", "ALLOW_GUESTS", "INFORMATION_PACKET", "DEBUG", "RESOURCE_FOLDER"},
	"beamng/kissmp/egg-kissmp.json":                               {"SERVER_NAME", "DESCRIPTION", "MAP", "MAX_PLAYERS", "TICKRATE", "MAX_CARS", "PUBLIC_SERVER", "UPNP_ENABLED", "REQUIRE_SCRIPTS"},
	"Archean/egg-archean.json":                                     {"SERVER_NAME", "PASSWORD", "GAME_MODE", "ONLINE_MODE", "MAX_PLAYERS", "SPAWN_PLANET", "WORLD_NAME", "AUTOSAVE_INTERVAL", "UPDATES_PER_SECOND", "PHYSICS_UPDATES_PER_UPDATE"},
	"automobilista2/egg-automobilista2.json":                       {"SERVER_NAME", "SERVER_PASSWORD", "MAX_PLAYERS"},
	"arma/arma3/egg-arma3.json":                                    {"SERVER_NAME", "SERVER_PASSWORD", "ADMIN_PASSWORD", "MAX_PLAYERS", "BATTLEYE", "PERSISTENT", "VERIFY_SIGNATURES", "DISABLE_VON", "VON_CODEC_QUALITY"},
	"arma/arma_reforger/egg-arma-reforger.json":                    {"SERVER_NAME", "SERVER_PASS", "ADMIN_PASS", "MAX_PLAYERS", "SCENARIO_ID", "VISIBLE", "BATTLEYE", "DISABLE_THIRD", "PUBLIC_ADDRESS", "A2S_PORT", "RCON_PORT", "RCON_PASSWORD"},
	"space_engineers/default/egg-space-engineers.json":             {"SERVER_NAME", "WORLD_NAME", "SERVER_DESC", "SERVER_MODE", "MAX_PLAYERS", "SAVE_ENABLED", "SAVE_INTERVAL", "REMOTEAPI_ENABLE", "EXPERIMENTAL_ENABLED", "INGAMESCRIPTS_ENABLED"},
	"space_engineers/torch/egg-space-engineers--torch-server.json": {"SERVER_NAME", "WORLD_NAME", "SERVER_DESC", "SERVER_MODE", "MAX_PLAYERS", "SAVE_ENABLED", "SAVE_INTERVAL", "REMOTEAPI_ENABLE"},
	"gta/openmp/egg-open-m-p.json":                                 {"SERVER_NAME", "MAX_PLAYERS", "SERVER_PASSWORD", "PUBLIC_SERVER", "RCON_PASSWORD", "RCON_ENABLED"},
	"gta/mtasa/egg-multi-theft-auto.json":                          {"SERVER_NAME", "MAX_PLAYERS", "SERVER_PASSWORD"},
	"rimworld/open_world/egg-rimworld-open-world.json":             {"MAX_PLAYERS", "PLAYER_VERSION", "ENFORCE_MODS", "USE_MOD_BLACKLIST", "USE_CUSTOM_DIFF", "WHITELIST", "CUSTOM_SCEN"},
	"rimworld/together/egg-rimworld-together.json":                 {"MAX_PLAYERS", "SERVER_NAME", "VERBOSE", "REGISTER_SERVER", "SERVER_TELEMETRY"},
	"terraria/tmodloader/egg-t-modloader.json":                     {"WORLD_NAME", "WORLD_SIZE", "DIFFICULTY", "MAX_PLAYERS", "SERVER_PASSWORD", "MOTD"},
	"ksp/LMP/egg-k-s-p--l-m-p.json":                                {"SERVER_NAME", "PASSWORD", "ADMIN_PASSWORD", "MaxPlayers", "GameDifficulty", "GameMode", "PUBLIC_LISTING"},
	"mordhau/egg-mordhau.json":                                     {"SERVER_NAME", "GAME_PASSWORD", "ADMIN_PASSWORD", "MAX_PLAYERS"},
	"just_cause/just_cause_3/egg-j-c3-m-p.json":                    {"SERVER_NAME", "SERVER_DESCRIPTION", "SERVER_PASSWORD", "MAX_PLAYER", "TICK_RATE", "PUBLIC_SERVER"},
	"plains_of_pain/egg-plains-of-pain.json":                       {"SERVER_NAME", "WORLD_ID", "MAP_ID", "SEED", "DIFFICULTY", "WORLD_SIZE", "MAX_PLAYERS", "SERVER_PASSWORD"},
	"vein/egg-v-e-i-n.json":                                        {"MAX_PLAYERS", "PUBLIC_SERVER", "SERVER_NAME", "SERVER_PASSWORD"},
	"rising_world/unity/egg-rising-world-unity.json":               {"SRV_NAME", "SRV_PW", "GAME_MODE", "WORLD_NAME", "RCON", "RCON_PASS"},
	"stationeers/stationeers_vanilla/egg-stationeers.json":         {"SERVER_NAME", "SERVER_PASSWD", "AUTOSAVE", "SAVE_INTERVAL", "MAX_PLAYERS", "UPNP"},
	"ground_branch/egg-ground-branch.json":                         {"SERVER_NAME", "MAX_PLAYERS"},
	"dont_starve/egg-don-t-starve-together.json":                   {"GAME_MODE", "MAX_PLAYERS", "PVP", "PAUSE_EMPTY", "CLUSTER_NAME", "CLUSTER_DESC", "CLUSTER_PASSWORD"},
	"enshrouded/egg-enshrouded.json":                               {"SRV_NAME", "MAX_PLAYERS", "GAME_PRESET", "VOICE_CHAT", "TEXT_CHAT", "SRV_PW", "SRV_PW2", "SRV_PW3", "SRV_PW4"},
	"project_zomboid/egg-project-zomboid.json":                     {"MAX_PLAYERS", "PUBLIC_NAME", "SERVER_PASSWORD", "PUBLIC_SERVER", "PVP", "PAUSE_EMPTY", "UPNP"},
	"minecraft/java/cuberite/egg-cuberite.json":                     {"SERV_DESC", "ADMIN_PASS"},
	"openrct2/egg-openrct2.json":                                   {"AUTOSAVE_INTERVAL", "AUTOSAVE_AMOUNT", "MAX_PLAYERS", "SERVER_PLAYER_NAME", "SERVER_PASSWORD", "SERVER_NAME", "SERVER_DESCRIPTION", "SERVER_GREETING", "PROVIDER_NAME", "PROVIDER_EMAIL", "PROVIDER_WEBSITE", "SERVER_ADVERTISE", "PAUSE_NO_CLIENTS", "LOG_CHAT", "LOG_SERVER_ACTIONS", "RCT2_DATA_PATH"},
}

func startupSeedEffect(server, egg M, entry gameTemplate, key string) M {
	install := asMap(asMap(entry.Egg["scripts"])["installation"])
	if str(entry.Egg["startup"]) == "" || str(egg["startup"]) != str(entry.Egg["startup"]) || str(server["startup"]) != str(entry.Egg["startup"]) ||
		str(install["script"]) == "" || str(egg["script_install"]) != str(install["script"]) ||
		str(egg["script_entry"]) != str(install["entrypoint"]) || str(egg["copy_script_from"]) != str(entry.Egg["copy_script_from"]) {
		return nil
	}
	for _, candidate := range startupSeedKeys[entry.Path] {
		if key == candidate {
			return M{"kind": "initial_default"}
		}
	}
	return nil
}

func (a *App) annotateStartupSeedFields(ctx context.Context, server M, variables []M) error {
	egg, err := a.one(ctx, "SELECT * FROM eggs WHERE id=$1", server["egg_id"])
	if err != nil {
		return err
	}
	entry, ok := gameSettingsProfile(egg)
	for _, variable := range variables {
		delete(variable, "effect")
		if ok {
			if effect := startupSeedEffect(server, egg, entry, str(variable["env_variable"])); effect != nil {
				variable["effect"] = effect
			}
		}
	}
	return nil
}
