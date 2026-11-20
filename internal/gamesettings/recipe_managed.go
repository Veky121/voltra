package gamesettings

import "strings"

// Keep allocation-owned listeners out of native settings. These JSON keys are
// case-sensitive and scoped to the exact adapter and document, rather than a
// global denial of ordinary gameplay fields named port or ListenIp.
func RecipeManaged(egg M, file, key string) bool {
	if IsRecipe(egg, FofSettingsRecipe) && file == FofSettingsPath {
		return !strings.EqualFold(key, "mp_timelimit")
	}
	if IsRecipe(egg, ZandronumSettingsRecipe) && file == ZandronumSettingsPath {
		return zandronumStartupManaged(key)
	}
	if among165Recipe(egg) != "" && CampaignParserPathAllowed(egg, file) && !among165Editable(file, key) {
		return true
	}

	if IsRecipe(egg, "beamng/beammp/egg-beam-m-p-server.json") && file == "/ServerConfig.toml" && key == "General/Port" {
		return true
	}
	if ArkEvolvedSettingManaged(egg, file, key) {
		return true
	}
	if IsRecipe(egg, NzPortableSettingsRecipe) {
		return true
	}
	if IsRecipe(egg, NuclearRecipe) && file == NuclearSettingsPath {
		switch key {
		case "/ServerName", "/Password", "/MaxPlayers", "/ModdedServer":
			return false
		}
		return true
	}
	if IsRecipe(egg, SolaceSettingsRecipe) && file == SolaceSettingsDocument {
		switch key {
		case "/name", "/description", "/isPrivate", "/requireSteamID", "/allowAdmin", "/allowModerator", "/maxPlayers", "/autoRestart":
			return false
		}
		return true
	}

	if IsRecipe(egg, GtacSettingsRecipe) || IsRecipe(egg, ClusterioSettingsRecipe) {
		return true
	}
	if IsRecipe(egg, VrisingSettingsRecipe) && vrisingSettingKind(key) == "readonly" {
		return true
	}

	if IsRecipe(egg, "openrct2/egg-openrct2.json") && file == OpenRCT2SettingsPath && key == "network/default_port" {
		return true
	}
	if IsRecipe(egg, RagecoopRecipe) && file == RagecoopPath {
		switch key {
		case "Port", "Name", "MaxPlayers", "AnnounceSelf":
			return true
		}
	}
	if IsRecipe(egg, RomesteadSettingsRecipe) && file == RomesteadSettingsPath && romesteadSettingKinds[key] == "readonly" {
		return true
	}
	if IsRecipe(egg, DstSettingsRecipe) && CampaignParserPathAllowed(egg, file) {
		return strings.HasPrefix(key, "SHARD/") || strings.HasPrefix(key, "STEAM/") || key == "NETWORK/server_port"
	}

	if IsRecipe(egg, VeinSettingsRecipe) && file == VeinSettingsPath && veinSettingManaged(key) {
		return true
	}
	if IsRecipe(egg, Kf2SettingsRecipe) && file == Kf2SettingsWebPath && strings.EqualFold(key, "IpDrv.WebServer/ListenPort") {
		return true
	}

	if IsRecipe(egg, Jc3SettingsRecipe) && file == "/config.json" {
		switch key {
		case "/host", "/bind", "/port", "/queryPort", "/steamPort", "/httpPort":
			return true
		}
	}
	if IsRecipe(egg, PlainsSettingsRecipe) && file == "/configs/server.json" {
		return key == "/port" || key == "/queryPort"
	}

	if file == "/server.properties" && IsRecipe(egg, RisingUnityRecipe) && (strings.EqualFold(key, "Server_Port") || strings.EqualFold(key, "RCON_Port")) {
		return true
	}
	if file == "/server.properties" && IsRecipe(egg, "minecraft/bedrock/bedrock/egg-vanilla-bedrock.json") {
		switch key {
		case "server-name", "gamemode", "difficulty", "allow-cheats", "online-mode", "server-ip", "server-port", "server-portv6", "enable-lan-visibility", "emit-server-telemetry", "transport", "server-udp-ports":
			return true
		}
	}
	if HytaleLayoutSettings(egg) && file == "/Server/config.json" && key == "/Update/Patchline" {
		return true
	}
	if MindustrySettingsManaged(egg, file, key) {
		return true
	}
	if EmpyrionSettingsManaged(egg, file, key) {
		return true
	}
	if file == "/openttd.cfg" && IsRecipe(egg, "openttd/egg-open-t-t-d-server.json") && INIFold(key) == INIFold("network/server_game_type") {
		return true
	}
	if file == VintageStorySettingsPath && IsRecipe(egg, VintageStorySettingsRecipe) {
		if key == "/Port" || key == "/MaxClients" {
			return true
		}
	}
	if ss14SettingsDocument(egg, file) {
		switch INIFold(strings.TrimPrefix(key, "/")) {
		case INIFold("hub/advertise"), INIFold("net/port"), INIFold("status/bind"):
			return true
		}
	}
	if IsRecipe(egg, "minecraft/java/cuberite/egg-cuberite.json") {
		if file == "/settings.ini" && strings.EqualFold(key, "Server/Ports") || file == "/webadmin.ini" && strings.EqualFold(key, "WebAdmin/Ports") {
			return true
		}
	}
	if file == "/ServerSetting.ini" && IsRecipe(egg, "craftopia/egg-craftopia.json") {
		switch INIFold(key) {
		case INIFold("GameWorld/name"), INIFold("Host/port"), INIFold("Save/savePath"):
			return true
		}
	}
	if file == "/Config/Game.ini" && IsRecipe(egg, "citadel/egg-citadel-forged-with-fire.json") {
		switch strings.ToLower(strings.TrimPrefix(key, "/")) {
		case "uworks/connectionport", "uworks/queryport", "script/citadel.socialmanager/password":
			return true
		}
	}
	if strings.HasPrefix(file, "/crewlink/config/") && file == "/crewlink/config/peerConfig.yml" && IsRecipe(egg, "among_us/bettercrewlink_server/egg-better-crewlink-server.json") {
		switch key {
		case "/integratedRelay/enabled", "/integratedRelay/listeningPort", "/integratedRelay/minPort", "/integratedRelay/maxPort", "/integratedRelay/listeningIps", "/integratedRelay/relayIps", "/integratedRelay/externalIps":
			return true
		}
	}
	if file == "/App.cfg" && key == "server_query_port" && IsRecipe(egg, "foundry/egg-foundry.json") {
		return true
	}
	if steamGameID(egg) == "7days" && file == SevenDaysSettingsPath {
		switch key {
		case "TelnetEnabled", "TelnetPort", "TelnetPassword":
			return true
		}
	}
	if file == "/server.config.json" && IsRecipe(egg, "colony_survival/egg-colony-survival.json") {
		switch key {
		case "/NewOptions/WorldName", "/LoadOptions/WorldName", "/ServerSettings/ServerName", "/ServerSettings/MaxPlayerCount", "/ServerSettings/ServerGamePort", "/ServerSettings/ServerIP":
			return true
		}
	}
	if file == "/Archean-data/server/server.ini" && strings.EqualFold(key, "networking/listen_port") && IsRecipe(egg, "Archean/egg-archean.json") {
		return true
	}
	if file == "/cfg/server_cfg.ini" && (IsRecipe(egg, "assetto_corsa/egg-assetto-corsa.json") || IsRecipe(egg, "assetto_corsa/egg-assetto-corsa--freeroam--a-i.json")) {
		switch strings.ToLower(key) {
		case "server/udp_port", "server/tcp_port", "server/http_port":
			return true
		}
	}
	if conanSettingsRuntimeManaged(egg, file, key) {
		return true
	}
	// Seed-once advertised address is native-owned only after exact helper admission.
	if among165Recipe(egg) != "" && CampaignParserPathAllowed(egg, file) {
		if file == "/impostor/config.json" && (key == "/Server/PublicIp" || key == "/Server/PublicPort") {
			return false
		}
	}
	if file == "/impostor/config.json" && IsRecipe(egg, "among_us/impostor_server/egg-among-us--impostor-server.json") {
		// .NET configuration flattens colon-separated keys and binds without case.
		switch INIFold(strings.ReplaceAll(key, ":", "/")) {
		case INIFold("/Server/ListenIp"), INIFold("/Server/ListenPort"),
			INIFold("/HttpServer/ListenIp"), INIFold("/HttpServer/ListenPort"),
			INIFold("/Server/PublicIp"), INIFold("/Server/PublicPort"):
			return true
		}
	}
	return file == "/config.json" && key == "/port" && IsRecipe(egg, "beamng/kissmp/egg-kissmp.json")
}

func conanSettingsRuntimeManaged(egg M, file, key string) bool {
	if !strings.HasPrefix(file, "/ConanSandbox/Saved/Config/") {
		return false
	}
	platform := ""
	if IsRecipe(egg, "conan_exiles/egg-conan-exiles.json") {
		platform = "WindowsServer"
	}
	if IsRecipe(egg, "conan_exiles/egg-conan-exiles-enhanced.json") {
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
