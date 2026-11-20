package gamesettings

import (
	"context"

	"encoding/json"
	"strconv"
	"strings"
)

func campaignSettingsRequiresAuthority(egg M) bool {
	if factorioNativeSettings(egg) {
		return true
	}
	if CampaignParserRecipe(egg) != "" {
		return true
	}
	p, _ := ReviewedNewSettings(egg)
	if p, _ := integratedScalarSettings(egg); p != "" {
		return true
	}
	return IsRecipe(egg, "ddnet/egg-d-d-net.json") || p != "" || (OpenraSettingsStartup(egg) != "") || IsRecipe(egg, EtlegacySettingsRecipe) || IsRecipe(egg, Hl2dmSettingsRecipe) || IsRecipe(egg, QuakeLiveSettingsRecipe)
}
func (a *Service) prepareCampaignSettingsAuthority(ctx context.Context, s, egg M) error {
	if factorioNativeSettings(egg) && (str(s["startup"]) != FactorioNativeStartup || str(egg["startup"]) != FactorioNativeStartup) {
		return notFound()
	}
	if CampaignParserRecipe(egg) != "" {
		return a.prepareCampaignParserAuthority(ctx, s, egg)
	}
	if p, startup := integratedScalarSettings(egg); p != "" && (str(egg["startup"]) != startup || str(s["startup"]) != startup) {
		return notFound()
	}
	if !campaignSettingsRequiresAuthority(egg) {
		return nil
	}
	if IsRecipe(egg, "ddnet/egg-d-d-net.json") && str(egg["startup"]) != "exec python3 .voltra/ddnet_original_parity.py" {
		return notFound()
	}
	if p, _ := ReviewedNewSettings(egg); p != "" && !reviewedNewDocument(egg, p) {
		return notFound()
	}
	if str(s["startup"]) != str(egg["startup"]) {
		return notFound()
	}
	if (OpenraSettingsStartup(egg) != "") && !openraSettingsDocument(egg, OpenraSettingsPath) {
		return notFound()
	}
	if IsRecipe(egg, EtlegacySettingsRecipe) && !etlegacySettingsDocument(egg, EtlegacySettingsPath) {
		return notFound()
	}
	if IsRecipe(egg, Hl2dmSettingsRecipe) && !Hl2dmSettingsDocument(egg, Hl2dmSettingsPath) {
		return notFound()
	}
	if IsRecipe(egg, QuakeLiveSettingsRecipe) {
		if str(egg["startup"]) != quakeLiveSettingsStartup {
			return notFound()
		}
		file, err := quakeLiveActiveSettingsDocument(QuakeLiveSettingsRecipe, str(s["startup"]), func(file string) (bool, error) { _, exists, err := a.quickSetupRead(ctx, s, file); return exists, err })
		if err != nil {
			return err
		}
		egg["_quakelive_settings_path"] = file
	}
	return nil
}

// Launcher identities and paths come from the current seed-once adapters.
// An altered launcher cannot inherit authority from its catalog UUID.
func integratedScalarSettings(egg M) (string, string) {
	if IsRecipe(egg, TowerSettingsRecipe) {
		return TowerSettingsPath, "exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/tower_native.py run"
	}
	if IsRecipe(egg, "windrose/egg-windrose.json") {
		return WindroseSettingsPath, "exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/windrose_owner.py run"
	}
	if IsRecipe(egg, "terratech_worlds/egg-terra-tech-worlds.json") {
		return TerraTechSettingsPath, "exec /usr/bin/python3 .voltra/terratech-native.py run"
	}
	return "", ""
}
func integratedScalarDocument(egg M, file string) bool {
	p, startup := integratedScalarSettings(egg)
	return p != "" && file == p && str(egg["startup"]) == startup
}

// Admission uses supported Wings parent/leaf checks and reads. It does not
// attest the interpreter or serialize independent SFTP/file writers.
func CampaignParserRecipe(egg M) string {
	for _, r := range []string{ZandronumSettingsRecipe, StarmadeSettingsRecipe, CoreKeeperSettingsRecipe, NecesseSettingsRecipe, ValheimPlusSettingsRecipe, BepinexLoggingRecipe, UrbanTerrorSettingsRecipe, Srb2SettingsRecipe, "brickadia/egg-brickadia.json", "among_us/bettercrewlink_server/egg-better-crewlink-server.json", "among_us/impostor_server/egg-among-us--impostor-server.json", ArcheanRepairRecipe, "beamng/beammp/egg-beam-m-p-server.json", "beamng/kissmp/egg-kissmp.json", AssettoVanillaRecipe, AssettoAIRecipe, TshockAuthorityRecipe, TshockLegacyAuthorityRecipe, ConanAuthorityRecipe, Cs2AuthorityRecipe, Hl2dmSettingsRecipe, FofSettingsRecipe, FiveMRecipe, "arma/arma3/egg-arma3.json", ReforgerSettingsRecipe, "gta/openmp/egg-open-m-p.json", "gta/mtasa/egg-multi-theft-auto.json", "rimworld/open_world/egg-rimworld-open-world.json", "rimworld/together/egg-rimworld-together.json", KspLMPRecipe, NuclearRecipe, SolaceSettingsRecipe, NzPortableSettingsRecipe, VrisingSettingsRecipe, GtacSettingsRecipe, ClusterioSettingsRecipe, KspDMPRecipe, DstSettingsRecipe, "openrct2/egg-openrct2.json", RagecoopRecipe, RomesteadSettingsRecipe, EnshroudedSettingsRecipe, ProjectZomboidSettingsRecipe, GroundBranchSettingsRecipe, MordhauLinuxSettingsRecipe, Kf2SettingsRecipe, VeinSettingsRecipe, Jc3SettingsRecipe, PlainsSettingsRecipe, FrozenflameSettingsRecipe, IosoccerSettingsRecipe, OnsetSettingsRecipe, WurmSettingsRecipe, OhdSettingsRecipe, "renown/egg-renown.json", "holdfast/egg-holdfast-na-w.json", HurtworldSettingsRecipe, "longvinter/egg-longvinter.json", AapgSettingsRecipe, SandstormSettingsRecipe, "humanitz/egg-humanit-z.json", AbioticSettingsRecipe, AstrocolonySettingsRecipe, "Aska/egg-aska.json", AvorionSettingsRecipe, CarrierAuthorityRecipe, "puck/egg-puck.json", RustStagingSettingsRecipe, UnturnedSettingsRecipe, Tf2SettingsRecipe, GmodSettingsRecipe, NmrihSettingsRecipe, Ss14SettingsRecipe, StationeersBepinexRecipe, StationeersVanillaRecipe, BedrockVanillaRecipe, RisingUnityRecipe, "the_isle/evrima/egg-the-isle.json", "the_forest/egg-the-forest.json", "subnautica_nitrox_mod/egg-subnautica.json", "voyagers_of_nera/egg-voyagers-of-nera.json", "squad/egg-squad.json", StarboundAuthorityRecipe, "truck-simulator/american-truck-simulator/egg-american-truck-simulator-dedicated-server.json", "truck-simulator/euro-truck-simulator2/egg-euro-truck-simulator2-dedicated-server.json"} {
		if IsRecipe(egg, r) {
			return r
		}
	}
	return ""
}
func (a *Service) prepareCampaignParserAuthority(ctx context.Context, s, egg M) error {
	if IsRecipe(egg, "brickadia/egg-brickadia.json") {
		return a.PrepareBrickadiaAuthority(ctx, s, egg)
	}
	if among165Recipe(egg) != "" {
		return a.prepareAmong165Authority(ctx, s, egg)
	}
	if IsRecipe(egg, ArcheanRepairRecipe) {
		return a.prepareArcheanRepairAuthority(ctx, s, egg)
	}
	if beamngSettingsRecipe(egg) != "" {
		return a.prepareBeamngSettingsAuthority(ctx, s, egg)
	}
	if assettoSettingsRecipe(egg) {
		return a.prepareAssettoSettings(ctx, s, egg)
	}
	recipe := CampaignParserRecipe(egg)
	if recipe == TshockAuthorityRecipe || recipe == TshockLegacyAuthorityRecipe {
		return a.prepareTShockAuthority(ctx, s, egg)
	}
	mappingBytes, e := json.Marshal(egg["config_files"])
	var mappings map[string]json.RawMessage
	if e != nil || json.Unmarshal(mappingBytes, &mappings) != nil || mappings == nil || len(mappings) != 0 {
		return notFound()
	}

	entry, _ := ProfileFor(egg)
	if str(s["startup"]) != str(entry.Egg["startup"]) || str(egg["startup"]) != str(entry.Egg["startup"]) || len(asMap(egg["config_files"])) != 0 {
		return notFound()
	}
	config, err := a.serverConfig(ctx, s)
	if err != nil {
		return err
	}
	env := map[string]string{}
	for k, v := range asMap(config["environment"]) {
		env[k] = str(v)
	}
	for _, k := range []string{"PYTHONPATH", "LD_PRELOAD", "EXTRA_ARGS", "ADDITIONAL_ARGS"} {
		if env[k] != "" {
			return notFound()
		}
	}
	files := map[string][]byte{}
	// Read each emitted Python module, not just the entrypoint. Source bytes
	// establish the reviewed adapter contract, never installed binary identity.
	script := str(asMap(asMap(entry.Egg["scripts"])["installation"])["script"])
	for _, chunk := range strings.Split(script, "cat > ")[1:] {
		head, body, ok := strings.Cut(chunk, "\n")
		if !ok {
			continue
		}
		name, marker, ok := strings.Cut(head, " <<'")
		if !ok {
			continue
		}
		marker = strings.TrimSuffix(marker, "'")
		if !strings.HasPrefix(name, ".voltra/") {
			continue
		}
		expected, _, ok := strings.Cut(body, "\n"+marker+"\n")
		if !ok {
			return notFound()
		}
		expected += "\n"
		data, exists, e := a.quickSetupRead(ctx, s, "/"+name)
		if e != nil {
			return e
		}
		if !exists || string(data) != expected {
			return notFound()
		}
		files[name] = data
	}
	if len(files) == 0 {
		return notFound()
	}
	// Pure helper pins were recorded from CRLF source files. Installed bytes
	// above remain exact; normalize source newlines only for those legacy pins.
	semanticFiles := map[string][]byte{}
	for k, v := range files {
		semanticFiles[k] = []byte(strings.TrimSuffix(string(v), "\n"))
	}
	in := SettingsAuthorityInput{Startup: str(s["startup"]), Env: env, Files: semanticFiles}
	var authority SettingsPathAuthority
	switch recipe {
	case ZandronumSettingsRecipe:
		if in.Startup != ZandronumSettingsStartup || str(egg["startup"]) != ZandronumSettingsStartup || !zandronumSourceHelpers(files) {
			return notFound()
		}
		for _, key := range []string{"VOLTRA_SERVER_ROOT", "HOME", "PYTHONHOME", "LD_LIBRARY_PATH", "OTHER_ARGS", "SERVER_ARGS", "STARTUP_ARGS"} {
			if env[key] != "" {
				return notFound()
			}
		}
		authority = settingsAuthorityResult(ZandronumSettingsPath, in.Startup)
	case StarmadeSettingsRecipe:
		data, exists, e := a.quickSetupRead(ctx, s, StarmadeSettingsPath)
		if e != nil {
			return e
		}
		if !exists {
			return notFound()
		}
		in.Files["server.cfg"] = data
		authority, err = StarmadeSettingsAuthority(recipe, str(egg["startup"]), in)
	case CoreKeeperSettingsRecipe:
		authority = settingsAuthorityResult(CoreKeeperSettingsPath, in.Startup)
	case NecesseSettingsRecipe:
		for _, key := range []string{"VOLTRA_SERVER_ROOT", "HOME", "PYTHONHOME", "LD_LIBRARY_PATH", "JAVA_TOOL_OPTIONS", "JDK_JAVA_OPTIONS", "_JAVA_OPTIONS"} {
			if env[key] != "" && !(key == "VOLTRA_SERVER_ROOT" && env[key] == "/home/container") {
				return notFound()
			}
		}
		authority = settingsAuthorityResult(NecesseSettingsPath, in.Startup)
	case UrbanTerrorSettingsRecipe:
		for _, key := range []string{"VOLTRA_SERVER_ROOT", "HOME", "OTHER_ARGS", "SERVER_ARGS", "STARTUP_ARGS"} {
			if env[key] != "" {
				return notFound()
			}
		}
		// fs_homepath precedes fs_basepath. Never edit an inactive base file.
		if _, exists, e := a.quickSetupRead(ctx, s, "/urbanterror/userdata/q3ut4/server.cfg"); e != nil {
			return e
		} else if exists {
			return notFound()
		}
		authority = settingsAuthorityResult(UrbanTerrorSettingsPath, in.Startup)
	case Srb2SettingsRecipe:
		if env["VOLTRA_SERVER_ROOT"] != "" && env["VOLTRA_SERVER_ROOT"] != "/home/container" {
			return notFound()
		}
		for _, key := range []string{"HOME", "OTHER_ARGS", "SERVER_ARGS", "STARTUP_ARGS"} {
			if env[key] != "" {
				return notFound()
			}
		}
		authority = settingsAuthorityResult(Srb2SettingsPath, in.Startup)
	case ConanAuthorityRecipe:
		authority, err = conanSettingsAuthority(recipe, str(egg["startup"]), in)
	case "gta/openmp/egg-open-m-p.json", "gta/mtasa/egg-multi-theft-auto.json", "rimworld/open_world/egg-rimworld-open-world.json", "rimworld/together/egg-rimworld-together.json", KspLMPRecipe:
		authority, err = a.prepareFinalFiveSettings(ctx, s, egg, recipe, env, files, config, mappingBytes)
	case VrisingSettingsRecipe, GtacSettingsRecipe, ClusterioSettingsRecipe, KspDMPRecipe:
		file := VrisingHostSettingsPath
		read := func(name string) error {
			data, exists, e := a.quickSetupRead(ctx, s, "/"+strings.TrimPrefix(name, "/"))
			if e != nil {
				return e
			}
			if !exists {
				return notFound()
			}
			files[name] = data
			in.Files[name] = data
			return nil
		}
		if env["VOLTRA_SERVER_ROOT"] != "" && env["VOLTRA_SERVER_ROOT"] != "/home/container" {
			return notFound()
		}
		for _, key := range []string{"OTHER_ARGS", "SERVER_ARGS", "STARTUP_ARGS"} {
			if env[key] != "" {
				return notFound()
			}
		}
		switch recipe {
		case VrisingSettingsRecipe:
			if in.Startup != vrisingSettingsStartup || env["VOLTRA_VRISING_VARIANT"] != "vanilla" {
				return notFound()
			}
		case GtacSettingsRecipe:
			file = GtacSettingsPath
		case ClusterioSettingsRecipe:
			role := env["SERVER_MODE"]
			if role != "controller" && role != "host" {
				return notFound()
			}
			file = "/config-" + role + ".json"
			if e := read(".voltra/clusterio-mode"); e != nil {
				return e
			}
		case KspDMPRecipe:
			file = KspDMPSettingsPath
			if e := read(".voltra/ksp/dmp-release.json"); e != nil {
				return e
			}
		}
		if e := read(strings.TrimPrefix(file, "/")); e != nil {
			return e
		}
		rows, e := a.query(ctx, "SELECT port FROM allocations WHERE server_id=$1", s["id"])
		if e != nil {
			return e
		}
		ports := map[int64]bool{}
		for _, row := range rows {
			ports[num(row["port"])] = true
		}
		primary := num(asMap(asMap(config["allocations"])["default"])["port"])
		if primary < 1 || primary > 65535 || !ports[primary] {
			return notFound()
		}

		if recipe == KspDMPRecipe && env["STATUS_PORT"] != "" {
			status, e := strconv.ParseInt(env["STATUS_PORT"], 10, 32)
			if e != nil || status == primary || !ports[status] {
				return notFound()
			}
		}

		if recipe == VrisingSettingsRecipe {
			if len(ports) < 3 {
				return notFound()
			}

			var host struct {
				Port      int64
				QueryPort int64
				Rcon      struct{ Port int64 }
			}
			if json.Unmarshal(files[strings.TrimPrefix(file, "/")], &host) == nil {
				if host.Port != primary || !ports[host.QueryPort] || !ports[host.Rcon.Port] || host.QueryPort == host.Port || host.Rcon.Port == host.Port || host.QueryPort == host.Rcon.Port {
					return notFound()
				}
			}
			// The reviewed helper falls back to the first unused allocated port.
			// All allocation membership and primary identity enter the binding below.
		}

		switch recipe {
		case VrisingSettingsRecipe:
			authority = settingsAuthorityResult(file, in.Startup)
		case GtacSettingsRecipe:
			authority, err = GtacSettingsAuthority(recipe, in)
		case ClusterioSettingsRecipe:
			authority, err = clusterioSettingsSelection(recipe, str(egg["startup"]), in)
		case KspDMPRecipe:
			authority, err = KspDMPSettingsAuthority(recipe, file, in)
		}

	case NuclearRecipe, SolaceSettingsRecipe, NzPortableSettingsRecipe:

		if recipe != NzPortableSettingsRecipe {
			for key, value := range env {
				if value != "" && (strings.HasPrefix(key, "PYTHON") || strings.HasPrefix(key, "LD_") || key == "BASH_ENV" || key == "ENV") {
					return notFound()
				}
			}
		}
		file := NuclearSettingsPath
		if recipe == SolaceSettingsRecipe {
			file = SolaceSettingsDocument
		}
		if recipe == NzPortableSettingsRecipe {
			mode := env["NZP_ENGINE"]
			if mode == "" {
				mode = "vril"
			}
			if mode != "vril" && mode != "fte_legacy" {
				return notFound()
			}
			file = "/nzportable/" + mode + "/nzp/voltra-server.cfg"
			if !nzPortableSettingsAuthority(recipe, in.Startup, mode, file, files[".voltra/id_family_runtime.py"], files[".voltra/nzp_install.py"]) {
				return notFound()
			}
		}
		data, exists, e := a.quickSetupRead(ctx, s, file)
		if e != nil {
			return e
		}
		if !exists {
			return notFound()
		}
		files[strings.TrimPrefix(file, "/")] = data
		in.Files[strings.TrimPrefix(file, "/")] = data
		if recipe == NuclearRecipe {
			authority, err = nuclearSettingsAuthority(recipe, str(egg["startup"]), in)
		} else if recipe == SolaceSettingsRecipe {
			helpers := map[string][]byte{}
			for name, body := range semanticFiles {
				helpers[strings.TrimPrefix(name, ".voltra/")] = body
			}
			err = solaceSettingsAuthority(recipe, in.Startup, file, helpers)
			authority = settingsAuthorityResult(file, in.Startup)
		} else {
			authority = settingsAuthorityResult(file, in.Startup)
		}
		rows, e := a.query(ctx, "SELECT port FROM allocations WHERE server_id=$1", s["id"])
		if e != nil {
			return e
		}
		ports := map[int64]bool{}
		for _, row := range rows {
			ports[num(row["port"])] = true
		}
		primary := num(asMap(asMap(config["allocations"])["default"])["port"])
		if !ports[primary] || primary < 1 {
			return notFound()
		}
		if recipe != NzPortableSettingsRecipe {
			query, e := strconv.ParseInt(env["QUERY_PORT"], 10, 32)
			if e != nil || query == primary || !ports[query] {
				return notFound()
			}
		}
	case DstSettingsRecipe, "openrct2/egg-openrct2.json", RagecoopRecipe, RomesteadSettingsRecipe:
		file := RomesteadSettingsPath
		if env["VOLTRA_SERVER_ROOT"] != "" && env["VOLTRA_SERVER_ROOT"] != "/home/container" {
			return notFound()
		}
		for _, key := range []string{"OTHER_ARGS", "SERVER_ARGS", "STARTUP_ARGS"} {
			if env[key] != "" {
				return notFound()
			}
		}
		switch recipe {
		case DstSettingsRecipe:
			id, ok := env["CLUSTER_ID"]
			if !ok {
				id = "server"
			}
			if !dstClusterIdentity.MatchString(id) || in.Startup != dstSettingsStartup {
				return notFound()
			}
			file = "/DoNotStarveTogether/config/" + id + "/cluster.ini"
		case "openrct2/egg-openrct2.json":
			if in.Startup != openRCT2SettingsStartup {
				return notFound()
			}
			file = OpenRCT2SettingsPath
		case RagecoopRecipe:
			if in.Startup != ragecoopStartup {
				return notFound()
			}
			file = RagecoopPath
		case RomesteadSettingsRecipe:
			if in.Startup != romesteadSettingsStartup || env["VOLTRA_CRAFTING"] != "romestead" || env["SRCDS_APPID"] != "4763510" {
				return notFound()
			}
		}
		rows, e := a.query(ctx, "SELECT port FROM allocations WHERE server_id=$1", s["id"])
		if e != nil {
			return e
		}
		ports := map[int64]bool{}
		for _, row := range rows {
			ports[num(row["port"])] = true
		}
		primary := num(asMap(asMap(config["allocations"])["default"])["port"])
		if primary < 1 || primary > 65535 || !ports[primary] {
			return notFound()
		}
		if recipe == DstSettingsRecipe {
			if len(ports) < 6 {
				return notFound()
			}
			if env["ONLINE_MODE"] == "0" {
				count := 0
				for port := range ports {
					if port >= 10998 && port <= 11018 {
						count++
					}
				}
				if primary < 10998 || primary > 11018 || count < 2 {
					return notFound()
				}
			}
		}
		data, exists, e := a.quickSetupRead(ctx, s, file)
		if e != nil {
			return e
		}
		if !exists {
			return notFound()
		}
		files[file] = data
		authority = settingsAuthorityResult(file, in.Startup)

	case EnshroudedSettingsRecipe, ProjectZomboidSettingsRecipe, GroundBranchSettingsRecipe:
		file := EnshroudedSettingsPath
		if recipe == ProjectZomboidSettingsRecipe {
			name, ok := env["SERVER_NAME"]
			if !ok {
				name = "Pterodactyl"
			}
			if !projectZomboidSettingsName.MatchString(name) {
				return notFound()
			}
			file = "/.cache/Server/" + name + ".ini"
		}
		if recipe == GroundBranchSettingsRecipe {
			file = GroundBranchSettingsPath
		}
		rows, e := a.query(ctx, "SELECT port FROM allocations WHERE server_id=$1", s["id"])
		if e != nil {
			return e
		}
		ports := []string{}
		allocated := map[string]bool{}
		for _, row := range rows {
			p := strconv.Itoa(int(num(row["port"])))
			ports = append(ports, p)
			allocated[p] = true
		}
		primary := strconv.Itoa(int(num(asMap(asMap(config["allocations"])["default"])["port"])))
		if !allocated[primary] {
			return notFound()
		}
		env["SERVER_PORT"] = primary
		env["VOLTRA_ALLOCATED_PORTS"] = strings.Join(ports, ",")
		data, exists, e := a.quickSetupRead(ctx, s, file)
		if e != nil {
			return e
		}
		if !exists {
			return notFound()
		}
		for name, data := range files {
			in.Files[name] = data
		}
		in.Files[strings.TrimPrefix(file, "/")] = data
		files[strings.TrimPrefix(file, "/")] = data
		switch recipe {
		case EnshroudedSettingsRecipe:
			authority, err = EnshroudedSettingsAuthority(recipe, str(egg["startup"]), in)
		case ProjectZomboidSettingsRecipe:
			authority, err = ProjectZomboidSettingsAuthority(recipe, str(egg["startup"]), in)
		case GroundBranchSettingsRecipe:
			authority, err = GroundBranchSettingsAuthority(recipe, str(egg["startup"]), mappingBytes, in)
		}
	case MordhauLinuxSettingsRecipe, Kf2SettingsRecipe, VeinSettingsRecipe:
		file, app := MordhauLinuxSettingsPath, "629800"
		keys := []string{"QUERY_PORT", "BEACON_PORT"}
		if recipe == VeinSettingsRecipe {
			file, app, keys = VeinSettingsPath, "2131400", []string{"QUERY_PORT"}
		}
		if recipe == Kf2SettingsRecipe {
			file, app, keys = Kf2SettingsGamePath, "232130", []string{"QUERY_PORT"}
			if e := kf2SettingsAuthority(recipe, str(egg["startup"]), in.Startup, env); e != nil {
				return notFound()
			}
		}
		if env["SRCDS_APPID"] != app {
			return notFound()
		}
		for _, key := range []string{"OTHER_ARGS", "SERVER_ARGS", "STARTUP_ARGS", "EXTRA_FLAGS"} {
			if env[key] != "" {
				return notFound()
			}
		}
		rows, e := a.query(ctx, "SELECT port FROM allocations WHERE server_id=$1", s["id"])
		if e != nil {
			return e
		}
		ports := map[int]bool{}
		for _, row := range rows {
			ports[int(num(row["port"]))] = true
		}
		primary := int(num(asMap(asMap(config["allocations"])["default"])["port"]))
		used := map[int]bool{primary: true}
		if primary < 1 || primary > 65535 || !ports[primary] {
			return notFound()
		}
		resolved := map[string]int{}
		for _, key := range keys {
			if recipe == MordhauLinuxSettingsRecipe && env[key] == "" {
				continue
			}
			port, err := strconv.Atoi(env[key])
			if err != nil || port < 1 || port > 65535 || !ports[port] || used[port] {
				return notFound()
			}
			used[port] = true
			resolved[key] = port
		}
		if recipe == MordhauLinuxSettingsRecipe {
			for _, key := range keys {
				if _, ok := resolved[key]; !ok {
					best := 65536
					for port := range ports {
						if !used[port] && port < best {
							best = port
						}
					}
					if best == 65536 {
						return notFound()
					}
					resolved[key] = best
					used[best] = true
				}
			}
			allocated := []int{}
			for port := range ports {
				allocated = append(allocated, port)
			}
			if !mordhauLinuxSettingsAdmission(recipe, file, in.Startup, str(egg["startup"]), primary, resolved["QUERY_PORT"], resolved["BEACON_PORT"], allocated) {
				return notFound()
			}
		}

		paths := []string{file}
		if recipe == Kf2SettingsRecipe {
			paths = append(paths, Kf2SettingsWebPath)
		}
		for _, path := range paths {
			data, exists, err := a.quickSetupRead(ctx, s, path)
			if err != nil {
				return err
			}
			if !exists {
				return notFound()
			}
			files[path] = data
		}
		if recipe == Kf2SettingsRecipe {
			if e := wave43KF2Tuple(files, env, primary, ports); e != nil {
				return e
			}
		}
		authority = settingsAuthorityResult(file, in.Startup)

	case FrozenflameSettingsRecipe, IosoccerSettingsRecipe, OnsetSettingsRecipe, WurmSettingsRecipe, OhdSettingsRecipe, "renown/egg-renown.json":
		// Exact current emitted modules above establish the CONFIG selection
		// contract. They do not attest a running child or plugin behavior.
		file, app := "", ""
		switch recipe {
		case FrozenflameSettingsRecipe:
			file, app = FrozenflameSettingsPath, "1348640"
		case IosoccerSettingsRecipe:
			file, app = IosoccerSettingsPath, "673990"
		case OnsetSettingsRecipe:
			file, app = "/server_config.json", "1204170"
		case WurmSettingsRecipe:
			if env["VOLTRA_NATIVE_FAMILY"] != "wurm" {
				return notFound()
			}
			file, app = WurmSettingsPath, "402370"
		case OhdSettingsRecipe:
			file, app = OhdSettingsPath, "950900"
		default:
			file = RenownSettingsDirectory + "Game.ini"
		}
		if app != "" && env["SRCDS_APPID"] != app {
			return notFound()
		}
		paths := []string{file}
		if recipe == "renown/egg-renown.json" {
			paths = append(paths, RenownSettingsDirectory+"Engine.ini")
		}
		for _, path := range paths {
			data, exists, e := a.quickSetupRead(ctx, s, path)
			if e != nil {
				return e
			}
			if !exists {
				return notFound()
			}
			files[path] = data
		}
		authority = settingsAuthorityResult(file, in.Startup)
	case "puck/egg-puck.json", RustStagingSettingsRecipe, UnturnedSettingsRecipe:
		read := func(name string) error {
			data, exists, e := a.quickSetupRead(ctx, s, "/"+strings.TrimPrefix(name, "/"))
			if e != nil {
				return e
			}
			if !exists {
				return notFound()
			}
			files[name] = data
			return nil
		}
		var path string
		switch recipe {
		case "puck/egg-puck.json":
			for name := range puckAuthoritySources {
				if e := read(name); e != nil {
					return e
				}
			}
			for _, name := range []string{"start_server.sh", "server_config.json"} {
				if e := read(name); e != nil {
					return e
				}
			}
			authority, err = puckSettingsAuthority(recipe, str(egg["startup"]), SettingsAuthorityInput{Startup: in.Startup, Env: env, Files: files})
		case RustStagingSettingsRecipe:
			id, ok := env["SERVER_ID"]
			if !ok {
				id = "rust"
			}
			if !rustStagingIdentity.MatchString(id) {
				return notFound()
			}
			path = "/server/" + id + "/cfg/server.cfg"
			for name := range RustStagingAuthorityHelpers {
				if e := read(name); e != nil {
					return e
				}
			}
			if e := read(path); e != nil {
				return e
			}
			b, e := ResolveRustStagingAuthority(RustStagingAuthorityInput{Recipe: recipe, Startup: in.Startup, EggStartup: str(egg["startup"]), Path: path, ConfigFiles: mappingBytes, Env: env, Files: files})
			err = e
			authority = SettingsPathAuthority{Path: b.Path, Revision: b.Revision}
		default:
			id, ok := env["SRV_ID"]
			if !ok {
				id = "PterodactylUnturned"
			}
			if !unturnedSettingsIdentity.MatchString(id) {
				return notFound()
			}
			path = "Servers/" + id + "/Server/Commands.dat"
			for name := range unturnedSettingsSources {
				if e := read(name); e != nil {
					return e
				}
			}
			if e := read(path); e != nil {
				return e
			}
			authority, err = UnturnedSettingsAuthority(recipe, str(egg["startup"]), SettingsAuthorityInput{Startup: in.Startup, Env: env, Files: files})
		}
	case AbioticSettingsRecipe, AstrocolonySettingsRecipe, "Aska/egg-aska.json", AvorionSettingsRecipe, CarrierAuthorityRecipe:
		// Exact emitted launcher modules above prove the reviewed CONFIG selection
		// contract. Wings does not expose native child argv or runtime consumption.
		file := ""
		switch recipe {
		case AbioticSettingsRecipe:
			if in.Startup != abioticSettingsStartup {
				return notFound()
			}
			file = AbioticSettingsPath
		case AstrocolonySettingsRecipe:
			if in.Startup != "exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/astrocolony_runtime.py run" || env["SRCDS_APPID"] != "2934900" {
				return notFound()
			}
			primary := int(num(asMap(asMap(config["allocations"])["default"])["port"]))
			query, eq := strconv.Atoi(env["SERVER_QUERY_PORT"])
			if eq != nil || primary < 1 || primary > 65535 || query < 1 || query > 65535 || primary == query {
				return notFound()
			}
			allocated, e := a.query(ctx, "SELECT port FROM allocations WHERE server_id=$1", s["id"])
			if e != nil {
				return e
			}
			ports := map[int64]bool{}
			for _, row := range allocated {
				ports[num(row["port"])] = true
			}
			if !ports[int64(primary)] || !ports[int64(query)] {
				return notFound()
			}
			file = AstrocolonySettingsPath
		case "Aska/egg-aska.json":
			if in.Startup != "exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/aska_file_authority.py run aska" {
				return notFound()
			}
			file = AskaSettingsPath
		case CarrierAuthorityRecipe:
			if in.Startup != carrierAuthorityStartup {
				return notFound()
			}
			file = CarrierSettingsPath
		case AvorionSettingsRecipe:
			if in.Startup != avorionSettingsStartup {
				return notFound()
			}
			galaxy, ok := env["GALAXY_NAME"]
			if !ok {
				galaxy = "Avorion"
			}
			if galaxy == "" || galaxy == "." || galaxy == ".." || len(galaxy) > 32 || strings.ContainsAny(galaxy, "/\\") {
				return notFound()
			}
			for _, c := range galaxy {
				if c < 32 || c == 127 {
					return notFound()
				}
			}
			file = "/galaxy/" + galaxy + "/server.ini"
		}
		data, exists, e := a.quickSetupRead(ctx, s, file)
		if e != nil {
			return e
		}
		if !exists {
			return notFound()
		}
		files[file] = data
		authority = settingsAuthorityResult(file, in.Startup)
	case "holdfast/egg-holdfast-na-w.json", HurtworldSettingsRecipe, "longvinter/egg-longvinter.json":
		file := LongvinterSettingsPath
		app := "1007"
		portKeys := []string{"QUERY_PORT"}
		if recipe == HurtworldSettingsRecipe {
			file = HurtworldSettingsPath
			app = "405100"
		}
		if recipe == "holdfast/egg-holdfast-na-w.json" {
			app = "1424230"
			portKeys = []string{"SERVER_COMM_PORT", "SERVER_QUERY_PORT"}
			name := env["SERVER_CONFIG_PATH"]
			if name == "" || len(name) > 200 || strings.ContainsAny(name, "\\:\x00\r\n") {
				return notFound()
			}
			if _, e := QuickPathParts("/" + name); e != nil {
				return notFound()
			}
			file = "/holdfastnaw-dedicated/configs/" + name
		}
		if env["SRCDS_APPID"] != "" && env["SRCDS_APPID"] != app {
			return notFound()
		}
		allocated, e := a.query(ctx, "SELECT port FROM allocations WHERE server_id=$1", s["id"])
		if e != nil {
			return e
		}
		ports := map[int64]bool{}
		for _, row := range allocated {
			ports[num(row["port"])] = true
		}
		primary := num(asMap(asMap(config["allocations"])["default"])["port"])
		seen := map[int64]bool{primary: true}
		if !ports[primary] {
			return notFound()
		}
		for _, key := range portKeys {
			port, e := strconv.ParseInt(env[key], 10, 32)
			if e != nil || port < 1 || port > 65535 || !ports[port] || seen[port] {
				return notFound()
			}
			seen[port] = true
		}
		if recipe == HurtworldSettingsRecipe {
			data, exists, e := a.quickSetupRead(ctx, s, "/autoexec.cfg")
			if e != nil {
				return e
			}
			if exists {
				files["/autoexec.cfg"] = data
				for _, line := range strings.Split(string(data), "\n") {
					words := strings.Fields(line)
					if len(words) == 0 || strings.HasPrefix(words[0], "#") {
						continue
					}
					switch strings.ToLower(words[0]) {
					case "servername", "maxplayers", "creativemode", "host", "queryport", "exec", "alias":
						return notFound()
					}
				}
			}
		}
		data, exists, e := a.quickSetupRead(ctx, s, file)
		if e != nil {
			return e
		}
		if !exists {
			return notFound()
		}
		files[file] = data
		authority = settingsAuthorityResult(file, in.Startup)

	case FiveMRecipe:
		if env["TXADMIN_ENABLE"] != "0" {
			return notFound()
		}
		authority = settingsAuthorityResult("/server.cfg", in.Startup)
	case "arma/arma3/egg-arma3.json":
		revision, e := arma3ActiveSettingsAuthority(in.Startup, "/server.cfg", env, files)
		if e != nil {
			return notFound()
		}
		authority = SettingsPathAuthority{Path: "/server.cfg", Revision: revision}
	case ReforgerSettingsRecipe:
		primary := asMap(asMap(config["allocations"])["default"])
		rows, e := a.query(ctx, "SELECT port FROM allocations WHERE server_id=$1 AND ip=$2 ORDER BY port", s["id"], primary["ip"])
		if e != nil {
			return e
		}
		ports := []any{}
		found := false
		for _, row := range rows {
			ports = append(ports, row["port"])
			if num(row["port"]) == num(primary["port"]) {
				found = true
			}
		}
		if !found || num(primary["port"]) < 1 {
			return notFound()
		}
		egg["_reforger_primary_port"] = primary["port"]
		egg["_reforger_allocated_ports"] = ports
		allocationBinding, _ := json.Marshal([]any{primary, ports})
		authority = SettingsPathAuthority{Path: "/config.json", Revision: SettingsAuthorityHash(allocationBinding)}
	case Hl2dmSettingsRecipe:
		if in.Startup != Hl2dmSettingsStartup {
			return notFound()
		}
		authority = settingsAuthorityResult(Hl2dmSettingsPath, in.Startup)
	case Cs2AuthorityRecipe:
		authority, err = cs2CurrentSettingsAuthority(in)
	case Tf2SettingsRecipe, GmodSettingsRecipe, NmrihSettingsRecipe, FofSettingsRecipe:
		file, app, game := Tf2SettingsPath, "232250", "tf"
		if recipe == GmodSettingsRecipe {
			file, app, game = GmodSettingsPath, "4020", "garrysmod"
			if env["GAMEMODE"] != "sandbox" {
				return notFound()
			}
		}
		if recipe == FofSettingsRecipe {
			if in.Startup != FofSettingsStartup || !FofSourceHelpers(files) {
				return notFound()
			}
			for _, key := range []string{"VOLTRA_SERVER_ROOT", "HOME", "PYTHONHOME", "LD_LIBRARY_PATH", "OTHER_ARGS", "SERVER_ARGS", "STARTUP_ARGS"} {
				if env[key] != "" {
					return notFound()
				}
			}
			for _, name := range []string{"banned_user.cfg", "banned_ip.cfg"} {
				file := "/fof/cfg/" + name
				body, exists, readErr := a.quickSetupRead(ctx, s, file)
				if readErr != nil {
					return readErr
				}
				if exists && !FofBanDataSafe(body, name == "banned_ip.cfg") {
					return notFound()
				}
				if exists {
					files[file] = body
				} else {
					files[file] = []byte("missing")
				}
			}
			file, app, game = FofSettingsPath, "295230", "fof"
		}
		if recipe == NmrihSettingsRecipe || recipe == FofSettingsRecipe {
			if recipe == NmrihSettingsRecipe {
				file, app, game = NmrihSettingsPath, "317670", "nmrih"
			}
			// The installed wave413 helper reserves explicit roles first, then
			// fills zero-valued client/TV roles from remaining allocated ports.
			used := map[string]bool{}
			ports := strings.Split(env["VOLTRA_ALLOCATED_PORTS"], ",")
			for _, port := range ports {
				n, e := strconv.Atoi(port)
				if e != nil || n < 1025 || n > 65535 || used[port] {
					return notFound()
				}
				used[port] = true
			}
			primary := strconv.FormatInt(num(asMap(asMap(config["allocations"])["default"])["port"]), 10)
			if len(ports) < 3 || !used[primary] || recipe == FofSettingsRecipe && !FofPrimaryPortMatches(env, primary) {
				return notFound()
			}
			roles := map[string]bool{primary: true}
			for _, key := range []string{"SRCDS_CPORT", "SRCDS_STV"} {
				v := env[key]
				if v == "0" {
					continue
				}
				if !used[v] || roles[v] {
					return notFound()
				}
				roles[v] = true
			}
			for _, key := range []string{"OTHER_ARGS", "SERVER_ARGS", "STARTUP_ARGS"} {
				if env[key] != "" {
					return notFound()
				}
			}
			binding, _ := json.Marshal([]any{primary, ports, env["SRCDS_CPORT"], env["SRCDS_STV"]})
			if recipe == FofSettingsRecipe {
				files["fof-allocation-binding"] = binding
			} else {
				files["nmrih-allocation-binding"] = binding
			}
		}
		if env["SRCDS_APPID"] != app || env["SRCDS_GAME"] != "" && env["SRCDS_GAME"] != game {
			return notFound()
		}
		wrapper := "/" + game + "/cfg/voltra-server.cfg"
		data, exists, e := a.quickSetupRead(ctx, s, wrapper)
		if e != nil {
			return e
		}
		if !exists || string(data) != "exec server.cfg\nexec voltra-managed.cfg\n" {
			return notFound()
		}
		files[wrapper] = data
		managed := "/" + game + "/cfg/voltra-managed.cfg"
		md, exists, e := a.quickSetupRead(ctx, s, managed)
		if e != nil {
			return e
		}
		if !exists {
			return notFound()
		}
		// Only the reviewed startup-owned assignments may follow the native document.
		seen := map[string]bool{}
		for _, line := range strings.Split(string(md), "\n") {
			line = strings.TrimSpace(line)
			if line == "" || strings.HasPrefix(line, "//") {
				continue
			}
			m := sourceCvarLine.FindStringSubmatch(line)
			if m == nil {
				return notFound()
			}
			key := strings.ToLower(m[2])
			if seen[key] {
				return notFound()
			}
			seen[key] = true
			switch key {
			case "hostname", "sv_password", "rcon_password", "sv_lan", "tv_enable", "tv_port":
			default:
				return notFound()
			}
		}
		files[managed] = md
		authority = settingsAuthorityResult(file, in.Startup)
	case Ss14SettingsRecipe:
		if in.Startup != "exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/ss14_parity.py run" {
			return notFound()
		}
		authority = settingsAuthorityResult(Ss14SettingsPath, in.Startup)
	case Jc3SettingsRecipe, PlainsSettingsRecipe:
		file, app := "/config.json", "619960"
		keys := []string{"QUERY_PORT", "STEAM_PORT", "HTTP_PORT"}
		if recipe == PlainsSettingsRecipe {
			file, app = "/configs/server.json", "2227360"
			keys = []string{"QUERY_PORT"}
		}
		if env["SRCDS_APPID"] != app {
			return notFound()
		}
		for _, key := range []string{"OTHER_ARGS", "SERVER_ARGS", "STARTUP_ARGS"} {
			if env[key] != "" {
				return notFound()
			}
		}
		rows, e := a.query(ctx, "SELECT port FROM allocations WHERE server_id=$1 ORDER BY id", s["id"])
		if e != nil {
			return e
		}
		ports := map[int64]bool{}
		for _, row := range rows {
			ports[num(row["port"])] = true
		}
		primary := num(asMap(asMap(config["allocations"])["default"])["port"])
		used := map[int64]bool{primary: true}
		if primary < 1 || primary > 65535 || !ports[primary] {
			return notFound()
		}
		for _, key := range keys {
			value := env[key]
			if recipe == Jc3SettingsRecipe && value == "" {
				for _, candidate := range strings.Split(env["VOLTRA_ALLOCATED_PORTS"], ",") {
					n, parseErr := strconv.ParseInt(strings.TrimSpace(candidate), 10, 32)
					if parseErr == nil && !used[n] {
						value = strings.TrimSpace(candidate)
						break
					}
				}
			}
			port, e := strconv.ParseInt(value, 10, 32)
			if e != nil || port < 1 || port > 65535 || !ports[port] || used[port] {
				return notFound()
			}
			used[port] = true
		}
		data, exists, e := a.quickSetupRead(ctx, s, file)
		if e != nil {
			return e
		}
		if !exists {
			return notFound()
		}
		if _, e = parseWave40Settings(recipe, data); e != nil {
			return e
		}
		files[file] = data
		authority = settingsAuthorityResult(file, in.Startup)
	case StationeersVanillaRecipe, BedrockVanillaRecipe, RisingUnityRecipe:
		file := "/server.properties"
		if recipe == RisingUnityRecipe {
			if env["SRCDS_APPID"] != "339010" {
				return notFound()
			}
		}
		if recipe == StationeersVanillaRecipe {
			if env["VOLTRA_NATIVE_FAMILY"] != "stationeers" || env["VOLTRA_STATIONEERS_VARIANT"] != "vanilla" {
				return notFound()
			}
			file = StationeersBepinexSettingsPath
		}
		data, exists, e := a.quickSetupRead(ctx, s, file)
		if e != nil {
			return e
		}
		if !exists {
			return notFound()
		}
		files[file] = data
		authority = settingsAuthorityResult(file, in.Startup)
	case StationeersBepinexRecipe:
		data, exists, e := a.quickSetupRead(ctx, s, StationeersBepinexSettingsPath)
		if e != nil {
			return e
		}
		if !exists {
			return notFound()
		}
		in.Files["setting.xml"] = data
		files["setting.xml"] = data
		authority, err = StationeersBepinexSettingsAuthority(recipe, str(egg["startup"]), in)
	case AapgSettingsRecipe:
		if in.Startup != aapgSettingsStartup || env["VOLTRA_TACTICAL_NEXT"] != "aapg" || env["SRCDS_APPID"] != "203300" || env["WINDOWS_INSTALL"] != "" && env["WINDOWS_INSTALL"] != "0" {
			return notFound()
		}
		authority = settingsAuthorityResult(AapgSettingsPath, in.Startup)
	case SandstormSettingsRecipe:
		if env["VOLTRA_TACTICAL"] != "sandstorm" || env["SRCDS_APPID"] != "" && env["SRCDS_APPID"] != "581330" || env["WINDOWS_INSTALL"] != "" && env["WINDOWS_INSTALL"] != "0" {
			return notFound()
		}
		if e := validateSandstormSettingsAuthority(recipe, SandstormSettingsPath, in.Startup, env["ADDSWITCHES"], asMap(egg["config_files"])); e != nil {
			return notFound()
		}
		authority = settingsAuthorityResult(SandstormSettingsPath, in.Startup)
	case "humanitz/egg-humanit-z.json":
		if in.Startup != "exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/humanitz_wave28_runtime.py" || env["SRCDS_APPID"] != "2728330" {
			return notFound()
		}
		selected := ""
		for _, binary := range []string{"/HumanitZServer/Binaries/Linux/HumanitZServer-Linux-Shipping", "/TSSGame/Binaries/Linux/TSSGameServer-Linux-Shipping"} {
			folder, leaf, _ := strings.Cut(binary[1:], "/Binaries/")
			entries, exists, e := a.quickSetupList(ctx, s, "/"+folder+"/Binaries/Linux")
			if e != nil {
				return e
			}
			if !exists {
				continue
			}
			entry, exists, e := QuickFindEntry(entries, strings.TrimPrefix(leaf, "Linux/"))
			if e != nil {
				return e
			}
			if !exists {
				continue
			}
			if !QuickFileEntry(entry) || selected != "" {
				return notFound()
			}
			selected = "/" + folder + "/GameServerSettings.ini"
		}
		if selected == "" {
			return notFound()
		}
		data, exists, e := a.quickSetupRead(ctx, s, selected)
		if e != nil {
			return e
		}
		if !exists {
			return notFound()
		}
		files[selected] = data
		authority = settingsAuthorityResult(selected, in.Startup)
	case "the_isle/evrima/egg-the-isle.json":
		if in.Startup != "exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/isle-evrima.py run" {
			return notFound()
		}
		authority = settingsAuthorityResult(IsleEvrimaSettingsPath, in.Startup)

	case "truck-simulator/american-truck-simulator/egg-american-truck-simulator-dedicated-server.json", "truck-simulator/euro-truck-simulator2/egg-euro-truck-simulator2-dedicated-server.json":
		if env["HOME"] != "" && env["HOME"] != "/home/container" || env["XDG_DATA_HOME"] != "" && env["XDG_DATA_HOME"] != "/home/container/.local/share" {
			return notFound()
		}
		folder := "American Truck Simulator"
		if recipe == "truck-simulator/euro-truck-simulator2/egg-euro-truck-simulator2-dedicated-server.json" {
			folder = "Euro Truck Simulator 2"
		}
		authority = settingsAuthorityResult("/.local/share/"+folder+"/server_config.sii", in.Startup)
	case StarboundAuthorityRecipe:
		data, exists, e := a.quickSetupRead(ctx, s, "/sbinit.config")
		if e != nil {
			return e
		}
		if !exists {
			return notFound()
		}
		files["sbinit.config"] = data
		b, e := starboundActiveConfigAuthority(starboundAuthorityInput{Recipe: recipe, Startup: in.Startup, EggStartup: str(egg["startup"]), RuntimeSHA256: SettingsAuthorityHash([]byte(strings.TrimSuffix(string(files[".voltra/starbound_runtime.py"]), "\n"))), Environment: env, BootState: "regular", Boot: data})
		err = e
		authority = SettingsPathAuthority{Path: b.Path, Revision: b.Digest}
	case ValheimPlusSettingsRecipe:
		plugin, exists, e := a.quickSetupRead(ctx, s, ValheimPlusPluginPath)
		if e != nil {
			return e
		}
		if !exists || SettingsAuthorityHash(plugin) != valheimPlusPluginSHA {
			return notFound()
		}
		files[ValheimPlusPluginPath] = plugin
		authority = settingsAuthorityResult(ValheimPlusSettingsPath, in.Startup+"\x00"+valheimPlusPluginSHA)
	case BepinexLoggingRecipe:
		authority = settingsAuthorityResult(BepinexLoggingPath, in.Startup)
	case "squad/egg-squad.json":
		mappings, _ := json.Marshal(egg["config_files"])
		err = ValidateSquadSettingsAuthority(SquadAuthorityInput{Recipe: recipe, Path: SquadSettingsPath, Startup: in.Startup, EggStartup: str(egg["startup"]), ConfigFiles: mappings, Environment: env, Helpers: files})
		authority = settingsAuthorityResult(SquadSettingsPath, in.Startup)
	case "the_forest/egg-the-forest.json":
		authority, err = ForestSettingsAuthority(in)
	case "subnautica_nitrox_mod/egg-subnautica.json":
		data, exists, e := a.quickSetupRead(ctx, s, "/NitroxData/nitrox.cfg")
		if e != nil {
			return e
		}
		if exists {
			in.Files["NitroxData/nitrox.cfg"] = data
			files["NitroxData/nitrox.cfg"] = data
		}
		authority, err = NitroxSettingsAuthority(in)
	default:
		if env["SRCDS_APPID"] != "" && env["SRCDS_APPID"] != "3937860" || env["WINDOWS_INSTALL"] != "" && env["WINDOWS_INSTALL"] != "1" {
			return notFound()
		}
		authority = settingsAuthorityResult(VoyagersSettingsPath, str(s["startup"]))
	}
	if err != nil {
		return notFound()
	}
	binding, _ := json.Marshal(struct {
		Startup  string
		Env      map[string]string
		Files    map[string][]byte
		Path     string
		Revision string
	}{str(s["startup"]), env, files, authority.Path, authority.Revision})
	egg["_campaign_parser_path"] = authority.Path
	egg["_campaign_parser_binding"] = SettingsAuthorityHash(binding)
	return nil
}
func campaignParserRevision(egg M, file string, data []byte) string {
	return QuickRevision("native"+str(egg["_campaign_parser_binding"]), file, data, true)
}

func CampaignParserPathAllowed(egg M, file string) bool {
	if IsRecipe(egg, TshockAuthorityRecipe) || IsRecipe(egg, TshockLegacyAuthorityRecipe) {
		return str(egg["_campaign_parser_path"]) != "" && TshockAuthorityDocument(file)
	}
	if IsRecipe(egg, ConanAuthorityRecipe) {
		return str(egg["_campaign_parser_path"]) != "" && conanSettingsDocument(file)
	}
	if file == "" || str(egg["_campaign_parser_path"]) == "" {
		return false
	}
	if IsRecipe(egg, "arma/arma3/egg-arma3.json") {
		return file == "/server.cfg" || file == "/basic.cfg"
	}
	if IsRecipe(egg, KspLMPRecipe) {
		root, _ := kspLMPSchema(file)
		return root != ""
	}
	if IsRecipe(egg, DstSettingsRecipe) {
		base := strings.TrimSuffix(str(egg["_campaign_parser_path"]), "/cluster.ini")
		return file == base+"/cluster.ini" || file == base+"/Master/server.ini" || file == base+"/Caves/server.ini"
	}
	if IsRecipe(egg, Kf2SettingsRecipe) {
		return kf2SettingsDocument(file)
	}
	if IsRecipe(egg, "renown/egg-renown.json") {
		return file == RenownSettingsDirectory+"Game.ini" || file == RenownSettingsDirectory+"Engine.ini"
	}
	return file == str(egg["_campaign_parser_path"])
}
