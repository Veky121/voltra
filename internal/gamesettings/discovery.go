package gamesettings

import (
	"encoding/json"
	"path"
	"sort"
	"strings"
)

// Discovery metadata is presentation-only. UUID matches take precedence; exact
// startup fallback must be unique across the entire catalog, including profiles
// with no declarations. Display names never establish authority.
func ProfileFor(egg M) (Profile, bool) {
	if snapshot, ok := egg[ProfileSnapshotKey].(gameSettingsProfileSnapshot); ok && snapshot.uuid == str(egg["uuid"]) && snapshot.startup == str(egg["startup"]) {
		return snapshot.entry, snapshot.found
	}
	return ProfileFrom(egg, profiles())
}
func ProfileFrom(egg M, entries []Profile) (Profile, bool) {
	for _, entry := range entries {
		if str(egg["uuid"]) == entry.EggUUID {
			return entry, true
		}
	}
	var match Profile
	count := 0
	for _, entry := range entries {
		if startup := str(egg["startup"]); startup != "" && startup == str(entry.Egg["startup"]) {
			match = entry
			count++
		}
	}
	return match, count == 1
}

func SafeSettingsDocument(file string) bool {
	if file == "" || strings.HasPrefix(file, "/") || strings.ContainsAny(file, "\\\x00\r\n{}*?[]:$") || path.Clean(file) != file {
		return false
	}
	for _, part := range strings.Split(file, "/") {
		lower := strings.ToLower(part)
		if part == "." || part == ".." || strings.HasPrefix(lower, "mod") || strings.HasPrefix(lower, "plugin") {
			return false
		}
	}
	_, err := QuickPathParts("/" + file)
	return err == nil
}
func DeclaredDocuments(egg M) []string {
	if IsRecipe(egg, TshockAuthorityRecipe) || IsRecipe(egg, TshockLegacyAuthorityRecipe) {
		if str(egg["_campaign_parser_path"]) != "" {
			return []string{"/serverconfig.txt", "/tshock/config.json"}
		}
		return nil
	}
	if CampaignParserRecipe(egg) != "" {
		if p := str(egg["_campaign_parser_path"]); p != "" {
			if IsRecipe(egg, ConanAuthorityRecipe) {
				return []string{p, ConanAuthorityDirectory + "Engine.ini", ConanAuthorityDirectory + "Game.ini"}
			}
			if IsRecipe(egg, "arma/arma3/egg-arma3.json") {
				return []string{"/server.cfg", "/basic.cfg"}
			}
			if IsRecipe(egg, KspLMPRecipe) {
				return finalLMPDocuments()
			}
			if IsRecipe(egg, DstSettingsRecipe) {
				base := strings.TrimSuffix(p, "/cluster.ini")
				return []string{p, base + "/Master/server.ini", base + "/Caves/server.ini"}
			}
			if IsRecipe(egg, Kf2SettingsRecipe) {
				return []string{Kf2SettingsGamePath, Kf2SettingsWebPath}
			}
			if IsRecipe(egg, "renown/egg-renown.json") {
				return []string{p, RenownSettingsDirectory + "Engine.ini"}
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
	if p, _ := ReviewedNewSettings(egg); p != "" {
		if reviewedNewDocument(egg, p) {
			return []string{p}
		}
		return nil
	}

	entry, ok := ProfileFor(egg)
	if !ok {
		return nil
	}
	if OpenraSettingsStartup(egg) != "" {
		if openraSettingsDocument(egg, OpenraSettingsPath) {
			return []string{OpenraSettingsPath}
		}
		return nil
	}
	if entry.Path == "factorio/factorio/egg-factorio.json" && str(egg["startup"]) != "exec bash .voltra/factorio-native-start.sh" {
		return nil
	}
	if OpenraSettingsStartup(egg) != "" && !openraSettingsDocument(egg, OpenraSettingsPath) {
		return nil
	}
	if entry.Path == EtlegacySettingsRecipe && !etlegacySettingsDocument(egg, EtlegacySettingsPath) {
		return nil
	}
	if entry.Path == Hl2dmSettingsRecipe && !Hl2dmSettingsDocument(egg, Hl2dmSettingsPath) {
		return nil
	}
	if entry.Path == QuakeLiveSettingsRecipe {
		if file := str(egg["_quakelive_settings_path"]); file != "" {
			return []string{file}
		}
		return nil
	}
	out := []string{}
	if file := BananaSelectedSettingsDocument(egg); file != "" {
		out = append(out, file)
	}
	for _, file := range entry.SettingsDocuments {
		if soldatSettingsRecipe(egg) && !soldatSettingsDocument(egg, "/"+file) {
			continue
		}
		if entry.Path == OpenArenaSettingsRecipe && "/"+file != openArenaSelectedSettingsDocument(egg) {
			continue
		}
		if SafeSettingsDocument(file) {
			out = append(out, "/"+file)
		}
	}
	return out
}

// Eco's two adapter-owned documents are proven JSON. This does not authorize
// arbitrary .eco files, even on an Eco server.
func declaredEcoJSON(egg M, file string) bool {
	entry, ok := ProfileFor(egg)
	if !ok || entry.Path != "eco/egg-eco.json" {
		return false
	}
	if file != "/Configs/Network.eco" && file != "/Configs/Localization.eco" {
		return false
	}
	for _, declared := range DeclaredDocuments(egg) {
		if declared == file {
			return true
		}
	}
	return false
}
func DiscoveryFormat(egg M, file string) string {
	if CampaignParserRecipe(egg) != "" {
		if CampaignParserPathAllowed(egg, file) {
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
	if CampaignParserRecipe(egg) == "" && (UnprovenSettingsA(egg) || UnprovenSettingsB(egg)) {
		return ""
	}
	if p, _ := ReviewedNewSettings(egg); p != "" {
		if reviewedNewDocument(egg, file) {
			return "reviewed"
		}
		return ""
	}

	if Hl2dmSettingsDocument(egg, file) {
		return "source"
	}
	if file == Hl2dmSettingsPath && IsRecipe(egg, Hl2dmSettingsRecipe) {
		return ""
	}
	if IsRecipe(egg, QuakeLiveSettingsRecipe) && (file == QuakeLiveBaseSettingsPath || file == QuakeLiveHomeSettingsPath) {
		if file == str(egg["_quakelive_settings_path"]) {
			return "source"
		}
		return ""
	}
	if etlegacySettingsDocument(egg, file) {
		return "source"
	}
	if file == EtlegacySettingsPath && IsRecipe(egg, EtlegacySettingsRecipe) {
		return ""
	}
	if openraSettingsDocument(egg, file) {
		return "openra"
	}
	if file == OpenraSettingsPath && (OpenraSettingsStartup(egg) != "") {
		return ""
	}
	if file == LuantiSettingsPath && IsRecipe(egg, "minetest/egg-minetest.json") {
		return "luanti"
	}
	if IsRecipe(egg, OpenArenaSettingsRecipe) && (file == OpenArenaBaseSettingsPath || file == OpenArenaMissionSettingsPath) {
		if openArenaSettingsDocument(egg, file) {
			return "source"
		}
		return ""
	}
	if file == XonoticSettingsPath && IsRecipe(egg, "xonotic/egg-xonotic.json") {
		return "source"
	}
	if MindustrySettingsDocument(egg, file) {
		return "mindustry"
	}
	if file == GoldSrcCS16SettingsPath && IsRecipe(egg, "counter_strike/counter_strike_1.6/egg-counter-strike1-6--vanilla.json") {
		return "source"
	}
	if file == CssSettingsPath && IsRecipe(egg, "counter_strike/counter_strike_source/egg-counter--strike--source.json") {
		return "source"
	}
	if file == teeworldsSettingsPath && IsRecipe(egg, "teeworlds/egg-teeworlds.json") {
		return "teeworlds"
	}
	if file == tachyonSettingsPath && IsRecipe(egg, "ftl_tachyon/egg-tachyon.json") {
		return "ini"
	}
	if file == DdnetSettingsPath && IsRecipe(egg, "ddnet/egg-d-d-net.json") {
		return "ddnet"
	}
	if kind := cubeGameSettingsKind(egg, file); kind != "" {
		return "cube"
	}
	if file == CarrierSettingsPath && IsRecipe(egg, "carrier_command_2/egg-carrier-command2.json") {
		return "xml"
	}
	if file == cryofallSettingsPath && IsRecipe(egg, "cryofall/egg-cryo-fall.json") {
		return "xml"
	}
	if CubicSettingsDocument(egg, file) {
		return "cubic"
	}
	if declaredEcoJSON(egg, file) {
		return "json"
	}
	if IsRecipe(egg, "barotrauma/egg-barotrauma.json") && file == "/serversettings.xml" {
		return "xml"
	}
	if IsRecipe(egg, "Aska/egg-aska.json") && file == "/server properties.txt" {
		return "ini"
	}
	entry, ok := ProfileFor(egg)
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
func ParseDiscovered(egg M, file string, data []byte) (Parsed, error) {
	if IsRecipe(egg, ZandronumSettingsRecipe) {
		if file != ZandronumSettingsPath || !CampaignParserPathAllowed(egg, file) {
			return Parsed{}, notFound()
		}
		return parseZandronumSettings(data)
	}
	if IsRecipe(egg, StarmadeSettingsRecipe) {
		if file != StarmadeSettingsPath || !CampaignParserPathAllowed(egg, file) {
			return Parsed{}, notFound()
		}
		return ParseStarmadeSettings(data)
	}
	if IsRecipe(egg, CoreKeeperSettingsRecipe) {
		if file != CoreKeeperSettingsPath || !CampaignParserPathAllowed(egg, file) {
			return Parsed{}, notFound()
		}
		return ParseCoreKeeperSettings(data)
	}
	if IsRecipe(egg, NecesseSettingsRecipe) {
		if file != NecesseSettingsPath || !CampaignParserPathAllowed(egg, file) {
			return Parsed{}, notFound()
		}
		return ParseNecesseSettings(data)
	}
	if IsRecipe(egg, UrbanTerrorSettingsRecipe) {
		if file != UrbanTerrorSettingsPath || !CampaignParserPathAllowed(egg, file) {
			return Parsed{}, notFound()
		}
		return ParseUrbanTerrorSettings(data)
	}

	if IsRecipe(egg, Srb2SettingsRecipe) {
		if file != Srb2SettingsPath || !CampaignParserPathAllowed(egg, file) {
			return Parsed{}, notFound()
		}
		return ParseSRB2Settings(data)
	}
	if IsRecipe(egg, "brickadia/egg-brickadia.json") {
		if !CampaignParserPathAllowed(egg, file) {
			return Parsed{}, notFound()
		}
		return parseBrickadia(file, data)
	}
	if IsRecipe(egg, ArcheanRepairRecipe) {
		if !CampaignParserPathAllowed(egg, file) {
			return Parsed{}, notFound()
		}
		return parseArcheanRepairSettings(file, data)
	}
	if assettoSettingsRecipe(egg) {
		if !CampaignParserPathAllowed(egg, file) {
			return Parsed{}, notFound()
		}
		return ParseAssettoSettings(egg, data)
	}
	if IsRecipe(egg, TshockAuthorityRecipe) || IsRecipe(egg, TshockLegacyAuthorityRecipe) {
		if !CampaignParserPathAllowed(egg, file) {
			return Parsed{}, notFound()
		}
		p, e := Parse(file, data)
		if e == nil && IsRecipe(egg, TshockAuthorityRecipe) {
			p = tshockNativeSettingsSafety(file, p)
		}
		return p, e
	}
	if IsRecipe(egg, ConanAuthorityRecipe) {
		if !CampaignParserPathAllowed(egg, file) {
			return Parsed{}, notFound()
		}
		return Parse(file, data)
	}
	if IsRecipe(egg, Hl2dmSettingsRecipe) {
		if !CampaignParserPathAllowed(egg, file) {
			return Parsed{}, notFound()
		}
		return ParseHL2DMSettings(data)
	}
	if IsRecipe(egg, Cs2AuthorityRecipe) {
		if !CampaignParserPathAllowed(egg, file) {
			return Parsed{}, notFound()
		}
		return parseSourceSettings(data)
	}
	if IsRecipe(egg, FiveMRecipe) {
		if !CampaignParserPathAllowed(egg, file) {
			return Parsed{}, notFound()
		}
		return parseFiveMSettings(data)
	}
	if IsRecipe(egg, ReforgerSettingsRecipe) {
		if !CampaignParserPathAllowed(egg, file) {
			return Parsed{}, notFound()
		}
		ports := []int{}
		for _, port := range asSlice(egg["_reforger_allocated_ports"]) {
			ports = append(ports, int(num(port)))
		}
		return parseReforgerSettings(data, int(num(egg["_reforger_primary_port"])), ports)
	}
	if IsRecipe(egg, "arma/arma3/egg-arma3.json") {
		if !CampaignParserPathAllowed(egg, file) {
			return Parsed{}, notFound()
		}
		return parseArmaSettings(data)
	}

	if recipe := CampaignParserRecipe(egg); FinalFiveRecipe(recipe) {
		if !CampaignParserPathAllowed(egg, file) {
			return Parsed{}, notFound()
		}
		switch recipe {
		case "gta/openmp/egg-open-m-p.json":
			return ParseOpenMPNativeSettings(data)
		case "gta/mtasa/egg-multi-theft-auto.json":
			return ParseMTANativeSettings(data)
		case KspLMPRecipe:
			return parseKspLMPSettings(file, data)
		default:
			return parseRimworldSettings(recipe, file, data)
		}
	}
	if recipe := CampaignParserRecipe(egg); recipe == VrisingSettingsRecipe || recipe == GtacSettingsRecipe || recipe == ClusterioSettingsRecipe || recipe == KspDMPRecipe {
		if !CampaignParserPathAllowed(egg, file) {
			return Parsed{}, notFound()
		}
		switch recipe {
		case VrisingSettingsRecipe:
			return parseVrisingSettings(file, data)
		case GtacSettingsRecipe:
			return ParseGTACGameSettings(data)
		case KspDMPRecipe:
			return ParseKspDMPSettings(data)
		default:
			role := strings.TrimSuffix(strings.TrimPrefix(file, "/config-"), ".json")
			fields, e := clusterioManagedSettings(role, data)
			if e != nil {
				return Parsed{}, bad("Invalid Clusterio configuration.")
			}
			out := Parsed{}
			for _, f := range fields {
				out.Fields = append(out.Fields, Setting{Key: str(f["key"]), Value: str(f["value"]), Kind: "readonly"})
			}
			out.Patch = func(changes map[string]string) ([]byte, error) {
				if len(changes) > 0 {
					return nil, bad("Clusterio settings are read only.")
				}
				return append([]byte(nil), data...), nil
			}
			return out, nil
		}
	}

	switch CampaignParserRecipe(egg) {
	case NuclearRecipe, SolaceSettingsRecipe, NzPortableSettingsRecipe:
		if !CampaignParserPathAllowed(egg, file) {
			return Parsed{}, notFound()
		}
		switch CampaignParserRecipe(egg) {
		case NuclearRecipe:
			return parseNuclearSettings(data)
		case SolaceSettingsRecipe:
			return parseSolaceSettings(data)
		default:
			return parseNZPortableSettings(data)
		}
	}

	switch CampaignParserRecipe(egg) {
	case DstSettingsRecipe, "openrct2/egg-openrct2.json", RagecoopRecipe, RomesteadSettingsRecipe:
		if !CampaignParserPathAllowed(egg, file) {
			return Parsed{}, notFound()
		}
		switch CampaignParserRecipe(egg) {
		case DstSettingsRecipe:
			return parseDSTSettings(file, data)
		case "openrct2/egg-openrct2.json":
			return parseOpenRCT2Settings(data)
		case RagecoopRecipe:
			return parseRagecoopSettings(data)
		default:
			return parseRomesteadSettings(data)
		}
	}

	switch CampaignParserRecipe(egg) {
	case EnshroudedSettingsRecipe, ProjectZomboidSettingsRecipe, GroundBranchSettingsRecipe:
		if !CampaignParserPathAllowed(egg, file) {
			return Parsed{}, notFound()
		}
		switch CampaignParserRecipe(egg) {
		case EnshroudedSettingsRecipe:
			return ParseEnshroudedSettings(data)
		case ProjectZomboidSettingsRecipe:
			return ParseProjectZomboidSettings(data)
		default:
			return ParseGroundBranchSettings(data)
		}
	}

	if recipe := CampaignParserRecipe(egg); recipe == MordhauLinuxSettingsRecipe || recipe == VeinSettingsRecipe || recipe == Kf2SettingsRecipe {
		if !CampaignParserPathAllowed(egg, file) {
			return Parsed{}, notFound()
		}
		switch recipe {
		case MordhauLinuxSettingsRecipe:
			return parseMordhauLinuxSettings(file, data)
		case VeinSettingsRecipe:
			return parseVeinSettings(data)
		default:
			return parseKF2Settings(file, data)
		}
	}
	if recipe := CampaignParserRecipe(egg); recipe == Jc3SettingsRecipe || recipe == PlainsSettingsRecipe {
		if !CampaignParserPathAllowed(egg, file) {
			return Parsed{}, notFound()
		}
		return parseWave40Settings(recipe, data)
	}
	if CampaignParserRecipe(egg) != "" && !CampaignParserPathAllowed(egg, file) {
		return Parsed{}, notFound()
	}
	if r := CampaignParserRecipe(egg); r == RisingUnityRecipe {
		return ParseRisingUnitySettings(data)
	}
	if r := CampaignParserRecipe(egg); r == BedrockVanillaRecipe {
		return Parse(file, data)
	}
	if r := CampaignParserRecipe(egg); r == StationeersVanillaRecipe {
		return parseStationeersBepinexGameSettings(data)
	}
	if r := CampaignParserRecipe(egg); r == AbioticSettingsRecipe || r == AstrocolonySettingsRecipe || r == "Aska/egg-aska.json" || r == AvorionSettingsRecipe || r == CarrierAuthorityRecipe {
		if file == "" || file != str(egg["_campaign_parser_path"]) {
			return Parsed{}, notFound()
		}
		switch r {
		case AbioticSettingsRecipe:
			return parseAbioticSettings(data)
		case AstrocolonySettingsRecipe:
			return parseAstroColonySettings(data)
		case "Aska/egg-aska.json":
			return ParseASKASettings(data)
		case AvorionSettingsRecipe:
			return parseAvorionSettings(data)
		default:
			return ParseCarrierGameSettings(data)
		}
	}

	if r := CampaignParserRecipe(egg); r == "puck/egg-puck.json" || r == RustStagingSettingsRecipe || r == UnturnedSettingsRecipe {
		if file == "" || file != str(egg["_campaign_parser_path"]) {
			return Parsed{}, notFound()
		}
		switch r {
		case "puck/egg-puck.json":
			return parsePuckSettings(data)
		case RustStagingSettingsRecipe:
			return ParseRustStagingSettings(data)
		default:
			return parseUnturnedCommandsSettings(data)
		}
	}

	if recipe := CampaignParserRecipe(egg); recipe == Tf2SettingsRecipe || recipe == GmodSettingsRecipe || recipe == NmrihSettingsRecipe || recipe == FofSettingsRecipe {
		if file == "" || file != str(egg["_campaign_parser_path"]) {
			return Parsed{}, notFound()
		}
		var parsed Parsed
		var err error
		if recipe == Tf2SettingsRecipe {
			parsed, err = parseTF2Settings(data)
		} else if recipe == FofSettingsRecipe {
			parsed, err = ParseFoFSettings(data)
		} else if recipe == NmrihSettingsRecipe {
			parsed, err = ParseNMRiHSettings(data)
		} else {
			parsed, err = parseGModSettings(data)
		}
		return parsed, err
	}

	if CampaignParserRecipe(egg) == ValheimPlusSettingsRecipe {
		if !CampaignParserPathAllowed(egg, file) {
			return Parsed{}, notFound()
		}
		return parseValheimPlusSettings(data)
	}
	if CampaignParserRecipe(egg) == BepinexLoggingRecipe {
		if !CampaignParserPathAllowed(egg, file) {
			return Parsed{}, notFound()
		}
		return ParseBepinexLoggingSettings(data)
	}
	if recipe := CampaignParserRecipe(egg); recipe == Ss14SettingsRecipe || recipe == StationeersBepinexRecipe || recipe == "the_isle/evrima/egg-the-isle.json" {
		if file == "" || file != str(egg["_campaign_parser_path"]) {
			return Parsed{}, notFound()
		}
		switch recipe {
		case Ss14SettingsRecipe:
			return parseSS14ReviewedSettings(data)
		case StationeersBepinexRecipe:
			return parseStationeersBepinexGameSettings(data)
		default:
			parsed, err := parseIsleEvrimaSettings(data)
			// Count is coupled to Engine.ini. This single-document editor cannot
			// publish both files consistently, so count never gains write authority.
			for i := range parsed.Fields {
				if parsed.Fields[i].Key == IsleEvrimaSection+"/MaxPlayerCount" {
					parsed.Fields[i].Kind = "readonly"
				}
			}
			return parsed, err
		}
	}

	if recipe := CampaignParserRecipe(egg); recipe != "" {
		switch recipe {
		case "among_us/bettercrewlink_server/egg-better-crewlink-server.json", "among_us/impostor_server/egg-among-us--impostor-server.json":
			return parseAmong165(file, data, asMap(egg["_among_effective_environment"]))
		case "beamng/beammp/egg-beam-m-p-server.json":
			return ParseBeamMPReviewedSettings(data, asMap(egg["_beammp_effective_environment"]))
		case "beamng/kissmp/egg-kissmp.json":
			return Parse(file, data)
		case FrozenflameSettingsRecipe:
			return parseFrozenflameSettings(data)
		case IosoccerSettingsRecipe:
			return parseIOSoccerSettings(data)
		case OnsetSettingsRecipe:
			return parseOnsetSettings(data)
		case WurmSettingsRecipe:
			return parseWurmSettings(data)
		case OhdSettingsRecipe:
			return parseOHDSettings(data)
		case "renown/egg-renown.json":
			return parseRenownSettings(file, data)
		case "holdfast/egg-holdfast-na-w.json":
			return parseHoldfastSettings(data)
		case HurtworldSettingsRecipe:
			return parseHurtworldSettings(data)
		case "longvinter/egg-longvinter.json":
			return parseLongvinterSettings(data)
		case AapgSettingsRecipe:
			return parseAAPGSettings(data)
		case SandstormSettingsRecipe:
			return parseSandstormSettings(data)
		case "humanitz/egg-humanit-z.json":
			return parseHumanitzSettings(data)
		case "truck-simulator/american-truck-simulator/egg-american-truck-simulator-dedicated-server.json", "truck-simulator/euro-truck-simulator2/egg-euro-truck-simulator2-dedicated-server.json":
			return parseCampaignTruckSettings(data)
		case StarboundAuthorityRecipe:
			return parseStarboundSettings(data)
		case "squad/egg-squad.json":
			return ParseSquadSettings(data)
		case "the_forest/egg-the-forest.json":
			return parseForestSettings(data)
		case "subnautica_nitrox_mod/egg-subnautica.json":
			return parseNitroxSettings(data)
		case "voyagers_of_nera/egg-voyagers-of-nera.json":
			return parseVoyagersSettings(data)
		default:
			return Parsed{}, notFound()
		}
	}
	if p, _ := integratedScalarSettings(egg); p != "" {
		return ParseForEgg(egg, file, data)
	}
	if CampaignParserRecipe(egg) == "" && (UnprovenSettingsA(egg) || UnprovenSettingsB(egg)) {
		return Parsed{}, bad("Use Files for this configuration until its active schema is verified.")
	}
	if declaredEcoJSON(egg, file) {
		return Parse("/declared-eco.json", data)
	}
	parsed, err := ParseForEgg(egg, file, data)
	if err != nil {
		return parsed, err
	}
	parsed = CuberiteGameSettingsBooleans(egg, file, parsed)
	return VintageStoryNullableSettings(egg, file, parsed), nil
}

// Compatibility for the shared parser/managed-key dispatch. Metadata remains a
// literal string list; only narrowly proven nonstandard formats get a hint.
func IsRecipe(egg M, recipe string) bool {
	entry, ok := ProfileFor(egg)
	return ok && entry.Path == recipe
}
func NativeDocuments(egg M) map[string]string {
	out := map[string]string{}
	for _, file := range DeclaredDocuments(egg) {
		if format := DiscoveryFormat(egg, file); format != "" {
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
type DocumentPaths []string

func (paths *DocumentPaths) UnmarshalJSON(data []byte) error {
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
