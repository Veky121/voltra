package panel

import (
	"context"
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"errors"
	"fmt"
	"github.com/jackc/pgx/v5"
	"net/http"
	"net/url"
	"regexp"
	"strings"
)

//go:embed game_library/minecraft-install.sh
var minecraftInstallScript string

//go:embed game_library/minecraft-install.py
var minecraftInstallPython string

const minecraftManifestURL = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json"
const minecraftLibraryEggUUID = "9c312e92-2724-4e87-822f-70da62ab1521"
const gameLibraryNestUUID = "6bc33bb9-5268-4aa7-b8e8-f31c10b13238"

type minecraftManifest struct {
	Latest struct {
		Release string `json:"release"`
	} `json:"latest"`
	Versions []struct {
		ID   string `json:"id"`
		Type string `json:"type"`
		URL  string `json:"url"`
	} `json:"versions"`
}
type minecraftMetadata struct {
	ID          string `json:"id"`
	JavaVersion struct {
		MajorVersion int `json:"majorVersion"`
	} `json:"javaVersion"`
	Downloads struct {
		Server struct {
			URL  string `json:"url"`
			SHA1 string `json:"sha1"`
		} `json:"server"`
	} `json:"downloads"`
}

func (a *App) registerGameLibrary(mux *http.ServeMux) {
	a.registerGameTemplates(mux)
	mux.HandleFunc("GET /api/client/game-library", a.gameLibraryCatalog)
	mux.HandleFunc("GET /api/client/game-library/minecraft", a.gameLibraryMinecraft)
	mux.HandleFunc("POST /api/client/game-library/minecraft/install", a.gameLibraryInstallMinecraft)
	mux.HandleFunc("POST /api/client/game-library/minecraft/ports", a.minecraftGamePorts)
	mux.HandleFunc("GET /api/client/game-library/minecraft/loaders", a.gameLibraryLoaderVersions)
	mux.HandleFunc("GET /api/client/game-library/minecraft/modpacks", a.gameLibraryModpacks)
	mux.HandleFunc("GET /api/client/game-library/minecraft/modpacks/{provider}/{project}/versions", a.gameLibraryModpackVersions)
}
func (a *App) gameLibraryCatalog(w http.ResponseWriter, r *http.Request) {
	user, err := a.user(r)
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, 200, item("game_library", M{"can_install": boolean(user["root_admin"]), "games": []M{{"id": "minecraft", "name": "Minecraft", "edition": "Java Edition", "category": "Sandbox", "description": "Create a Vanilla, plugin, modded or modpack server."}, {"id": "satisfactory", "name": "Satisfactory", "category": "Factory building", "description": "Build a factory with friends. Manage sessions through the built-in Server Manager."}, {"id": "palworld", "name": "Palworld", "category": "Survival", "description": "Create a persistent world with simple server and gameplay settings."}}}))
}
func (a *App) minecraftJSON(ctx context.Context, address string, target any) error {
	return a.minecraftProviderJSON(ctx, address, "", target)
}
func (a *App) minecraftVersions(ctx context.Context) (minecraftManifest, error) {
	var manifest minecraftManifest
	err := a.minecraftJSON(ctx, minecraftManifestURL, &manifest)
	if err == nil && (manifest.Latest.Release == "" || len(manifest.Versions) == 0) {
		err = APIError{502, "MinecraftMetadataUnavailable", "No Minecraft releases are available. Try again shortly."}
	}
	return manifest, err
}
func minecraftOfficialURL(raw string, hosts ...string) bool {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.User != nil || u.Port() != "" || u.Fragment != "" {
		return false
	}
	for _, host := range hosts {
		if u.Host == host {
			return true
		}
	}
	return false
}
func (a *App) gameLibraryMinecraft(w http.ResponseWriter, r *http.Request) {
	r = r.WithContext(providerMetadataBrowse(r.Context()))
	user, err := a.user(r)
	if err != nil {
		fail(w, err)
		return
	}
	manifest, err := a.minecraftVersions(r.Context())
	if err != nil {
		fail(w, err)
		return
	}
	versions := []string{}
	for _, v := range manifest.Versions {
		if v.Type == "release" && minecraftSupportedRelease(v.ID) {
			versions = append(versions, v.ID)
		}
	}
	nodes := []M{}
	if boolean(user["root_admin"]) {
		nodes, err = a.query(r.Context(), `SELECT n.*,(SELECT COUNT(*) FROM allocations al WHERE al.node_id=n.id AND al.server_id IS NULL) free_allocations FROM nodes n WHERE n.public=true AND n.maintenance_mode=false ORDER BY n.name`)
		if err != nil {
			fail(w, err)
			return
		}
	}
	runtimes, err := a.javaRuntimes(r.Context())
	if err != nil {
		fail(w, err)
		return
	}
	for i, node := range nodes {
		reason := ""
		if e := a.gameNodeResources(r.Context(), node, 10240, 1024); e != nil {
			reason = e.Error()
		}
		if reason == "" {
			// Listing rows retain encrypted credentials. Resolve the node through
			// the ordinary daemon path before probing its availability.
			resolved, e := a.node(r.Context(), num(node["id"]))
			if e != nil {
				fail(w, e)
				return
			}
			probe, e := a.daemon(r.Context(), resolved, "GET", "/api/system?v=2", nil)
			if e != nil {
				reason = "Node is unreachable."
			} else {
				probe.Body.Close()
			}
		}
		nodes[i] = M{"id": node["id"], "name": node["name"], "free_allocations": node["free_allocations"], "automatic_ports": true, "setup_available": reason == "", "unavailable_reason": reason}
	}
	writeJSON(w, 200, item("minecraft_options", M{"latest": manifest.Latest.Release, "versions": versions, "nodes": nodes, "can_install": boolean(user["root_admin"]), "loaders": minecraftLoaders, "runtimes": runtimes}))
}
func minecraftSupportedRelease(version string) bool {
	return regexp.MustCompile(`^[0-9]+\.[0-9]+(?:\.[0-9]+)?$`).MatchString(version)
}
func (a *App) minecraftRelease(ctx context.Context, version string) (minecraftMetadata, string, error) {
	var metadata minecraftMetadata
	manifest, err := a.minecraftVersions(ctx)
	if err != nil {
		return metadata, "", err
	}
	if version == "latest" {
		version = manifest.Latest.Release
	}
	address := ""
	for _, v := range manifest.Versions {
		if v.ID == version && v.Type == "release" {
			address = v.URL
			break
		}
	}
	if address == "" {
		return metadata, "", bad("Select an available Minecraft release version.")
	}
	if !minecraftOfficialURL(address, "piston-meta.mojang.com", "launchermeta.mojang.com") {
		return metadata, "", bad("Minecraft returned an unsupported version metadata address.")
	}
	if err = a.minecraftJSON(ctx, address, &metadata); err != nil {
		return metadata, "", err
	}
	if metadata.ID != version || !minecraftOfficialURL(metadata.Downloads.Server.URL, "piston-data.mojang.com", "launcher.mojang.com") || !regexp.MustCompile(`^[a-f0-9]{40}$`).MatchString(metadata.Downloads.Server.SHA1) {
		return metadata, "", bad("This Minecraft version does not provide a supported server download.")
	}
	java := metadata.JavaVersion.MajorVersion
	if java == 0 {
		java = minecraftFallbackJava(version)
		metadata.JavaVersion.MajorVersion = java
	}
	if java < 8 || java > 99 {
		return metadata, "", bad("This release declares an unsupported Java requirement.")
	}
	return metadata, fmt.Sprintf("ghcr.io/pterodactyl/yolks:java_%d", java), nil
}
func (a *App) gameLibraryMinecraftEgg(ctx context.Context) (M, error) {
	return a.gameLibraryMinecraftLoaderEgg(ctx, "vanilla")
}

// The former installer tag resolves to Bullseye, whose security package URLs
// no longer supply the Python bootstrap. Pin the maintained multiarch base.
const minecraftInstallerImage = "debian@sha256:7ff6ba31527b9e336162fa061746c366c4b2032f4d2cff2078bea43f78efe3f8"

func (a *App) gameLibraryMinecraftLoaderEgg(ctx context.Context, loader string, legacy ...bool) (M, error) {
	if !minecraftLoaderKnown(loader) {
		return nil, bad("Select a supported Minecraft loader.")
	}
	// A revisioned UUID leaves existing vanilla templates and admin edits intact.
	index := 0
	for i, v := range minecraftLoaders {
		if v["id"] == loader {
			index = i + 1
		}
	}
	legacyForge := loader == "forge" && len(legacy) > 0 && legacy[0]
	if legacyForge {
		index += 100
	}
	eggUUID := fmt.Sprintf("1da8cb7a-ceee-44c0-93d1-%012d", index)
	// Concurrent installs share one managed template; existing admin edits survive.
	tx, err := a.DB.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtext('voltra:game-library:minecraft'))"); err != nil {
		return nil, err
	}
	var nestID, eggID int64
	err = tx.QueryRow(ctx, "INSERT INTO nests(uuid,author,name,description) VALUES($1,'library@voltra.local','Game Library','Templates for guided game installation.') ON CONFLICT(uuid) DO UPDATE SET uuid=EXCLUDED.uuid RETURNING id", gameLibraryNestUUID).Scan(&nestID)
	if err != nil {
		return nil, err
	}
	err = tx.QueryRow(ctx, "SELECT id FROM eggs WHERE uuid=$1", eggUUID).Scan(&eggID)
	if errors.Is(err, pgx.ErrNoRows) {
		files := M{"server.properties": M{"parser": "properties", "find": M{"server-ip": "0.0.0.0", "server-port": "{{server.build.default.port}}", "max-players": "{{server.build.env.MAX_PLAYERS}}", "gamemode": "{{server.build.env.GAME_MODE}}", "difficulty": "{{server.build.env.DIFFICULTY}}"}}}
		images := M{}
		for _, runtime := range javaDefaultRuntimes() {
			images[str(runtime["name"])] = runtime["image"]
		}
		javaConfig := M{"enabled": true, "memory_mode": "command"}
		// Modern Forge and NeoForge require a loader argfile. Java 8 Forge uses
		// a separate managed egg below so its memory mode remains command.
		if loader == "forge" && !legacyForge || loader == "neoforge" {
			javaConfig["memory_mode"] = "argfile"
			javaConfig["args_file"] = "user_jvm_args.txt"
		}
		script := strings.Replace(minecraftInstallScript, "# VOLTRA_PYTHON", minecraftInstallPython, 1)
		err = tx.QueryRow(ctx, `INSERT INTO eggs(uuid,nest_id,author,name,description,features,docker_images,startup,config_files,config_startup,config_stop,script_install,script_entry,script_container,java_config) VALUES($1,$2,'library@voltra.local',$8,'Minecraft installed from verified upstream downloads.','["minecraft","eula","java_version"]',$3,$4,$5,$6,'stop',$7,'bash',$10,$9) RETURNING id`, eggUUID, nestID, images, "java -Xms128M -XX:MaxRAMPercentage=80.0 -Dterminal.jline=false -Dterminal.ansi=true -jar server.jar nogui", files, M{"done": "Done ("}, script, "Minecraft "+strings.ToUpper(loader[:1])+loader[1:], javaConfig, minecraftInstallerImage).Scan(&eggID)
		if err != nil {
			return nil, err
		}
		for _, v := range []M{
			{"name": "Minecraft version", "env": "MINECRAFT_VERSION", "default": "latest", "rules": "required|string|max:64", "visible": true},
			{"name": "Minecraft loader", "env": "MINECRAFT_LOADER", "default": loader, "rules": "required|in:vanilla,paper,fabric,forge,neoforge,quilt", "visible": true},
			{"name": "Loader version", "env": "MINECRAFT_LOADER_VERSION", "default": "", "rules": "nullable|string|max:128", "visible": true},
			{"name": "Verified install plan", "env": "MINECRAFT_INSTALL_PLAN", "default": "", "rules": "required|string|max:96000", "visible": false},
			{"name": "Server download", "env": "SERVER_DOWNLOAD_URL", "default": "", "rules": "nullable|string", "visible": false},
			{"name": "Server checksum", "env": "SERVER_SHA1", "default": "", "rules": "nullable|string|size:40", "visible": false},
			{"name": "Player limit", "env": "MAX_PLAYERS", "default": "20", "rules": "required|integer|min:1|max:200", "visible": true},
			{"name": "Game mode", "env": "GAME_MODE", "default": "survival", "rules": "required|in:survival,creative,adventure,spectator", "visible": true},
			{"name": "Difficulty", "env": "DIFFICULTY", "default": "normal", "rules": "required|in:peaceful,easy,normal,hard", "visible": true},
			{"name": "Minecraft EULA", "env": "EULA_ACCEPTED", "default": "false", "rules": "required|in:true", "visible": false},
		} {
			if _, err = tx.Exec(ctx, "INSERT INTO egg_variables(egg_id,name,env_variable,default_value,rules,user_viewable,user_editable) VALUES($1,$2,$3,$4,$5,$6,$7)", eggID, v["name"], v["env"], v["default"], v["rules"], v["visible"], v["env"] == "MAX_PLAYERS" || v["env"] == "GAME_MODE" || v["env"] == "DIFFICULTY"); err != nil {
				return nil, err
			}
		}
	} else if err != nil {
		return nil, err
	}
	// Upgrade only the exact managed default. Keep custom installer scripts,
	// images and every other administrator edit intact.
	managedScript := strings.ReplaceAll(strings.Replace(minecraftInstallScript, "# VOLTRA_PYTHON", minecraftInstallPython, 1), "\r\n", "\n")
	previousPython := strings.Replace(minecraftInstallPython, "    # Wings mounts /tmp as a small tmpfs. Pack archives plus the Java bootstrap\n    # must use the server disk budget, not exhaust that tmpfs during extraction.\n    with tempfile.TemporaryDirectory(prefix=\"voltra-minecraft-\", dir=work_directory or root) as temporary:", "    with tempfile.TemporaryDirectory(prefix=\"voltra-minecraft-\", dir=work_directory) as temporary:", 1)
	previousScript := strings.ReplaceAll(strings.Replace(minecraftInstallScript, "# VOLTRA_PYTHON", previousPython, 1), "\r\n", "\n")
	var storedScript string
	if err = tx.QueryRow(ctx, "SELECT script_install FROM eggs WHERE id=$1", eggID).Scan(&storedScript); err != nil {
		return nil, err
	}
	historicalScript := managedScript
	if minecraftKnownHistoricalInstaller(storedScript) {
		historicalScript = strings.ReplaceAll(storedScript, "\r\n", "\n")
	}
	if _, err = tx.Exec(ctx, "UPDATE eggs SET script_container=$2,script_install=$3,updated_at=now() WHERE id=$1 AND author='library@voltra.local' AND script_container IN ('ghcr.io/pterodactyl/installers:debian',$2) AND replace(script_install,chr(13)||chr(10),chr(10)) IN ($3,$4,$5) AND (script_container<>$2 OR script_install<>$3)", eggID, minecraftInstallerImage, managedScript, previousScript, historicalScript); err != nil {
		return nil, err
	}
	if err = tx.Commit(ctx); err != nil {
		return nil, err
	}
	return a.one(ctx, "SELECT * FROM eggs WHERE id=$1", eggID)
}

// These are the exact published pre-streaming managed installers, with and
// without the disk-backed scratch fix. Only line endings/final newlines are
// normalized; administrator modifications never match an approved identity.
func minecraftKnownHistoricalInstaller(script string) bool {
	canonical := strings.TrimRight(strings.ReplaceAll(script, "\r\n", "\n"), "\n")
	sum := sha256.Sum256([]byte(canonical))
	switch hex.EncodeToString(sum[:]) {
	case "1e41d423d1818426a110f970464b4baf0e75a54118b084c3a9a4d900140304d5",
		"efe82ae16ace2afc6e9858b50616feefa34ece3578e64399d0347c4502317d3b":
		return true
	default:
		return false
	}
}

func (a *App) gameLibraryInstallMinecraft(w http.ResponseWriter, r *http.Request) {
	user, err := a.requireAdmin(r)
	if err != nil {
		fail(w, err)
		return
	}
	input, err := decode(r)
	if err != nil {
		fail(w, err)
		return
	}
	name, ok := input["name"].(string)
	if !ok || strings.TrimSpace(name) == "" || len([]rune(name)) > 100 {
		fail(w, bad("Enter a server name of at most 100 characters."))
		return
	}
	if accepted, ok := input["accept_eula"].(bool); !ok || !accepted {
		fail(w, bad("Accept the Minecraft EULA before installing."))
		return
	}
	memory, ok := applicationInteger(input["memory"])
	if !ok || memory < 512 || memory > 1048576 {
		fail(w, bad("Choose between 512 MiB and 1 TiB of container memory."))
		return
	}
	players, ok := applicationInteger(input["max_players"])
	if !ok || players < 1 || players > 200 {
		fail(w, bad("Choose a player limit between 1 and 200."))
		return
	}
	mode, difficulty := str(input["game_mode"]), str(input["difficulty"])
	if !map[string]bool{"survival": true, "creative": true, "adventure": true, "spectator": true}[mode] {
		fail(w, bad("Select a supported game mode."))
		return
	}
	if !map[string]bool{"peaceful": true, "easy": true, "normal": true, "hard": true}[difficulty] {
		fail(w, bad("Select a supported difficulty."))
		return
	}
	nodeID := int64(0)
	if input["node_id"] != nil {
		var valid bool
		nodeID, valid = applicationInteger(input["node_id"])
		if !valid || nodeID < 0 {
			fail(w, bad("Select a valid node."))
			return
		}
	}
	requestID := str(input["request_id"])
	if !regexp.MustCompile(`^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$`).MatchString(requestID) {
		fail(w, bad("A valid installation request ID is required."))
		return
	}
	conn, err := a.DB.Acquire(r.Context())
	if err != nil {
		fail(w, err)
		return
	}
	defer steamUnlock(conn)
	if err = steamSessionLock(r.Context(), conn, fmt.Sprintf("voltra:minecraft-provision:%d:%s", num(user["id"]), requestID)); err != nil {
		fail(w, err)
		return
	}
	externalID := fmt.Sprintf("game-library:%d:%s", num(user["id"]), requestID)
	existing, err := a.one(r.Context(), "SELECT * FROM servers WHERE external_id=$1", externalID)
	if err == nil {
		writeJSON(w, 200, item("game_installation", M{"identifier": existing["uuid_short"], "name": existing["name"], "status": existing["status"], "ports": a.gameInstallPortResponse(r.Context(), existing, gameTemplate{ID: "minecraft"})}))
		return
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		fail(w, err)
		return
	}
	var plan minecraftPlan
	if input["modpack"] != nil {
		selection, valid := input["modpack"].(map[string]any)
		if !valid {
			fail(w, bad("modpack must contain provider, project_id and version_id."))
			return
		}
		plan, err = a.minecraftModpackPlan(r.Context(), selection)
	} else {
		plan, err = a.minecraftBuildPlan(r.Context(), str(input["version"]), str(input["loader"]), str(input["loader_version"]))
	}
	if err != nil {
		fail(w, err)
		return
	}
	egg, err := a.gameLibraryMinecraftLoaderEgg(r.Context(), plan.Loader, plan.Java <= 8)
	if err != nil {
		fail(w, err)
		return
	}
	javaConfig := M{"enabled": true, "runtime_id": "auto"}
	if input["java_config"] != nil {
		config, valid := input["java_config"].(map[string]any)
		if !valid {
			fail(w, bad("java_config must be an object."))
			return
		}
		for key, value := range config {
			javaConfig[key] = value
		}
	}
	if input["runtime_id"] != nil {
		runtime, valid := input["runtime_id"].(string)
		if !valid {
			fail(w, bad("Select a valid Java runtime."))
			return
		}
		javaConfig["runtime_id"] = runtime
	}
	if !boolean(javaConfig["enabled"]) {
		fail(w, bad("Minecraft requires an enabled Java runtime."))
		return
	}
	// Upstream requirements are trusted. The caller cannot lower them.
	javaConfig["required_major"] = int64(plan.Java)
	javaConfig, err = a.applyMinecraftRuntimeRules(r.Context(), plan.Provider, plan.ProjectID, plan.PackVersionID, plan.Loader, plan.Version, javaConfig, memory)
	if err != nil {
		fail(w, err)
		return
	}
	effective, err := a.javaResolve(r.Context(), egg, javaConfig, memory)
	if err != nil {
		fail(w, err)
		return
	}
	encoded, err := minecraftEncodePlan(plan)
	if err != nil {
		fail(w, err)
		return
	}
	env := M{"MINECRAFT_VERSION": plan.Version, "MINECRAFT_LOADER": plan.Loader, "MINECRAFT_LOADER_VERSION": plan.LoaderVersion, "MINECRAFT_INSTALL_PLAN": encoded, "MAX_PLAYERS": fmt.Sprint(players), "GAME_MODE": mode, "DIFFICULTY": difficulty, "EULA_ACCEPTED": "true"}
	for _, file := range plan.Files {
		if file.Path == "server.jar" && file.Algorithm == "sha1" {
			env["SERVER_DOWNLOAD_URL"], env["SERVER_SHA1"] = file.URL, file.Hash
			break
		}
	}
	candidates := []M{}
	if nodeID > 0 {
		node, e := a.node(r.Context(), nodeID)
		if e != nil {
			fail(w, e)
			return
		}
		candidates = append(candidates, node)
	} else {
		candidates, err = a.query(r.Context(), "SELECT * FROM nodes WHERE public AND NOT maintenance_mode ORDER BY id")
		if err != nil {
			fail(w, err)
			return
		}
	}
	var selected M
	var portPlan gamePortPlan
	var allocations []M
	for _, node := range candidates {
		if !boolean(node["public"]) || boolean(node["maintenance_mode"]) {
			continue
		}
		if err = steamSessionLock(r.Context(), conn, fmt.Sprintf("voltra:steam-node-provision:%d", num(node["id"]))); err != nil {
			fail(w, err)
			return
		}
		if err = a.gameNodeResources(r.Context(), node, 10240, memory); err != nil {
			continue
		}
		node, err = a.node(r.Context(), num(node["id"]))
		if err != nil {
			continue
		}
		probe, e := a.daemon(r.Context(), node, "GET", "/api/system?v=2", nil)
		if e != nil {
			err = e
			continue
		}
		probe.Body.Close()
		portPlan, _, err = a.planGamePorts(r.Context(), node, gameTemplate{ID: "minecraft"}, M{})
		if err != nil {
			continue
		}
		allocations, err = a.provisionGamePorts(r.Context(), node, portPlan)
		if err != nil {
			continue
		}
		selected = node
		break
	}
	if selected == nil {
		if err == nil {
			err = bad("No available node can provision this Minecraft server.")
		}
		fail(w, err)
		return
	}
	nodeID = num(selected["id"])
	server, err := a.createServer(r.Context(), M{"name": strings.TrimSpace(name), "description": "Minecraft " + plan.Loader + " " + plan.Version, "owner_id": user["id"], "egg_id": egg["id"], "external_id": externalID, "image": effective["image"], "startup": minecraftPlanStartup(plan), "java_config": javaConfig, "node_id": nodeID, "allocation_id": allocations[0]["id"], "memory": memory, "swap": 0, "disk": 10240, "io": 500, "cpu": 200, "backup_limit": 1, "start_on_completion": true, "environment": env, "_minecraft_pack_artwork": plan.PackArtwork})
	if err != nil {
		fail(w, err)
		return
	}
	portPlan = a.finishGamePortPlan(r.Context(), user, selected, server, gameTemplate{ID: "minecraft"}, portPlan)
	_ = a.audit(r.Context(), num(user["id"]), num(server["id"]), "server:game-library.install", M{"game": "minecraft", "version": plan.Version, "loader": plan.Loader, "provider": plan.Provider, "eula_accepted": true})
	writeJSON(w, 201, item("game_installation", M{"identifier": server["uuid_short"], "name": server["name"], "status": server["status"], "version": plan.Version, "loader": plan.Loader, "ports": portPlan}))
}
