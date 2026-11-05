package panel

import "strings"

// Keep allocation-owned listeners out of native settings. These JSON keys are
// case-sensitive and scoped to the exact adapter and document, rather than a
// global denial of ordinary gameplay fields named port or ListenIp.
func gameSettingsRecipeManaged(egg M, file, key string) bool {
	if nativeSettingsIsRecipe(egg, fofSettingsRecipe) && file == fofSettingsPath {
		return !strings.EqualFold(key, "mp_timelimit")
	}
	if nativeSettingsIsRecipe(egg, zandronumSettingsRecipe) && file == zandronumSettingsPath {
		return zandronumStartupManaged(key)
	}
	if among165Recipe(egg) != "" && campaignParserPathAllowed(egg, file) && !among165Editable(file, key) {
		return true
	}

	if nativeSettingsIsRecipe(egg, "beamng/beammp/egg-beam-m-p-server.json") && file == "/ServerConfig.toml" && key == "General/Port" {
		return true
	}
	if wave85ASEManaged(egg, file, key) {
		return true
	}
	if nativeSettingsIsRecipe(egg, nzPortableSettingsRecipe) {
		return true
	}
	if nativeSettingsIsRecipe(egg, nuclearRecipe) && file == nuclearSettingsPath {
		switch key {
		case "/ServerName", "/Password", "/MaxPlayers", "/ModdedServer":
			return false
		}
		return true
	}
	if nativeSettingsIsRecipe(egg, solaceSettingsRecipe) && file == solaceSettingsDocument {
		switch key {
		case "/name", "/description", "/isPrivate", "/requireSteamID", "/allowAdmin", "/allowModerator", "/maxPlayers", "/autoRestart":
			return false
		}
		return true
	}

	if nativeSettingsIsRecipe(egg, gtacSettingsRecipe) || nativeSettingsIsRecipe(egg, clusterioSettingsRecipe) {
		return true
	}
	if nativeSettingsIsRecipe(egg, vrisingSettingsRecipe) && vrisingSettingKind(key) == "readonly" {
		return true
	}

	if nativeSettingsIsRecipe(egg, "openrct2/egg-openrct2.json") && file == openRCT2SettingsPath && key == "network/default_port" {
		return true
	}
	if nativeSettingsIsRecipe(egg, ragecoopRecipe) && file == ragecoopPath {
		switch key {
		case "Port", "Name", "MaxPlayers", "AnnounceSelf":
			return true
		}
	}
	if nativeSettingsIsRecipe(egg, romesteadSettingsRecipe) && file == romesteadSettingsPath && romesteadSettingKinds[key] == "readonly" {
		return true
	}
	if nativeSettingsIsRecipe(egg, dstSettingsRecipe) && campaignParserPathAllowed(egg, file) {
		return strings.HasPrefix(key, "SHARD/") || strings.HasPrefix(key, "STEAM/") || key == "NETWORK/server_port"
	}

	if nativeSettingsIsRecipe(egg, veinSettingsRecipe) && file == veinSettingsPath && veinSettingManaged(key) {
		return true
	}
	if nativeSettingsIsRecipe(egg, kf2SettingsRecipe) && file == kf2SettingsWebPath && strings.EqualFold(key, "IpDrv.WebServer/ListenPort") {
		return true
	}

	if nativeSettingsIsRecipe(egg, jc3SettingsRecipe) && file == "/config.json" {
		switch key {
		case "/host", "/bind", "/port", "/queryPort", "/steamPort", "/httpPort":
			return true
		}
	}
	if nativeSettingsIsRecipe(egg, plainsSettingsRecipe) && file == "/configs/server.json" {
		return key == "/port" || key == "/queryPort"
	}

	if file == "/server.properties" && nativeSettingsIsRecipe(egg, risingUnityRecipe) && (strings.EqualFold(key, "Server_Port") || strings.EqualFold(key, "RCON_Port")) {
		return true
	}
	if file == "/server.properties" && nativeSettingsIsRecipe(egg, "minecraft/bedrock/bedrock/egg-vanilla-bedrock.json") {
		switch key {
		case "server-name", "gamemode", "difficulty", "allow-cheats", "online-mode", "server-ip", "server-port", "server-portv6", "enable-lan-visibility", "emit-server-telemetry", "transport", "server-udp-ports":
			return true
		}
	}
	if hytaleLayoutSettings(egg) && file == "/Server/config.json" && key == "/Update/Patchline" {
		return true
	}
	if mindustrySettingsManaged(egg, file, key) {
		return true
	}
	if empyrionSettingsManaged(egg, file, key) {
		return true
	}
	if file == "/openttd.cfg" && nativeSettingsIsRecipe(egg, "openttd/egg-open-t-t-d-server.json") && gameSettingsINIFold(key) == gameSettingsINIFold("network/server_game_type") {
		return true
	}
	if file == vintageStorySettingsPath && nativeSettingsIsRecipe(egg, vintageStorySettingsRecipe) {
		if key == "/Port" || key == "/MaxClients" {
			return true
		}
	}
	if ss14SettingsDocument(egg, file) {
		switch gameSettingsINIFold(strings.TrimPrefix(key, "/")) {
		case gameSettingsINIFold("hub/advertise"), gameSettingsINIFold("net/port"), gameSettingsINIFold("status/bind"):
			return true
		}
	}
	if nativeSettingsIsRecipe(egg, "minecraft/java/cuberite/egg-cuberite.json") {
		if file == "/settings.ini" && strings.EqualFold(key, "Server/Ports") || file == "/webadmin.ini" && strings.EqualFold(key, "WebAdmin/Ports") {
			return true
		}
	}
	if file == "/ServerSetting.ini" && nativeSettingsIsRecipe(egg, "craftopia/egg-craftopia.json") {
		switch gameSettingsINIFold(key) {
		case gameSettingsINIFold("GameWorld/name"), gameSettingsINIFold("Host/port"), gameSettingsINIFold("Save/savePath"):
			return true
		}
	}
	if file == "/Config/Game.ini" && nativeSettingsIsRecipe(egg, "citadel/egg-citadel-forged-with-fire.json") {
		switch strings.ToLower(strings.TrimPrefix(key, "/")) {
		case "uworks/connectionport", "uworks/queryport", "script/citadel.socialmanager/password":
			return true
		}
	}
	if strings.HasPrefix(file, "/crewlink/config/") && file == "/crewlink/config/peerConfig.yml" && nativeSettingsIsRecipe(egg, "among_us/bettercrewlink_server/egg-better-crewlink-server.json") {
		switch key {
		case "/integratedRelay/enabled", "/integratedRelay/listeningPort", "/integratedRelay/minPort", "/integratedRelay/maxPort", "/integratedRelay/listeningIps", "/integratedRelay/relayIps", "/integratedRelay/externalIps":
			return true
		}
	}
	if file == "/App.cfg" && key == "server_query_port" && nativeSettingsIsRecipe(egg, "foundry/egg-foundry.json") {
		return true
	}
	if steamGameID(egg) == "7days" && file == sevenDaysSettingsPath {
		switch key {
		case "TelnetEnabled", "TelnetPort", "TelnetPassword":
			return true
		}
	}
	if file == "/server.config.json" && nativeSettingsIsRecipe(egg, "colony_survival/egg-colony-survival.json") {
		switch key {
		case "/NewOptions/WorldName", "/LoadOptions/WorldName", "/ServerSettings/ServerName", "/ServerSettings/MaxPlayerCount", "/ServerSettings/ServerGamePort", "/ServerSettings/ServerIP":
			return true
		}
	}
	if file == "/Archean-data/server/server.ini" && strings.EqualFold(key, "networking/listen_port") && nativeSettingsIsRecipe(egg, "Archean/egg-archean.json") {
		return true
	}
	if file == "/cfg/server_cfg.ini" && (nativeSettingsIsRecipe(egg, "assetto_corsa/egg-assetto-corsa.json") || nativeSettingsIsRecipe(egg, "assetto_corsa/egg-assetto-corsa--freeroam--a-i.json")) {
		switch strings.ToLower(key) {
		case "server/udp_port", "server/tcp_port", "server/http_port":
			return true
		}
	}
	if conanSettingsRuntimeManaged(egg, file, key) {
		return true
	}
	// Seed-once advertised address is native-owned only after exact helper admission.
	if among165Recipe(egg) != "" && campaignParserPathAllowed(egg, file) {
		if file == "/impostor/config.json" && (key == "/Server/PublicIp" || key == "/Server/PublicPort") {
			return false
		}
	}
	if file == "/impostor/config.json" && nativeSettingsIsRecipe(egg, "among_us/impostor_server/egg-among-us--impostor-server.json") {
		// .NET configuration flattens colon-separated keys and binds without case.
		switch gameSettingsINIFold(strings.ReplaceAll(key, ":", "/")) {
		case gameSettingsINIFold("/Server/ListenIp"), gameSettingsINIFold("/Server/ListenPort"),
			gameSettingsINIFold("/HttpServer/ListenIp"), gameSettingsINIFold("/HttpServer/ListenPort"),
			gameSettingsINIFold("/Server/PublicIp"), gameSettingsINIFold("/Server/PublicPort"):
			return true
		}
	}
	return file == "/config.json" && key == "/port" && nativeSettingsIsRecipe(egg, "beamng/kissmp/egg-kissmp.json")
}

func conanSettingsRuntimeManaged(egg M, file, key string) bool {
	if !strings.HasPrefix(file, "/ConanSandbox/Saved/Config/") {
		return false
	}
	platform := ""
	if nativeSettingsIsRecipe(egg, "conan_exiles/egg-conan-exiles.json") {
		platform = "WindowsServer"
	}
	if nativeSettingsIsRecipe(egg, "conan_exiles/egg-conan-exiles-enhanced.json") {
		platform = "LinuxServer"
	}
	if platform == "" {
		return false
	}
	prefix := "/ConanSandbox/Saved/Config/" + platform + "/"
	if !strings.HasPrefix(file, prefix) {
		return false
	}
	key = strings.ToLower(strings.TrimPrefix(key, "/"))
	switch strings.TrimPrefix(file, prefix) {
	case "Engine.ini":
		switch key {
		case "url/port", "onlinesubsystem/servername", "onlinesubsystem/serverpassword", "onlinesubsystemnull/gameserverqueryport":
			return true
		}
	case "ServerSettings.ini":
		return key == "serversettings/adminpassword" || key == "serversettings/serverpassword"
	case "Game.ini":
		switch key {
		case "rconplugin/rconenabled", "rconplugin/rconpassword", "rconplugin/rconport":
			return true
		}
		return platform == "LinuxServer" && key == "script/engine.gamesession/maxplayers"
	}
	return false
}
