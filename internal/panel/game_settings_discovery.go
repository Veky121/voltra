package panel

import (
	"encoding/json"
	"path"
	"sort"
	"strings"
)

// Discovery metadata is presentation-only. UUID matches take precedence; exact
// startup fallback must be unique across the entire catalog, including profiles
// with no declarations. Display names never establish authority.
func gameSettingsProfile(egg M) (gameTemplate, bool) {
	if snapshot, ok := egg[gameSettingsProfileSnapshotKey].(gameSettingsProfileSnapshot); ok && snapshot.uuid == str(egg["uuid"]) && snapshot.startup == str(egg["startup"]) {
		return snapshot.entry, snapshot.found
	}
	return gameSettingsProfileFrom(egg, gameTemplates().Entries)
}
func gameSettingsProfileFrom(egg M, entries []gameTemplate) (gameTemplate, bool) {
	for _, entry := range entries {
		if str(egg["uuid"]) == gameTemplateEggUUID(entry) {
			return entry, true
		}
	}
	var match gameTemplate
	count := 0
	for _, entry := range entries {
		if startup := str(egg["startup"]); startup != "" && startup == str(entry.Egg["startup"]) {
			match = entry
			count++
		}
	}
	return match, count == 1
}

func safeSettingsDocument(file string) bool {
	if file == "" || strings.HasPrefix(file, "/") || strings.ContainsAny(file, "\\\x00\r\n{}*?[]:$") || path.Clean(file) != file {
		return false
	}
	for _, part := range strings.Split(file, "/") {
		lower := strings.ToLower(part)
		if part == "." || part == ".." || strings.HasPrefix(lower, "mod") || strings.HasPrefix(lower, "plugin") {
			return false
		}
	}
	_, err := quickPathParts("/" + file)
	return err == nil
}
func gameSettingsDeclaredDocuments(egg M) []string {
	if nativeSettingsIsRecipe(egg, tshockAuthorityRecipe) || nativeSettingsIsRecipe(egg, tshockLegacyAuthorityRecipe) {
		if str(egg["_campaign_parser_path"]) != "" {
			return []string{"/serverconfig.txt", "/tshock/config.json"}
		}
		return nil
	}
	if campaignParserRecipe(egg) != "" {
		if p := str(egg["_campaign_parser_path"]); p != "" {
			if nativeSettingsIsRecipe(egg, conanAuthorityRecipe) {
				return []string{p, conanAuthorityDirectory + "Engine.ini", conanAuthorityDirectory + "Game.ini"}
			}
			if nativeSettingsIsRecipe(egg, "arma/arma3/egg-arma3.json") {
				return []string{"/server.cfg", "/basic.cfg"}
			}
			if nativeSettingsIsRecipe(egg, kspLMPRecipe) {
				return finalLMPDocuments()
			}
			if nativeSettingsIsRecipe(egg, dstSettingsRecipe) {
				base := strings.TrimSuffix(p, "/cluster.ini")
				return []string{p, base + "/Master/server.ini", base + "/Caves/server.ini"}
			}
			if nativeSettingsIsRecipe(egg, kf2SettingsRecipe) {
				return []string{kf2SettingsGamePath, kf2SettingsWebPath}
			}
			if nativeSettingsIsRecipe(egg, "renown/egg-renown.json") {
				return []string{p, renownSettingsDirectory + "Engine.ini"}
			}
			return []string{p}
		}
		return nil
	}
	if p, _ := integratedScalarSettings(egg); p != "" {
		if integratedScalarDocument(egg, p) {
			return []string{p}
		}
		return nil
	}
	if p, _ := reviewedNewSettings(egg); p != "" {
		if reviewedNewDocument(egg, p) {
			return []string{p}
		}
		return nil
	}

	entry, ok := gameSettingsProfile(egg)
	if !ok {
		return nil
	}
	if openraSettingsStartup(egg) != "" {
		if openraSettingsDocument(egg, openraSettingsPath) {
			return []string{openraSettingsPath}
		}
		return nil
	}
	if entry.Path == "factorio/factorio/egg-factorio.json" && str(egg["startup"]) != "exec bash .voltra/factorio-native-start.sh" {
		return nil
	}
	if openraSettingsStartup(egg) != "" && !openraSettingsDocument(egg, openraSettingsPath) {
		return nil
	}
	if entry.Path == etlegacySettingsRecipe && !etlegacySettingsDocument(egg, etlegacySettingsPath) {
		return nil
	}
	if entry.Path == hl2dmSettingsRecipe && !hl2dmSettingsDocument(egg, hl2dmSettingsPath) {
		return nil
	}
	if entry.Path == quakeLiveSettingsRecipe {
		if file := str(egg["_quakelive_settings_path"]); file != "" {
			return []string{file}
		}
		return nil
	}
	out := []string{}
	if file := bananaSelectedSettingsDocument(egg); file != "" {
		out = append(out, file)
	}
	for _, file := range entry.SettingsDocuments {
		if soldatSettingsRecipe(egg) && !soldatSettingsDocument(egg, "/"+file) {
			continue
		}
		if entry.Path == openArenaSettingsRecipe && "/"+file != openArenaSelectedSettingsDocument(egg) {
			continue
		}
		if safeSettingsDocument(file) {
			out = append(out, "/"+file)
		}
	}
	return out
}

// Eco's two adapter-owned documents are proven JSON. This does not authorize
// arbitrary .eco files, even on an Eco server.
func declaredEcoJSON(egg M, file string) bool {
	entry, ok := gameSettingsProfile(egg)
	if !ok || entry.Path != "eco/egg-eco.json" {
		return false
	}
	if file != "/Configs/Network.eco" && file != "/Configs/Localization.eco" {
		return false
	}
	for _, declared := range gameSettingsDeclaredDocuments(egg) {
		if declared == file {
			return true
		}
	}
	return false
}
func gameSettingsDiscoveryFormat(egg M, file string) string {
	if campaignParserRecipe(egg) != "" {
		if campaignParserPathAllowed(egg, file) {
			return "reviewed"
		}
		return ""
	}
	if p, _ := integratedScalarSettings(egg); p != "" {
		if integratedScalarDocument(egg, file) {
			return "reviewed"
		}
		return ""
	}
	if campaignParserRecipe(egg) == "" && (wave12UnprovenSettings(egg) || wave13UnprovenSettings(egg)) {
		return ""
	}
	if p, _ := reviewedNewSettings(egg); p != "" {
		if reviewedNewDocument(egg, file) {
			return "reviewed"
		}
		return ""
	}

	if hl2dmSettingsDocument(egg, file) {
		return "source"
	}
	if file == hl2dmSettingsPath && nativeSettingsIsRecipe(egg, hl2dmSettingsRecipe) {
		return ""
	}
	if nativeSettingsIsRecipe(egg, quakeLiveSettingsRecipe) && (file == quakeLiveBaseSettingsPath || file == quakeLiveHomeSettingsPath) {
		if file == str(egg["_quakelive_settings_path"]) {
			return "source"
		}
		return ""
	}
	if etlegacySettingsDocument(egg, file) {
		return "source"
	}
	if file == etlegacySettingsPath && nativeSettingsIsRecipe(egg, etlegacySettingsRecipe) {
		return ""
	}
	if openraSettingsDocument(egg, file) {
		return "openra"
	}
	if file == openraSettingsPath && (openraSettingsStartup(egg) != "") {
		return ""
	}
	if file == luantiSettingsPath && nativeSettingsIsRecipe(egg, "minetest/egg-minetest.json") {
		return "luanti"
	}
	if nativeSettingsIsRecipe(egg, openArenaSettingsRecipe) && (file == openArenaBaseSettingsPath || file == openArenaMissionSettingsPath) {
		if openArenaSettingsDocument(egg, file) {
			return "source"
		}
		return ""
	}
	if file == xonoticSettingsPath && nativeSettingsIsRecipe(egg, "xonotic/egg-xonotic.json") {
		return "source"
	}
	if mindustrySettingsDocument(egg, file) {
		return "mindustry"
	}
	if file == goldSrcCS16SettingsPath && nativeSettingsIsRecipe(egg, "counter_strike/counter_strike_1.6/egg-counter-strike1-6--vanilla.json") {
		return "source"
	}
	if file == cssSettingsPath && nativeSettingsIsRecipe(egg, "counter_strike/counter_strike_source/egg-counter--strike--source.json") {
		return "source"
	}
	if file == teeworldsSettingsPath && nativeSettingsIsRecipe(egg, "teeworlds/egg-teeworlds.json") {
		return "teeworlds"
	}
	if file == tachyonSettingsPath && nativeSettingsIsRecipe(egg, "ftl_tachyon/egg-tachyon.json") {
		return "ini"
	}
	if file == ddnetSettingsPath && nativeSettingsIsRecipe(egg, "ddnet/egg-d-d-net.json") {
		return "ddnet"
	}
	if kind := cubeGameSettingsKind(egg, file); kind != "" {
		return "cube"
	}
	if file == carrierSettingsPath && nativeSettingsIsRecipe(egg, "carrier_command_2/egg-carrier-command2.json") {
		return "xml"
	}
	if file == cryofallSettingsPath && nativeSettingsIsRecipe(egg, "cryofall/egg-cryo-fall.json") {
		return "xml"
	}
	if cubicSettingsDocument(egg, file) {
		return "cubic"
	}
	if declaredEcoJSON(egg, file) {
		return "json"
	}
	if nativeSettingsIsRecipe(egg, "barotrauma/egg-barotrauma.json") && file == "/serversettings.xml" {
		return "xml"
	}
	if nativeSettingsIsRecipe(egg, "Aska/egg-aska.json") && file == "/server properties.txt" {
		return "ini"
	}
	entry, ok := gameSettingsProfile(egg)
	if ok {
		// Executable console CFG and HOCON need dedicated parsers. Keep Files access.
		if entry.Path == "ddnet/egg-d-d-net.json" || entry.Path == "foundry/egg-foundry.json" && file != "/App.cfg" {
			return ""
		}
		if entry.Path == "minecraft/java/spongevanilla/egg-sponge-vanilla.json" && strings.HasSuffix(file, ".conf") {
			return ""
		}
	}
	return gameSettingsFormat(file)
}
func parseDiscoveredGameSettings(egg M, file string, data []byte) (gameSettingsParsed, error) {
	if nativeSettingsIsRecipe(egg, zandronumSettingsRecipe) {
		if file != zandronumSettingsPath || !campaignParserPathAllowed(egg, file) {
			return gameSettingsParsed{}, notFound()
		}
		return parseZandronumSettings(data)
	}
	if nativeSettingsIsRecipe(egg, starmadeSettingsRecipe) {
		if file != starmadeSettingsPath || !campaignParserPathAllowed(egg, file) {
			return gameSettingsParsed{}, notFound()
		}
		return parseStarmadeSettings(data)
	}
	if nativeSettingsIsRecipe(egg, coreKeeperSettingsRecipe) {
		if file != coreKeeperSettingsPath || !campaignParserPathAllowed(egg, file) {
			return gameSettingsParsed{}, notFound()
		}
		return parseCoreKeeperSettings(data)
	}
	if nativeSettingsIsRecipe(egg, necesseSettingsRecipe) {
		if file != necesseSettingsPath || !campaignParserPathAllowed(egg, file) {
			return gameSettingsParsed{}, notFound()
		}
		return parseNecesseSettings(data)
	}
	if nativeSettingsIsRecipe(egg, urbanTerrorSettingsRecipe) {
		if file != urbanTerrorSettingsPath || !campaignParserPathAllowed(egg, file) {
			return gameSettingsParsed{}, notFound()
		}
		return parseUrbanTerrorSettings(data)
	}

	if nativeSettingsIsRecipe(egg, srb2SettingsRecipe) {
		if file != srb2SettingsPath || !campaignParserPathAllowed(egg, file) {
			return gameSettingsParsed{}, notFound()
		}
		return parseSRB2Settings(data)
	}
	if nativeSettingsIsRecipe(egg, "brickadia/egg-brickadia.json") {
		if !campaignParserPathAllowed(egg, file) {
			return gameSettingsParsed{}, notFound()
		}
		return parseBrickadia(file, data)
	}
	if nativeSettingsIsRecipe(egg, archeanRepairRecipe) {
		if !campaignParserPathAllowed(egg, file) {
			return gameSettingsParsed{}, notFound()
		}
		return parseArcheanRepairSettings(file, data)
	}
	if assettoSettingsRecipe(egg) {
		if !campaignParserPathAllowed(egg, file) {
			return gameSettingsParsed{}, notFound()
		}
		return parseAssettoSettings(egg, data)
	}
	if nativeSettingsIsRecipe(egg, tshockAuthorityRecipe) || nativeSettingsIsRecipe(egg, tshockLegacyAuthorityRecipe) {
		if !campaignParserPathAllowed(egg, file) {
			return gameSettingsParsed{}, notFound()
		}
		p, e := parseGameSettings(file, data)
		if e == nil && nativeSettingsIsRecipe(egg, tshockAuthorityRecipe) {
			p = tshockNativeSettingsSafety(file, p)
		}
		return p, e
	}
	if nativeSettingsIsRecipe(egg, conanAuthorityRecipe) {
		if !campaignParserPathAllowed(egg, file) {
			return gameSettingsParsed{}, notFound()
		}
		return parseGameSettings(file, data)
	}
	if nativeSettingsIsRecipe(egg, hl2dmSettingsRecipe) {
		if !campaignParserPathAllowed(egg, file) {
			return gameSettingsParsed{}, notFound()
		}
		return parseHL2DMSettings(data)
	}
	if nativeSettingsIsRecipe(egg, cs2AuthorityRecipe) {
		if !campaignParserPathAllowed(egg, file) {
			return gameSettingsParsed{}, notFound()
		}
		return parseSourceSettings(data)
	}
	if nativeSettingsIsRecipe(egg, fiveMRecipe) {
		if !campaignParserPathAllowed(egg, file) {
			return gameSettingsParsed{}, notFound()
		}
		return parseFiveMSettings(data)
	}
	if nativeSettingsIsRecipe(egg, reforgerSettingsRecipe) {
		if !campaignParserPathAllowed(egg, file) {
			return gameSettingsParsed{}, notFound()
		}
		ports := []int{}
		for _, port := range asSlice(egg["_reforger_allocated_ports"]) {
			ports = append(ports, int(num(port)))
		}
		return parseReforgerSettings(data, int(num(egg["_reforger_primary_port"])), ports)
	}
	if nativeSettingsIsRecipe(egg, "arma/arma3/egg-arma3.json") {
		if !campaignParserPathAllowed(egg, file) {
			return gameSettingsParsed{}, notFound()
		}
		return parseArmaSettings(data)
	}

	if recipe := campaignParserRecipe(egg); finalFiveRecipe(recipe) {
		if !campaignParserPathAllowed(egg, file) {
			return gameSettingsParsed{}, notFound()
		}
		switch recipe {
		case "gta/openmp/egg-open-m-p.json":
			return parseOpenMPNativeSettings(data)
		case "gta/mtasa/egg-multi-theft-auto.json":
			return parseMTANativeSettings(data)
		case kspLMPRecipe:
			return parseKspLMPSettings(file, data)
		default:
			return parseRimworldSettings(recipe, file, data)
		}
	}
	if recipe := campaignParserRecipe(egg); recipe == vrisingSettingsRecipe || recipe == gtacSettingsRecipe || recipe == clusterioSettingsRecipe || recipe == kspDMPRecipe {
		if !campaignParserPathAllowed(egg, file) {
			return gameSettingsParsed{}, notFound()
		}
		switch recipe {
		case vrisingSettingsRecipe:
			return parseVrisingSettings(file, data)
		case gtacSettingsRecipe:
			return parseGTACGameSettings(data)
		case kspDMPRecipe:
			return parseKspDMPSettings(data)
		default:
			role := strings.TrimSuffix(strings.TrimPrefix(file, "/config-"), ".json")
			fields, e := clusterioManagedSettings(role, data)
			if e != nil {
				return gameSettingsParsed{}, bad("Invalid Clusterio configuration.")
			}
			out := gameSettingsParsed{}
			for _, f := range fields {
				out.fields = append(out.fields, gameSetting{key: str(f["key"]), value: str(f["value"]), kind: "readonly"})
			}
			out.patch = func(changes map[string]string) ([]byte, error) {
				if len(changes) > 0 {
					return nil, bad("Clusterio settings are read only.")
				}
				return append([]byte(nil), data...), nil
			}
			return out, nil
		}
	}

	switch campaignParserRecipe(egg) {
	case nuclearRecipe, solaceSettingsRecipe, nzPortableSettingsRecipe:
		if !campaignParserPathAllowed(egg, file) {
			return gameSettingsParsed{}, notFound()
		}
		switch campaignParserRecipe(egg) {
		case nuclearRecipe:
			return parseNuclearSettings(data)
		case solaceSettingsRecipe:
			return parseSolaceSettings(data)
		default:
			return parseNZPortableSettings(data)
		}
	}

	switch campaignParserRecipe(egg) {
	case dstSettingsRecipe, "openrct2/egg-openrct2.json", ragecoopRecipe, romesteadSettingsRecipe:
		if !campaignParserPathAllowed(egg, file) {
			return gameSettingsParsed{}, notFound()
		}
		switch campaignParserRecipe(egg) {
		case dstSettingsRecipe:
			return parseDSTSettings(file, data)
		case "openrct2/egg-openrct2.json":
			return parseOpenRCT2Settings(data)
		case ragecoopRecipe:
			return parseRagecoopSettings(data)
		default:
			return parseRomesteadSettings(data)
		}
	}

	switch campaignParserRecipe(egg) {
	case enshroudedSettingsRecipe, projectZomboidSettingsRecipe, groundBranchSettingsRecipe:
		if !campaignParserPathAllowed(egg, file) {
			return gameSettingsParsed{}, notFound()
		}
		switch campaignParserRecipe(egg) {
		case enshroudedSettingsRecipe:
			return parseEnshroudedSettings(data)
		case projectZomboidSettingsRecipe:
			return parseProjectZomboidSettings(data)
		default:
			return parseGroundBranchSettings(data)
		}
	}

	if recipe := campaignParserRecipe(egg); recipe == mordhauLinuxSettingsRecipe || recipe == veinSettingsRecipe || recipe == kf2SettingsRecipe {
		if !campaignParserPathAllowed(egg, file) {
			return gameSettingsParsed{}, notFound()
		}
		switch recipe {
		case mordhauLinuxSettingsRecipe:
			return parseMordhauLinuxSettings(file, data)
		case veinSettingsRecipe:
			return parseVeinSettings(data)
		default:
			return parseKF2Settings(file, data)
		}
	}
	if recipe := campaignParserRecipe(egg); recipe == jc3SettingsRecipe || recipe == plainsSettingsRecipe {
		if !campaignParserPathAllowed(egg, file) {
			return gameSettingsParsed{}, notFound()
		}
		return parseWave40Settings(recipe, data)
	}
	if campaignParserRecipe(egg) != "" && !campaignParserPathAllowed(egg, file) {
		return gameSettingsParsed{}, notFound()
	}
	if r := campaignParserRecipe(egg); r == risingUnityRecipe {
		return parseRisingUnitySettings(data)
	}
	if r := campaignParserRecipe(egg); r == bedrockVanillaRecipe {
		return parseGameSettings(file, data)
	}
	if r := campaignParserRecipe(egg); r == stationeersVanillaRecipe {
		return parseStationeersBepinexGameSettings(data)
	}
	if r := campaignParserRecipe(egg); r == abioticSettingsRecipe || r == astrocolonySettingsRecipe || r == "Aska/egg-aska.json" || r == avorionSettingsRecipe || r == carrierAuthorityRecipe {
		if file == "" || file != str(egg["_campaign_parser_path"]) {
			return gameSettingsParsed{}, notFound()
		}
		switch r {
		case abioticSettingsRecipe:
			return parseAbioticSettings(data)
		case astrocolonySettingsRecipe:
			return parseAstroColonySettings(data)
		case "Aska/egg-aska.json":
			return parseASKASettings(data)
		case avorionSettingsRecipe:
			return parseAvorionSettings(data)
		default:
			return parseCarrierGameSettings(data)
		}
	}

	if r := campaignParserRecipe(egg); r == "puck/egg-puck.json" || r == rustStagingSettingsRecipe || r == unturnedSettingsRecipe {
		if file == "" || file != str(egg["_campaign_parser_path"]) {
			return gameSettingsParsed{}, notFound()
		}
		switch r {
		case "puck/egg-puck.json":
			return parsePuckSettings(data)
		case rustStagingSettingsRecipe:
			return parseRustStagingSettings(data)
		default:
			return parseUnturnedCommandsSettings(data)
		}
	}

	if recipe := campaignParserRecipe(egg); recipe == tf2SettingsRecipe || recipe == gmodSettingsRecipe || recipe == nmrihSettingsRecipe || recipe == fofSettingsRecipe {
		if file == "" || file != str(egg["_campaign_parser_path"]) {
			return gameSettingsParsed{}, notFound()
		}
		var parsed gameSettingsParsed
		var err error
		if recipe == tf2SettingsRecipe {
			parsed, err = parseTF2Settings(data)
		} else if recipe == fofSettingsRecipe {
			parsed, err = parseFoFSettings(data)
		} else if recipe == nmrihSettingsRecipe {
			parsed, err = parseNMRiHSettings(data)
		} else {
			parsed, err = parseGModSettings(data)
		}
		return parsed, err
	}

	if campaignParserRecipe(egg) == valheimPlusSettingsRecipe {
		if !campaignParserPathAllowed(egg, file) {
			return gameSettingsParsed{}, notFound()
		}
		return parseValheimPlusSettings(data)
	}
	if campaignParserRecipe(egg) == bepinexLoggingRecipe {
		if !campaignParserPathAllowed(egg, file) {
			return gameSettingsParsed{}, notFound()
		}
		return parseBepinexLoggingSettings(data)
	}
	if recipe := campaignParserRecipe(egg); recipe == ss14SettingsRecipe || recipe == stationeersBepinexRecipe || recipe == "the_isle/evrima/egg-the-isle.json" {
		if file == "" || file != str(egg["_campaign_parser_path"]) {
			return gameSettingsParsed{}, notFound()
		}
		switch recipe {
		case ss14SettingsRecipe:
			return parseSS14ReviewedSettings(data)
		case stationeersBepinexRecipe:
			return parseStationeersBepinexGameSettings(data)
		default:
			parsed, err := parseIsleEvrimaSettings(data)
			// Count is coupled to Engine.ini. This single-document editor cannot
			// publish both files consistently, so count never gains write authority.
			for i := range parsed.fields {
				if parsed.fields[i].key == isleEvrimaSection+"/MaxPlayerCount" {
					parsed.fields[i].kind = "readonly"
				}
			}
			return parsed, err
		}
	}

	if recipe := campaignParserRecipe(egg); recipe != "" {
		switch recipe {
		case "among_us/bettercrewlink_server/egg-better-crewlink-server.json", "among_us/impostor_server/egg-among-us--impostor-server.json":
			return parseAmong165(file, data, asMap(egg["_among_effective_environment"]))
		case "beamng/beammp/egg-beam-m-p-server.json":
			return parseBeamMPReviewedSettings(data, asMap(egg["_beammp_effective_environment"]))
		case "beamng/kissmp/egg-kissmp.json":
			return parseGameSettings(file, data)
		case frozenflameSettingsRecipe:
			return parseFrozenflameSettings(data)
		case iosoccerSettingsRecipe:
			return parseIOSoccerSettings(data)
		case onsetSettingsRecipe:
			return parseOnsetSettings(data)
		case wurmSettingsRecipe:
			return parseWurmSettings(data)
		case ohdSettingsRecipe:
			return parseOHDSettings(data)
		case "renown/egg-renown.json":
			return parseRenownSettings(file, data)
		case "holdfast/egg-holdfast-na-w.json":
			return parseHoldfastSettings(data)
		case hurtworldSettingsRecipe:
			return parseHurtworldSettings(data)
		case "longvinter/egg-longvinter.json":
			return parseLongvinterSettings(data)
		case aapgSettingsRecipe:
			return parseAAPGSettings(data)
		case sandstormSettingsRecipe:
			return parseSandstormSettings(data)
		case "humanitz/egg-humanit-z.json":
			return parseHumanitzSettings(data)
		case "truck-simulator/american-truck-simulator/egg-american-truck-simulator-dedicated-server.json", "truck-simulator/euro-truck-simulator2/egg-euro-truck-simulator2-dedicated-server.json":
			return parseCampaignTruckSettings(data)
		case starboundAuthorityRecipe:
			return parseStarboundSettings(data)
		case "squad/egg-squad.json":
			return parseSquadSettings(data)
		case "the_forest/egg-the-forest.json":
			return parseForestSettings(data)
		case "subnautica_nitrox_mod/egg-subnautica.json":
			return parseNitroxSettings(data)
		case "voyagers_of_nera/egg-voyagers-of-nera.json":
			return parseVoyagersSettings(data)
		default:
			return gameSettingsParsed{}, notFound()
		}
	}
	if p, _ := integratedScalarSettings(egg); p != "" {
		return parseGameSettingsForEgg(egg, file, data)
	}
	if campaignParserRecipe(egg) == "" && (wave12UnprovenSettings(egg) || wave13UnprovenSettings(egg)) {
		return gameSettingsParsed{}, bad("Use Files for this configuration until its active schema is verified.")
	}
	if declaredEcoJSON(egg, file) {
		return parseGameSettings("/declared-eco.json", data)
	}
	parsed, err := parseGameSettingsForEgg(egg, file, data)
	if err != nil {
		return parsed, err
	}
	parsed = cuberiteGameSettingsBooleans(egg, file, parsed)
	return vintageStoryNullableSettings(egg, file, parsed), nil
}

// Compatibility for the shared parser/managed-key dispatch. Metadata remains a
// literal string list; only narrowly proven nonstandard formats get a hint.
func nativeSettingsIsRecipe(egg M, recipe string) bool {
	entry, ok := gameSettingsProfile(egg)
	return ok && entry.Path == recipe
}
func nativeSettingsDocuments(egg M) map[string]string {
	out := map[string]string{}
	for _, file := range gameSettingsDeclaredDocuments(egg) {
		if format := gameSettingsDiscoveryFormat(egg, file); format != "" {
			out[file] = format
		}
	}
	if nativeSettingsIsSTK(egg) {
		if file := str(egg["_stk_settings_path"]); file != "" {
			out[file] = "xml"
		}
	}
	return out
}

// Transitional reader for profiles integrated concurrently with map metadata.
// New overlays serialize only literal string lists. Formats are not executable
// authority and are deliberately not accepted from the old map's values.
type settingsDocumentPaths []string

func (paths *settingsDocumentPaths) UnmarshalJSON(data []byte) error {
	var list []string
	if err := json.Unmarshal(data, &list); err == nil {
		*paths = list
		return nil
	}
	var legacy map[string]string
	if err := json.Unmarshal(data, &legacy); err != nil {
		return err
	}
	list = []string{}
	for file := range legacy {
		list = append(list, strings.TrimPrefix(file, "/"))
	}
	sort.Strings(list)
	*paths = list
	return nil
}
