package panel

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"voltra/internal/palworldloader"
)

const steamLaunchImage = "ghcr.io/ptero-eggs/steamcmd:debian"
const steamBootstrapScript = "#!/bin/sh\nset -eu\n# Wings creates the volume; the panel installs game files through the node connector.\nexit 0\n"

type steamGameSpec struct {
	ID, Name, EggUUID                                           string
	AppID, Memory, MinimumMemory, Players, MaximumPlayers, Disk int64
	Image, Description, AfterSetup, Startup, Ready              string
	Ports                                                       int
	ConsecutivePorts                                            bool
	FixedPlayers                                                bool
	PasswordMinimum, PasswordMaximum                            int
	Stop                                                        string
	UnavailableReason                                           string
	Prepare                                                     func(*App, context.Context, M, M) error
}

var steamGameSpecs = []steamGameSpec{
	{ID: "palworld-native", Name: "Palworld Linux", EggUUID: "6ed6972a-865a-473a-bc9e-22ff682bb155", AppID: 2394010, Memory: 16384, MinimumMemory: 8192, Players: 32, MaximumPlayers: 32, Disk: 32768, Image: steamLaunchImage, Description: "Native Linux Palworld with imported server controls and private administration console.", AfterSetup: "Join with the allocated game address. Use Console for administrative commands; the console port stays private.", Startup: "bash .voltra/palworld-start.sh", Ready: "VOLTRA_PALWORLD_CONSOLE_READY", Stop: "Shutdown 15", Ports: 1, PasswordMaximum: 30, Prepare: (*App).steamPalworldAfterInstall},
	{ID: "palworld-proton", Name: "Palworld Proton", EggUUID: "6ed6972a-865a-473a-bc9e-22ff682bb156", AppID: 2394010, Memory: 16384, MinimumMemory: 8192, Players: 32, MaximumPlayers: 32, Disk: 32768, Image: palworldloader.ProtonImage, Description: "Windows Palworld under Proton with maintained MIT UE4SS for Lua and Blueprint mods.", AfterSetup: "Join with the allocated game address. Existing native DLL mods or competing loaders require compatibility review.", Startup: "bash .voltra/palworld-start.sh", Ready: "VOLTRA_PALWORLD_CONSOLE_READY", Stop: "Shutdown 5", Ports: 1, PasswordMaximum: 30, Prepare: (*App).steamPalworldAfterInstall},
	{ID: "satisfactory", Name: "Satisfactory", EggUUID: "6ed6972a-865a-473a-bc9e-22ff682bb151", AppID: 1690800, Memory: 12288, MinimumMemory: 8192, Players: 4, MaximumPlayers: 2147483647, Disk: 20480, Image: steamLaunchImage, Description: "Build a factory with friends.", AfterSetup: "Open Satisfactory's Server Manager, add the server address, claim it and create or load a session.", Startup: "./FactoryServer.sh -Port={{SERVER_PORT}} -ReliablePort=8888 -unattended", Ready: "Engine Initialization", Ports: 2, Prepare: (*App).satisfactoryAfterInstall},
	{ID: "palworld", Name: "Palworld", EggUUID: "6ed6972a-865a-473a-bc9e-22ff682bb152", AppID: 2394010, Memory: 16384, MinimumMemory: 8192, Players: 16, MaximumPlayers: 32, Disk: 32768, Image: steamLaunchImage, Description: "Create a persistent world with simple gameplay settings.", AfterSetup: "Join using the server address and game port. Change settings and upload saves from Quick setup.", Startup: "./PalServer.sh -port={{SERVER_PORT}}", Ready: "Setting breakpad minidump AppID = 2394010", Ports: 1, PasswordMaximum: 128},
	{ID: "valheim", Name: "Valheim", EggUUID: "6ed6972a-865a-473a-bc9e-22ff682bb153", AppID: 896660, Memory: 4096, MinimumMemory: 2048, Players: 10, MaximumPlayers: 10, Disk: 8192, Image: "ghcr.io/ptero-eggs/games:valheim", Description: "Explore a persistent Viking world with friends.", AfterSetup: "Join by IP using the game port and your server password. The server starts private, with Steam networking. Stop it before replacing world files.", Startup: valheimStartup, Ready: "DungeonDB Start", Ports: 2, ConsecutivePorts: true, FixedPlayers: true, PasswordMinimum: 5, PasswordMaximum: 20, Prepare: (*App).valheimAfterInstall},
	{ID: "7days", Name: "7 Days to Die", EggUUID: "6ed6972a-865a-473a-bc9e-22ff682bb154", AppID: 294420, Memory: 8192, MinimumMemory: 8192, Players: 8, MaximumPlayers: 2147483647, Disk: 32768, Image: steamLaunchImage, Description: "Survive in a persistent zombie world.", AfterSetup: "Join by the server address and game port. The server starts unlisted. Manage world settings from Quick setup and back up saves before changing worlds.", Startup: sevenDaysStartup, Ready: "VOLTRA_7DAYS_CONSOLE_READY", Stop: "shutdown", Ports: 4, ConsecutivePorts: true, PasswordMaximum: 128, Prepare: (*App).sevenDaysAfterInstall},
}

func steamGameSpecFor(game string) (steamGameSpec, bool) {
	for _, spec := range steamGameSpecs {
		if spec.ID == game {
			return spec, true
		}
	}
	return steamGameSpec{}, false
}

// Only managed launch-only eggs participate in app-owned installation.
func steamGameID(egg M) string {
	for _, spec := range steamGameSpecs {
		if str(egg["uuid"]) == spec.EggUUID {
			return spec.ID
		}
	}
	return ""
}

func (a *App) registerSteamGames(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/client/game-library/steam", a.steamGameCatalog)
	mux.HandleFunc("GET /api/client/game-library/steam/{game}", a.steamGameOptions)
	mux.HandleFunc("POST /api/client/game-library/steam/{game}/install", a.steamGameInstall)
	mux.HandleFunc("POST /api/client/game-library/steam/{game}/ports", a.steamGamePorts)
}

func steamGameSummary(spec steamGameSpec) M {
	return M{"id": spec.ID, "name": spec.Name, "description": spec.Description, "after_setup": spec.AfterSetup, "ports": spec.Ports, "consecutive_ports": spec.ConsecutivePorts, "password": M{"enabled": spec.PasswordMaximum > 0, "required": spec.PasswordMinimum > 0, "min_length": spec.PasswordMinimum, "max_length": spec.PasswordMaximum}}
}

func (a *App) steamGameCatalog(w http.ResponseWriter, r *http.Request) {
	if _, err := a.user(r); err != nil {
		fail(w, err)
		return
	}
	games := []M{}
	for _, spec := range steamGameSpecs {
		games = append(games, steamGameSummary(spec))
	}
	writeJSON(w, 200, item("steam_game_catalog", M{"games": games}))
}

func steamGameHelp(game string) []M {
	if game == "palworld-proton" {
		return []M{{"label": "Palworld server settings", "url": "https://docs.palworldgame.com/settings-and-operation/configuration/"}, {"label": "Windows / Proton mods", "text": "Includes maintained UE4SS for Lua and Blueprint mods. Existing native DLL mods or competing loaders require compatibility review."}, {"label": "Administration console", "text": "The RCON port is private inside the game container. Admin credentials stay in private native files."}}
	}
	if steamPalworldVariant(game) {
		return []M{{"label": "Palworld server settings", "url": "https://docs.palworldgame.com/settings-and-operation/configuration/"}, {"label": "Administration console", "text": "The RCON port is private inside the game container. Admin credentials stay in private native files and are excluded from process arguments and environment."}}
	}
	if game == "7days" {
		return []M{{"label": "7 Days to Die dedicated server", "url": "https://7daystodie.wiki.gg/wiki/Server:_serverconfig.xml", "text": "Four consecutive game ports are allocated. The administration console is private inside the container. World data is stored under saves; stop the game before replacing it."}}
	}
	if game == "valheim" {
		return []M{{"label": "Valheim dedicated server guide", "url": "https://www.valheimgame.com/support/a-guide-to-dedicated-servers/", "text": "Two consecutive UDP ports are required. Steam networking is used; crossplay is not enabled. World files are stored in saves, separate from the installed game files."}}
	}
	if game == "satisfactory" {
		return []M{{"label": "Manage your factory in Satisfactory", "text": "In Satisfactory, open Server Manager, add this server's address and game port, then claim it and create or load a session. Set server and admin passwords there.", "url": "https://satisfactory.wiki.gg/wiki/Dedicated_servers"}, {"label": "Blueprint uploads", "text": "Create a blueprint in your session first. Its discovered session folder will appear here. Upload matching .sbp and .sbpcfg files while the server is stopped."}}
	}
	return []M{{"label": "Palworld server settings", "url": "https://docs.palworldgame.com/settings-and-operation/configuration/"}, {"label": "Join your server", "text": "Use the server address and game port in Palworld. RCON and the REST API are disabled by default."}}
}

func (a *App) steamNativeNode(ctx context.Context, node M, appIDs ...int64) error {
	if !a.steamNodeAvailable(ctx, num(node["id"]), appIDs...) {
		return APIError{409, "SteamNodeUnavailable", "Choose a connected node with Steam support. Upgrade and reconnect the node agent if needed."}
	}
	// Options are selected from raw database rows; daemon credentials must be
	// decrypted through the same helper as ordinary daemon requests.
	var err error
	node, err = a.node(ctx, num(node["id"]))
	if err != nil {
		return err
	}
	res, err := a.daemon(ctx, node, "GET", "/api/system?v=2", nil)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	var info M
	if json.NewDecoder(io.LimitReader(res.Body, 64<<10)).Decode(&info) != nil {
		return bad("The node returned invalid platform information.")
	}
	system := asMap(info["system"])
	if len(system) == 0 {
		system = info
	}
	platform := str(system["os_type"])
	if platform == "" && info["system"] == nil {
		platform = str(info["os"])
	}
	if platform != "linux" || str(system["architecture"]) != "amd64" {
		return bad("Easy setup requires a native Linux amd64 node.")
	}
	return nil
}

func (a *App) steamGameOptions(w http.ResponseWriter, r *http.Request) {
	u, err := a.user(r)
	if err != nil {
		fail(w, err)
		return
	}
	spec, ok := steamGameSpecFor(r.PathValue("game"))
	if !ok {
		fail(w, notFound())
		return
	}
	nodes := []M{}
	if boolean(u["root_admin"]) {
		candidates, e := a.query(r.Context(), "SELECT * FROM nodes WHERE public AND NOT maintenance_mode ORDER BY name,id")
		if e != nil {
			fail(w, e)
			return
		}
		for _, node := range candidates {
			if a.steamNativeNode(r.Context(), node, spec.AppID) == nil {
				reason := ""
				if steamPalworldVariant(spec.ID) && !a.steamPalworldNodeAvailable(num(node["id"]), spec.ID) {
					reason = "Upgrade and reconnect the node for this Palworld runtime variant."
				}
				if spec.UnavailableReason != "" {
					reason = spec.UnavailableReason
				}
				if e := a.gameNodeResources(r.Context(), node, spec.Disk, spec.MinimumMemory); e != nil {
					var apiErr APIError
					if !errors.As(e, &apiErr) {
						fail(w, e)
						return
					}
					reason = apiErr.Detail
				}
				used, e := a.one(r.Context(), "SELECT COALESCE(SUM(memory),0)::bigint memory FROM servers WHERE node_id=$1", node["id"])
				if e != nil {
					fail(w, e)
					return
				}
				budget := int64(131072)
				if num(node["memory_overallocate"]) != -1 {
					budget = num(node["memory"])*(100+num(node["memory_overallocate"]))/100 - num(used["memory"])
				}
				nodes = append(nodes, M{"id": node["id"], "name": node["name"], "automatic_ports": true, "setup_available": reason == "", "unavailable_reason": reason, "available_memory": budget})
			}
		}
	}
	minimumPlayers := int64(1)
	if spec.FixedPlayers {
		minimumPlayers = spec.Players
	}
	options := steamGameSummary(spec)
	for key, value := range (M{"id": spec.ID, "name": spec.Name, "can_install": boolean(u["root_admin"]), "nodes": nodes, "defaults": M{"memory": spec.Memory, "max_players": spec.Players}, "minimum_memory": spec.MinimumMemory, "maximum_memory": 131072, "minimum_players": minimumPlayers, "maximum_players": spec.MaximumPlayers, "presets": []M{{"value": "default", "label": "Standard"}}, "help": steamGameHelp(spec.ID)}) {
		options[key] = value
	}
	options["advanced_fields"] = steamCatalogFieldRows(spec.ID)
	options["supports_install_only"] = true
	if spec.UnavailableReason != "" {
		options["setup_unavailable_reason"] = spec.UnavailableReason
	}
	writeJSON(w, 200, item("steam_game_options", options))
}

type steamGameInput struct {
	Name, RequestID, Password string
	NodeID, Memory, Players   int64
	Catalog                   *steamCatalogConfiguration
	StartOnCompletion         bool `json:"-"`
}

var steamRequestID = regexp.MustCompile(`^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$`)

func steamGameProvisionBytes(game string, input steamGameInput) []byte {
	encoded, _ := json.Marshal(struct {
		Game        string
		Input       steamGameInput
		Credentials map[string]string
		InstallOnly bool `json:"install_only,omitempty"`
	}{game, input, func() map[string]string {
		if input.Catalog != nil {
			return input.Catalog.Secrets
		}
		return nil
	}(), !input.StartOnCompletion})
	return encoded
}

func steamParseGameInput(spec steamGameSpec, in M) (steamGameInput, error) {
	v := steamGameInput{Name: strings.TrimSpace(str(in["name"])), RequestID: str(in["request_id"]), StartOnCompletion: true}
	if raw, exists := in["start_on_completion"]; exists {
		value, ok := raw.(bool)
		if !ok {
			return v, bad("Start on completion must be a boolean.")
		}
		v.StartOnCompletion = value
	}
	if v.Name == "" || len([]rune(v.Name)) > 100 || !quickSingleLine(v.Name) {
		return v, bad("Enter a server name of at most 100 characters.")
	}
	if !steamRequestID.MatchString(v.RequestID) {
		return v, bad("A valid installation request ID is required.")
	}
	var ok bool
	if v.NodeID, ok = applicationInteger(in["node_id"]); !ok || v.NodeID < 1 {
		return v, bad("Select an available node.")
	}
	if v.Memory, ok = applicationInteger(in["memory"]); !ok || v.Memory < spec.MinimumMemory || v.Memory > 131072 {
		return v, bad(fmt.Sprintf("Choose memory from %g to 128 GB.", float64(spec.MinimumMemory)/1024))
	}
	if v.Players, ok = applicationInteger(in["max_players"]); !ok || v.Players < 1 || v.Players > spec.MaximumPlayers || spec.FixedPlayers && v.Players != spec.Players {
		return v, bad(fmt.Sprintf("Choose a player limit from 1 to %d.", spec.MaximumPlayers))
	}
	if in["server_password"] != nil {
		if v.Password, ok = in["server_password"].(string); !ok || len([]rune(v.Password)) > 128 || !quickSingleLine(v.Password) {
			return v, bad("Enter a server password of at most 128 characters without line breaks.")
		}
	}
	if spec.PasswordMaximum == 0 && v.Password != "" {
		return v, bad("Set Satisfactory passwords in the game's built-in Server Manager after claiming the server.")
	}
	if preset := str(in["preset"]); preset != "" && preset != "default" {
		return v, bad("Select the Standard preset.")
	}
	if spec.PasswordMinimum > 0 && (len([]rune(v.Password)) < spec.PasswordMinimum || len([]rune(v.Password)) > spec.PasswordMaximum) {
		return v, bad(fmt.Sprintf("Choose a password from %d to %d characters.", spec.PasswordMinimum, spec.PasswordMaximum))
	}
	if len(steamCatalogFields(spec.ID)) > 0 {
		var environment M
		if raw, present := in["environment"]; present {
			var valid bool
			environment, valid = raw.(map[string]any)
			if !valid {
				return v, bad("Environment controls must be an object.")
			}
		}
		configuration, err := steamCatalogParse(spec.ID, environment, v.Players)
		if steamPalworldVariant(spec.ID) && v.Password != "" {
			copy := M{}
			for key, value := range environment {
				copy[key] = value
			}
			environment = copy
			if existing, present := environment["SERVER_PASSWORD"]; present && str(existing) != "" && str(existing) != v.Password {
				return v, bad("Join password controls must agree.")
			}
			environment["SERVER_PASSWORD"] = v.Password
			configuration, err = steamCatalogParse(spec.ID, environment, v.Players)
		}
		if err != nil {
			return v, err
		}
		v.Catalog = &configuration
		v.Players = configuration.Players
	}
	return v, nil
}

// The dedicated connection owns session locks across createServer's own transaction.
// No allocation is marked reserved outside createServer's atomic assignment.
func steamSessionLock(ctx context.Context, conn *pgxpool.Conn, key string) error {
	_, err := conn.Exec(ctx, "SELECT pg_advisory_lock(hashtextextended($1,0))", key)
	return err
}
func steamUnlock(conn *pgxpool.Conn) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if _, err := conn.Exec(ctx, "SELECT pg_advisory_unlock_all()"); err != nil {
		_ = conn.Conn().Close(ctx)
	}
	conn.Release()
}

func (a *App) steamGameInstall(w http.ResponseWriter, r *http.Request) {
	u, err := a.requireAdmin(r)
	if err != nil {
		fail(w, err)
		return
	}
	spec, ok := steamGameSpecFor(r.PathValue("game"))
	if !ok {
		fail(w, notFound())
		return
	}
	in, err := decodeRaw(r)
	if spec.UnavailableReason != "" {
		fail(w, APIError{409, "GameSetupUnavailable", spec.UnavailableReason})
		return
	}
	if err != nil {
		fail(w, err)
		return
	}
	// Normalize ordinary setup fields while preserving opaque managed secrets.
	secrets := M{}
	if environment, ok := in["environment"].(map[string]any); ok {
		for _, field := range steamCatalogFields(spec.ID) {
			if field.Secret {
				if value, present := environment[field.Key]; present {
					secrets[field.Key] = value
				}
			}
		}
	}
	in = normalizeInput(in, "").(M)
	if environment, ok := in["environment"].(map[string]any); ok {
		for key, value := range secrets {
			environment[key] = value
		}
	}
	v, err := steamParseGameInput(spec, in)
	if err != nil {
		fail(w, err)
		return
	}
	ctx := r.Context()
	conn, err := a.DB.Acquire(ctx)
	if err != nil {
		fail(w, err)
		return
	}
	defer steamUnlock(conn)
	if err = steamSessionLock(ctx, conn, fmt.Sprintf("voltra:steam-provision:%d:%s", num(u["id"]), v.RequestID)); err != nil {
		fail(w, err)
		return
	}
	encoded := steamGameProvisionBytes(spec.ID, v)
	sum := sha256.Sum256(encoded)
	fingerprint := hex.EncodeToString(sum[:])
	settings := M{"name": v.Name, "max_players": v.Players}
	if steamPalworldVariant(spec.ID) {
		settings["managed_variant"] = spec.ID
	}
	if v.Catalog != nil {
		settings["environment"] = v.Catalog.Values
		for key, secret := range v.Catalog.Secrets {
			if secret != "" {
				sealed, e := a.seal(secret)
				if e != nil {
					fail(w, e)
					return
				}
				settings[steamCatalogSecretColumn(key)] = sealed
			}
		}
	}
	if v.Password != "" {
		sealed, e := a.seal(v.Password)
		if e != nil {
			fail(w, e)
			return
		}
		settings["password_encrypted"] = sealed
	}
	_, err = conn.Exec(ctx, `INSERT INTO steam_game_provisions(actor_id,request_id,game,input_hash,settings,stage) VALUES($1,$2,$3,$4,$5,'reserved') ON CONFLICT(actor_id,request_id) DO NOTHING`, u["id"], v.RequestID, spec.ID, fingerprint, settings)
	if err != nil {
		fail(w, err)
		return
	}
	var hash, game, stage string
	var serverID *int64
	err = conn.QueryRow(ctx, "SELECT input_hash,game,server_id,stage FROM steam_game_provisions WHERE actor_id=$1 AND request_id=$2", u["id"], v.RequestID).Scan(&hash, &game, &serverID, &stage)
	if err != nil {
		fail(w, err)
		return
	}
	if hash != fingerprint || game != spec.ID {
		fail(w, APIError{409, "InstallationRequestConflict", "This request ID was already used for different installation settings."})
		return
	}
	externalID := fmt.Sprintf("steam-library:%d:%s", num(u["id"]), v.RequestID)
	var server M
	if serverID != nil {
		server, err = a.one(ctx, "SELECT * FROM servers WHERE id=$1", *serverID)
	} else {
		server, err = a.one(ctx, "SELECT * FROM servers WHERE external_id=$1", externalID)
	}
	var portPlan gamePortPlan
	created := false
	if errors.Is(err, pgx.ErrNoRows) {
		if stage != "reserved" {
			fail(w, APIError{409, "InstallationServerRemoved", "The server for this request was removed. Start a new installation."})
			return
		}
		if err = steamSessionLock(ctx, conn, fmt.Sprintf("voltra:steam-node-provision:%d", v.NodeID)); err != nil {
			fail(w, err)
			return
		}
		node, e := a.node(ctx, v.NodeID)
		if e != nil {
			fail(w, bad("Select an available node."))
			return
		}
		if !boolean(node["public"]) || boolean(node["maintenance_mode"]) {
			fail(w, bad("This node is unavailable for Easy setup."))
			return
		}
		if err = a.steamNativeNode(ctx, node, spec.AppID); err != nil {
			fail(w, err)
			return
		}
		if e = a.gameNodeResources(ctx, node, spec.Disk, v.Memory); e != nil {
			fail(w, e)
			return
		}
		portEnvironment := M{}
		if v.Catalog != nil {
			portEnvironment = v.Catalog.Values
		}
		portPlan, _, e = a.planGamePorts(ctx, node, steamPortTemplate(spec), portEnvironment)
		if e != nil {
			fail(w, e)
			return
		}
		allocations, e := a.provisionGamePorts(ctx, node, portPlan)
		if steamPalworldVariant(spec.ID) && !a.steamPalworldNodeAvailable(v.NodeID, spec.ID) {
			fail(w, APIError{409, "SteamNodeUpgradeRequired", "Upgrade and reconnect the node for this Palworld runtime variant."})
			return
		}
		if e != nil {
			fail(w, e)
			return
		}
		if v.Catalog != nil {
			if v.Catalog.Validate && !a.steamCatalogOptionsAvailable(v.NodeID) || v.Catalog.Secrets["SRCDS_BETAPASS"] != "" && !a.steamCatalogPrivateBranchAvailable(v.NodeID) {
				fail(w, APIError{409, "SteamNodeUpgradeRequired", "Upgrade and reconnect the node to use validation or private branch credentials."})
				return
			}
			if spec.ID == "satisfactory" {
				v.Catalog.Values["RELIABLE_PORT"] = fmt.Sprint(num(allocations[1]["port"]))
			}
		}
		egg, e := a.steamGameEgg(ctx, spec)
		if e != nil {
			fail(w, e)
			return
		}
		additional := []any{}
		for _, alloc := range allocations[1:] {
			additional = append(additional, alloc["id"])
		}
		startup := steamGameStartup(spec, allocations)
		if spec.ID == "satisfactory" {
			startup, err = steamCatalogPlayersStartup(startup, v.Players)
			if err != nil {
				fail(w, err)
				return
			}
		}
		environment := M{"AUTO_UPDATE": "0", "VALIDATE": "0"}
		if v.Catalog != nil {
			for key, value := range v.Catalog.Values {
				environment[key] = value
			}
			environment["AUTO_UPDATE"] = "0"
			environment["VALIDATE"] = "0"
		}
		server, err = a.createServer(ctx, M{"name": v.Name, "description": spec.Name + " managed Steam server", "owner_id": u["id"], "egg_id": egg["id"], "external_id": externalID, "image": spec.Image, "startup": startup, "node_id": v.NodeID, "allocation_id": allocations[0]["id"], "allocation_additional": additional, "allocation_limit": len(additional), "memory": v.Memory, "swap": 0, "disk": spec.Disk, "io": 500, "cpu": 0, "backup_limit": 1, "start_on_completion": false, "environment": environment})
		if err != nil {
			fail(w, err)
			return
		}
		portPlan = a.finishGamePortPlan(ctx, u, node, server, steamPortTemplate(spec), portPlan)
		created = true
	} else if err != nil {
		fail(w, err)
		return
	}
	if stage == "reserved" {
		_, err = conn.Exec(ctx, "UPDATE steam_game_provisions SET server_id=$3,stage='created',updated_at=now() WHERE actor_id=$1 AND request_id=$2", u["id"], v.RequestID, server["id"])
		if err != nil {
			fail(w, err)
			return
		}
		stage = "created"
	}
	if stage == "created" {
		branch := "public"
		if v.Catalog != nil {
			branch = v.Catalog.Branch
		}
		if err = a.configureSteamServer(ctx, num(server["id"]), spec.ID, spec.AppID, branch); err != nil {
			fail(w, err)
			return
		}
		if v.Catalog != nil {
			if err = a.steamCatalogProvision(ctx, server, *v.Catalog, settings); err != nil {
				fail(w, err)
				return
			}
		}
		// Recover the crash window between queueSteamJob's durable commit and
		// recording this stage, including a job that has already finished.
		_, jobErr := a.one(ctx, "SELECT id FROM steam_jobs WHERE server_id=$1 AND operation='install' ORDER BY created_at LIMIT 1", server["id"])
		if errors.Is(jobErr, pgx.ErrNoRows) {
			if _, err = a.queueSteamJob(ctx, server, "install", v.StartOnCompletion, true); err != nil {
				fail(w, err)
				return
			}
		} else if jobErr != nil {
			fail(w, jobErr)
			return
		}
		if _, err = conn.Exec(ctx, "UPDATE steam_game_provisions SET stage='queued',updated_at=now() WHERE actor_id=$1 AND request_id=$2", u["id"], v.RequestID); err != nil {
			fail(w, err)
			return
		}
		_ = a.audit(ctx, num(u["id"]), num(server["id"]), "server:game-library.install", M{"game": spec.ID, "app_id": spec.AppID})
	}
	status := 200
	if created {
		status = 201
	}
	writeJSON(w, status, item("game_installation", M{"identifier": server["uuid_short"], "name": server["name"], "status": server["status"], "ports": a.gameInstallPortResponse(ctx, server, steamPortTemplate(spec))}))
}

func steamGameStartup(spec steamGameSpec, allocations []M) string {
	if spec.ID == "satisfactory" {
		return fmt.Sprintf("./FactoryServer.sh -Port={{SERVER_PORT}} -ReliablePort=%d -ExternalReliablePort=%d -unattended", num(allocations[1]["port"]), num(allocations[1]["port"]))
	}
	return spec.Startup
}

func (a *App) steamGameAllocations(ctx context.Context, node M, spec steamGameSpec, memory int64) ([]M, error) {
	if err := a.gameNodeResources(ctx, node, spec.Disk, memory); err != nil {
		return nil, err
	}
	ports, err := a.query(ctx, "SELECT id,ip,port FROM allocations WHERE node_id=$1 AND server_id IS NULL ORDER BY id", node["id"])
	if err != nil {
		return nil, err
	}
	return steamChooseAllocations(ports, spec.Ports, spec.ConsecutivePorts)
}

func steamChooseAllocations(ports []M, count int, consecutive bool) ([]M, error) {
	if count < 1 {
		return nil, bad("The game port definition is invalid.")
	}
	byIP := map[string]map[int64]M{}
	for _, port := range ports {
		ip := str(port["ip"])
		if byIP[ip] == nil {
			byIP[ip] = map[int64]M{}
		}
		byIP[ip][num(port["port"])] = port
	}
	for _, primary := range ports {
		out := []M{primary}
		if consecutive {
			for offset := 1; offset < count; offset++ {
				next, ok := byIP[str(primary["ip"])][num(primary["port"])+int64(offset)]
				if !ok {
					break
				}
				out = append(out, next)
			}
		} else {
			for _, aux := range ports {
				if len(out) == count {
					break
				}
				if num(aux["id"]) != num(primary["id"]) && str(aux["ip"]) == str(primary["ip"]) && num(aux["port"]) != num(primary["port"]) {
					out = append(out, aux)
				}
			}
		}
		if len(out) == count {
			return out, nil
		}
	}
	qualifier := ""
	if consecutive {
		qualifier = " consecutive"
	}
	return nil, bad(fmt.Sprintf("This game needs %d free%s ports on the same node IP. Add allocations, then retry.", count, qualifier))
}

func (a *App) steamGameEgg(ctx context.Context, spec steamGameSpec) (M, error) {
	tx, err := a.DB.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtext('voltra:game-library:steam'))"); err != nil {
		return nil, err
	}
	var nestID, eggID int64
	err = tx.QueryRow(ctx, `INSERT INTO nests(uuid,author,name,description) VALUES($1,'library@voltra.local','Game Library','Templates for guided game installation.') ON CONFLICT(uuid) DO UPDATE SET uuid=EXCLUDED.uuid RETURNING id`, gameLibraryNestUUID).Scan(&nestID)
	if err != nil {
		return nil, err
	}
	err = tx.QueryRow(ctx, "SELECT id FROM eggs WHERE uuid=$1", spec.EggUUID).Scan(&eggID)
	imageLabel := "Native Linux"
	if spec.ID == "palworld-proton" {
		imageLabel = "Windows / Proton"
	}
	if errors.Is(err, pgx.ErrNoRows) {
		startup, done := spec.Startup, spec.Ready
		stop := spec.Stop
		if stop == "" {
			stop = "^C"
		}
		err = tx.QueryRow(ctx, `INSERT INTO eggs(uuid,nest_id,author,name,description,features,docker_images,startup,config_files,config_startup,config_stop,script_install,script_entry,script_container) VALUES($1,$2,'library@voltra.local',$3,'App-owned Steam installation. Launch only; use the Steam maintenance controls.',$4,$5,$6,'{}',$7,$9,$8,'sh','ghcr.io/ptero-eggs/installers:debian') RETURNING id`, spec.EggUUID, nestID, spec.Name+" (managed Steam)", []string{"steam", "quick_setup"}, M{imageLabel: spec.Image}, startup, M{"done": done}, steamBootstrapScript, stop).Scan(&eggID)
		if err != nil {
			return nil, err
		}
		for _, variable := range []string{"AUTO_UPDATE", "VALIDATE"} {
			_, err = tx.Exec(ctx, `INSERT INTO egg_variables(egg_id,name,description,env_variable,default_value,user_viewable,user_editable,rules) VALUES($1,$2,'Steam installation and updates are owned by the panel.',$2,'0',false,false,'required|in:0')`, eggID, variable)
			if err != nil {
				return nil, err
			}
		}
	} else if err != nil {
		return nil, err
	}
	if spec.ID == "palworld-proton" {
		// Correct only the exact previous app-owned metadata, retaining any
		// operator-supplied image choices and every native Linux label.
		if _, err = tx.Exec(ctx, "UPDATE eggs SET docker_images=$2 WHERE id=$1 AND docker_images=$3", eggID, M{imageLabel: spec.Image}, M{"Native Linux": spec.Image}); err != nil {
			return nil, err
		}
	}
	for _, field := range steamCatalogFields(spec.ID) {
		var variableID int64
		err = tx.QueryRow(ctx, "SELECT id FROM egg_variables WHERE egg_id=$1 AND env_variable=$2 ORDER BY id LIMIT 1", eggID, field.Key).Scan(&variableID)
		if errors.Is(err, pgx.ErrNoRows) {
			_, err = tx.Exec(ctx, `INSERT INTO egg_variables(egg_id,name,description,env_variable,default_value,user_viewable,user_editable,rules,field_type) VALUES($1,$2,'Managed native control; updates require a stopped server.',$3,$4,true,$5,$6,'text')`, eggID, field.Label, field.Key, field.Default, field.Type != "fixed", steamCatalogVariableRules(field))
		} else if err == nil && (field.Key == "AUTO_UPDATE" || field.Key == "VALIDATE") {
			_, err = tx.Exec(ctx, "UPDATE egg_variables SET user_viewable=true,user_editable=true,rules=$2,default_value=$3 WHERE id=$1", variableID, steamCatalogVariableRules(field), field.Default)
		}
		if err != nil {
			return nil, err
		}
	}
	if err != nil {
		return nil, err
	}
	if err = tx.Commit(ctx); err != nil {
		return nil, err
	}
	return a.one(ctx, "SELECT * FROM eggs WHERE id=$1", eggID)
}

// Called after app-owned installation and before the first start. Existing native
// configuration is never rewritten by a later install/update/verify.
func (a *App) steamGameAfterInstall(ctx context.Context, server M) error {
	egg, err := a.one(ctx, "SELECT * FROM eggs WHERE id=$1", server["egg_id"])
	if err != nil {
		return err
	}
	game := steamGameID(egg)
	if game == "" {
		return nil
	}
	provision, err := a.one(ctx, "SELECT settings FROM steam_game_provisions WHERE server_id=$1 ORDER BY created_at LIMIT 1", server["id"])
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	conn, err := a.DB.Acquire(ctx)
	if err != nil {
		return err
	}
	defer steamUnlock(conn)
	if err = steamSessionLock(ctx, conn, "voltra:server-mutation:"+str(server["uuid"])); err != nil {
		return err
	}
	if err = a.quickSetupStopped(ctx, server); err != nil {
		return err
	}
	settings := asMap(provision["settings"])
	if spec, ok := steamGameSpecFor(game); ok && spec.Prepare != nil {
		return spec.Prepare(a, ctx, server, settings)
	}
	if game == "palworld" {
		_, exists, e := a.quickSetupRead(ctx, server, palworldSettingsPath)
		if e != nil {
			return e
		}
		if exists {
			return nil
		}
		defaults, exists, e := a.quickSetupRead(ctx, server, "/DefaultPalWorldSettings.ini")
		if e != nil {
			return e
		}
		if !exists {
			return bad("Steam did not install DefaultPalWorldSettings.ini. Verify the installation before starting.")
		}
		patch := map[string]string{"ServerName": quickUnrealQuote(str(settings["name"])), "ServerPlayerMaxNum": fmt.Sprint(num(settings["max_players"])), "RCONEnabled": "False", "RESTAPIEnabled": "False"}
		if encrypted := str(settings["password_encrypted"]); encrypted != "" {
			password, e := a.unseal(encrypted)
			if e != nil {
				return e
			}
			patch["ServerPassword"] = quickUnrealQuote(password)
		}
		content, e := quickPatchPalworld(defaults, patch)
		if e != nil {
			return e
		}
		if e = a.quickSetupMkdirAll(ctx, server, "/Pal/Saved/Config/LinuxServer"); e != nil {
			return e
		}
		return a.quickSetupWrite(ctx, server, palworldSettingsPath, content)
	}
	file := "/FactoryGame/Saved/Config/LinuxServer/Game.ini"
	_, exists, err := a.quickSetupRead(ctx, server, file)
	if err != nil || exists {
		return err
	}
	if err = a.quickSetupMkdirAll(ctx, server, "/FactoryGame/Saved/Config/LinuxServer"); err != nil {
		return err
	}
	return a.quickSetupWrite(ctx, server, file, []byte(fmt.Sprintf("[/Script/Engine.GameSession]\nMaxPlayers=%d\n", num(settings["max_players"]))))
}

func (a *App) gameNodeResources(ctx context.Context, node M, disk, memory int64) error {
	used, err := a.one(ctx, "SELECT COALESCE(SUM(memory),0)::bigint memory,COALESCE(SUM(disk),0)::bigint disk FROM servers WHERE node_id=$1", node["id"])
	if err != nil {
		return err
	}
	if over := num(node["memory_overallocate"]); over != -1 && num(used["memory"])+memory > num(node["memory"])*(100+over)/100 {
		return bad("The node has insufficient available memory.")
	}
	if over := num(node["disk_overallocate"]); over != -1 && num(used["disk"])+disk > num(node["disk"])*(100+over)/100 {
		return bad("The node has insufficient available disk.")
	}
	return nil
}
