package panel

import (
	"context"
	"errors"
	"fmt"
	"path"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"voltra/internal/steamapi"
)

const steamCatalogSecretPlaceholder = "[configured]"

var errSteamCatalogRestore = errors.New("Native configuration restoration failed; verify and repair before starting")

var steamCatalogReliableFlag = regexp.MustCompile(`(^|[ \t])-(External)?ReliablePort=[^ \t]*`)

const steamCatalogPlayersPrefix = "-ini:Game:[/Script/Engine.GameSession]:MaxPlayers"

var steamCatalogPlayersFlag = regexp.MustCompile(`(?i)(^|[ \t])-ini:Game:\[/Script/Engine\.GameSession\]:MaxPlayers[^ \t]*`)

func steamCatalogPlayersStartup(startup string, players int64) (string, error) {
	if players < 1 || players > 2147483647 || !quickSingleLine(startup) {
		return "", bad("Choose a valid player limit.")
	}
	matches := steamCatalogPlayersFlag.FindAllString(startup, -1)
	if len(matches) > 1 || strings.Count(strings.ToLower(startup), strings.ToLower(steamCatalogPlayersPrefix)) != len(matches) {
		return "", bad("Restore one numeric MaxPlayers startup argument before changing its limit.")
	}
	argument := steamCatalogPlayersPrefix + "=" + strconv.FormatInt(players, 10)
	if len(matches) == 0 {
		return strings.TrimRight(startup, " \t") + " " + argument, nil
	}
	flag := strings.TrimLeft(matches[0], " \t")
	value, ok := strings.CutPrefix(flag[len(steamCatalogPlayersPrefix):], "=")
	n, err := strconv.ParseUint(value, 10, 31)
	if !ok || err != nil || n == 0 {
		return "", bad("Restore one numeric MaxPlayers startup argument before changing its limit.")
	}
	return steamCatalogPlayersFlag.ReplaceAllStringFunc(startup, func(flag string) string {
		return flag[:len(flag)-len(strings.TrimLeft(flag, " \t"))] + argument
	}), nil
}

func steamCatalogReliableStartup(startup string, port int64) (string, error) {
	if port < 1024 || port > 65535 {
		return "", bad("Choose an allocated reliable port.")
	}
	counts := map[string]int{}
	invalid := false
	updated := steamCatalogReliableFlag.ReplaceAllStringFunc(startup, func(flag string) string {
		if _, err := strconv.ParseUint(flag[strings.IndexByte(flag, '=')+1:], 10, 16); err != nil {
			invalid = true
		}
		name := "ReliablePort"
		if strings.Contains(flag, "ExternalReliablePort=") {
			name = "ExternalReliablePort"
		}
		counts[name]++
		return flag[:strings.IndexByte(flag, '=')+1] + strconv.FormatInt(port, 10)
	})
	if invalid || counts["ReliablePort"] != 1 || counts["ExternalReliablePort"] > 1 {
		return "", bad("Restore one numeric ReliablePort startup argument before changing its allocated port.")
	}
	return updated, nil
}

func steamCatalogHasField(game, key string) bool {
	if steamPalworldVariant(game) && key == "SRCDS_BETAID" {
		return true
	}
	for _, field := range steamCatalogFields(game) {
		if field.Key == key {
			return true
		}
	}
	return false
}
func steamCatalogSecretColumn(key string) string {
	switch key {
	case "PASSWORD":
		return "console_password_encrypted"
	case "ADMIN_PASSWORD":
		return "console_password_encrypted"
	case "SERVER_PASSWORD":
		return "join_password_encrypted"
	case "SRCDS_BETAPASS":
		return "beta_password_encrypted"
	}
	return ""
}

func (a *App) steamCatalogLoad(ctx context.Context, server M) (steamCatalogConfiguration, M, error) {
	state, err := a.one(ctx, "SELECT * FROM steam_servers WHERE server_id=$1", server["id"])
	if err != nil {
		return steamCatalogConfiguration{}, nil, err
	}
	game := str(state["game"])
	if len(steamCatalogFields(game)) == 0 {
		return steamCatalogConfiguration{}, state, nil
	}
	variables, err := a.query(ctx, `SELECT ev.env_variable,COALESCE(sv.variable_value,ev.default_value) AS value,sv.id IS NOT NULL AS explicit FROM egg_variables ev LEFT JOIN server_variables sv ON sv.variable_id=ev.id AND sv.server_id=$1 WHERE ev.egg_id=$2 ORDER BY ev.id`, server["id"], server["egg_id"])
	if err != nil {
		return steamCatalogConfiguration{}, state, err
	}
	values := M{}
	explicitPlayers := false
	for _, variable := range variables {
		key := str(variable["env_variable"])
		if steamCatalogHasField(game, key) {
			values[key] = variable["value"]
		}
		if key == "MAX_PLAYERS" {
			explicitPlayers = boolean(variable["explicit"])
		}
	}
	// Older managed setups stored their player limit before this egg variable
	// existed. An explicit variable (including an invalid blank) always wins.
	if game == "satisfactory" && !explicitPlayers {
		provision, provisionErr := a.one(ctx, "SELECT settings FROM steam_game_provisions WHERE server_id=$1 ORDER BY created_at LIMIT 1", server["id"])
		if provisionErr != nil && !errors.Is(provisionErr, pgx.ErrNoRows) {
			return steamCatalogConfiguration{}, state, provisionErr
		}
		if legacy, present := asMap(provision["settings"])["max_players"]; present {
			players, valid := applicationInteger(legacy)
			if !valid || players < 1 || players > 2147483647 {
				return steamCatalogConfiguration{}, state, bad("Choose a valid player limit.")
			}
			values["MAX_PLAYERS"] = players
		}
	}
	values["SRCDS_BETAID"] = state["branch"]
	if str(state["branch"]) == "public" {
		values["SRCDS_BETAID"] = ""
	}
	if str(state["mode"]) == "off" {
		values["AUTO_UPDATE"] = "0"
	} else {
		values["AUTO_UPDATE"] = "1"
	}
	if game == "satisfactory" {
		values["VALIDATE"] = "0"
		if boolean(state["validate_on_start"]) {
			values["VALIDATE"] = "1"
		}
	}
	// Stored/default variable values never override the encrypted credential store.
	for _, field := range steamCatalogFields(game) {
		if !field.Secret {
			continue
		}
		key := field.Key
		values[key] = ""
		if cipher := str(state[steamCatalogSecretColumn(key)]); cipher != "" {
			secret, e := a.unseal(cipher)
			if e != nil {
				return steamCatalogConfiguration{}, state, e
			}
			values[key] = secret
		}
	}
	configuration, err := steamCatalogParse(game, values, 0)
	return configuration, state, err
}

func (a *App) steamCatalogMaskVariables(ctx context.Context, server M, variables []M) error {
	state, err := a.one(ctx, "SELECT game,branch,mode,validate_on_start,beta_password_encrypted,console_password_encrypted,join_password_encrypted FROM steam_servers WHERE server_id=$1", server["id"])
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if len(steamCatalogFields(str(state["game"]))) == 0 {
		return nil
	}
	for _, variable := range variables {
		key := str(variable["env_variable"])
		switch key {
		case "AUTO_UPDATE":
			variable["server_value"] = "1"
			if str(state["mode"]) == "off" {
				variable["server_value"] = "0"
			}
		case "VALIDATE":
			variable["server_value"] = "0"
			if boolean(state["validate_on_start"]) {
				variable["server_value"] = "1"
			}
		case "SRCDS_BETAID":
			variable["server_value"] = state["branch"]
			if str(state["branch"]) == "public" {
				variable["server_value"] = ""
			}
		}
		if column := steamCatalogSecretColumn(key); column != "" {
			variable["default_value"] = ""
			variable["server_value"] = ""
			variable["secret"] = true
			variable["configured"] = str(state[column]) != ""
			if str(state[column]) != "" {
				variable["server_value"] = steamCatalogSecretPlaceholder
			}
		}
	}
	return nil
}

func (a *App) steamCatalogRuntimeEnvironment(ctx context.Context, server, environment M) error {
	state, err := a.one(ctx, "SELECT game FROM steam_servers WHERE server_id=$1", server["id"])
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if len(steamCatalogFields(str(state["game"]))) == 0 {
		return nil
	}
	environment["AUTO_UPDATE"] = "0"
	environment["VALIDATE"] = "0"
	delete(environment, "PASSWORD")
	delete(environment, "SRCDS_BETAPASS")
	if steamPalworldVariant(str(state["game"])) {
		delete(environment, "ADMIN_PASSWORD")
		delete(environment, "SERVER_PASSWORD")
	}
	return nil
}

func (a *App) steamCatalogOptionsAvailable(nodeID int64) bool {
	h := a.connectors()
	h.mu.Lock()
	defer h.mu.Unlock()
	connection := h.controls[nodeID]
	return connection != nil && connection.capabilities[steamapi.OptionsCapability]
}

func (a *App) steamCatalogPrivateBranchAvailable(nodeID int64) bool {
	h := a.connectors()
	h.mu.Lock()
	defer h.mu.Unlock()
	connection := h.controls[nodeID]
	return connection != nil && connection.capabilities[steamapi.PrivateBranchCapability]
}

func (a *App) steamCatalogValidateAllocation(ctx context.Context, server M, configuration steamCatalogConfiguration) error {
	game := str(configuration.Values["SRCDS_APPID"])
	allocations, err := a.query(ctx, "SELECT port FROM allocations WHERE server_id=$1", server["id"])
	if err != nil {
		return err
	}
	if game == "294420" {
		for _, allocation := range allocations {
			if num(allocation["port"]) == num(configuration.Values["TELNET_PORT"]) {
				return bad("The private console port must differ from the published game allocations.")
			}
		}
	}
	if game == "2394010" {
		for _, allocation := range allocations {
			if num(allocation["port"]) == num(configuration.Values["RCON_PORT"]) {
				return bad("The private console port must differ from published game allocations.")
			}
		}
	}
	if game == "1690800" && num(configuration.Values["RELIABLE_PORT"]) != 0 {
		primary, err := a.one(ctx, "SELECT port FROM allocations WHERE id=$1", server["allocation_id"])
		if err != nil {
			return err
		}
		found := false
		for _, allocation := range allocations {
			if num(allocation["port"]) == num(configuration.Values["RELIABLE_PORT"]) && num(allocation["port"]) != num(primary["port"]) {
				found = true
			}
		}
		if !found {
			return bad("Choose a distinct allocated reliable port on this server.")
		}
	}
	return nil
}

// All caller paths hold the normal server mutation lock and confirm stopped
// state. Backups stay in memory and are used only if a multi-file write fails.
func (a *App) steamCatalogApplyConfiguration(ctx context.Context, server M, configuration steamCatalogConfiguration, keys []string, undo ...*func() error) error {
	return a.steamCatalogApplyConfigurationExtra(ctx, server, configuration, keys, nil, undo...)
}

func (a *App) steamCatalogApplyConfigurationExtra(ctx context.Context, server M, configuration steamCatalogConfiguration, keys []string, extra map[string]string, undo ...*func() error) error {
	selected := map[string]bool{}
	for _, key := range keys {
		selected[key] = true
	}
	all := len(keys) == 0 && extra == nil
	wanted := map[string][]byte{}
	if str(configuration.Values["SRCDS_APPID"]) == "2394010" {
		files, err := a.steamPalworldConfigurationFiles(ctx, server, configuration, selected, all, extra)
		if err != nil {
			return err
		}
		for file, content := range files {
			wanted[file] = content
		}
	}
	read := func(file string) ([]byte, error) {
		content, _, err := a.quickSetupRead(ctx, server, file)
		return content, err
	}
	if str(configuration.Values["SRCDS_APPID"]) == "1690800" {
		gameChanges, engineChanges := steamCatalogSatisfactoryINI(configuration)
		mapping := map[string]string{"MAX_PLAYERS": "MaxPlayers", "NUM_AUTOSAVES": "mNumRotatingAutosaves", "INIT_CONNECT_TIMEOUT": "InitialConnectTimeout", "CONNECT_TIMEOUT": "ConnectionTimeout"}
		for file, changes := range map[string]map[string]map[string]string{"/FactoryGame/Saved/Config/LinuxServer/Game.ini": gameChanges, "/FactoryGame/Saved/Config/LinuxServer/Engine.ini": engineChanges} {
			filtered := map[string]map[string]string{}
			for section, values := range changes {
				for key, value := range values {
					include := all
					for environment, mapped := range mapping {
						if mapped == key && selected[environment] {
							include = true
						}
					}
					if include {
						if filtered[section] == nil {
							filtered[section] = map[string]string{}
						}
						filtered[section][key] = value
					}
				}
			}
			if len(filtered) == 0 {
				continue
			}
			content, err := read(file)
			if err != nil {
				return err
			}
			patched, err := steamCatalogPatchINI(content, filtered)
			if err != nil {
				return err
			}
			wanted[file] = patched
		}
	} else if str(configuration.Values["SRCDS_APPID"]) == "294420" {
		patch := map[string]string{}
		mapping := map[string]string{"MAX_PLAYERS": "ServerMaxPlayerCount", "GAME_DIFFICULTY": "GameDifficulty", "SERVER_DISABLED_NETWORK_PROTOCOLS": "ServerDisabledNetworkProtocols", "TELNET_PORT": "TelnetPort"}
		for key, property := range mapping {
			if all || selected[key] {
				patch[property] = str(configuration.Values[key])
			}
		}
		if all || selected["PASSWORD"] {
			patch["TelnetPassword"] = configuration.Secrets["PASSWORD"]
		}
		if len(patch) > 0 {
			content, err := read(sevenDaysSettingsPath)
			if err != nil {
				return err
			}
			patched, err := quickPatchXMLProperties(content, "ServerSettings", patch)
			if err != nil {
				return err
			}
			wanted[sevenDaysSettingsPath] = patched
		}
		if all || selected["PASSWORD"] || selected["TELNET_PORT"] {
			var artifacts []steamCatalogConsolePackage
			if configuration.Secrets["PASSWORD"] != "" {
				artifact, err := a.steamCatalogConsoleNodeArtifact(ctx, server)
				if err != nil {
					return err
				}
				artifacts = append(artifacts, artifact)
				wanted[steamCatalogConsolePath] = artifact.Binary
				wanted[steamCatalogConsolePath+".manifest.json"] = artifact.Manifest
				wanted[steamCatalogConsolePath+".LICENSE"] = artifact.Licenses
			}
			launcher, console, err := steamCatalogSevenDaysConsole(num(configuration.Values["TELNET_PORT"]), configuration.Secrets["PASSWORD"], artifacts...)
			if err != nil {
				return err
			}
			wanted["/.voltra/sevendays-start.sh"] = launcher
			// Clearing a password also replaces the old client file with a
			// credential-free value, rather than leaving stale plaintext behind.
			if len(console) == 0 {
				console = []byte("{}\n")
			}
			wanted["/.voltra/sevendays-console.yaml"] = console
		}
	}
	previous := map[string][]byte{}
	previousExists := map[string]bool{}
	written := []string{}
	// Finish every read before modifying any file: a later read failure must
	// not leave an earlier native configuration partially changed.
	for file := range wanted {
		before, exists, err := a.steamCatalogReadNativeFile(ctx, server, file)
		if err != nil {
			return err
		}
		previous[file] = before
		previousExists[file] = exists
	}
	restore := func() error {
		cleanup, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		var failures []error
		for _, file := range written {
			var err error
			if previousExists[file] {
				err = a.quickSetupWrite(cleanup, server, file, previous[file])
			} else {
				_, err = a.daemonServer(cleanup, server, "POST", "/files/delete", M{"root": path.Dir(file), "files": []string{path.Base(file)}})
			}
			if err != nil {
				failures = append(failures, errSteamCatalogRestore)
			}
		}
		return errors.Join(failures...)
	}
	for file, content := range wanted {
		err := a.quickSetupMkdirAll(ctx, server, path.Dir(file))
		if err == nil {
			// A failed write can still truncate its target before returning an
			// error, so restore the attempted file as well as earlier successes.
			written = append(written, file)
			err = a.quickSetupWrite(ctx, server, file, content)
		}
		if err != nil {
			return errors.Join(err, restore())
		}
	}
	if len(undo) > 0 {
		*undo[0] = restore
	}
	return nil
}

func (a *App) steamCatalogUpdateControls(ctx context.Context, server M, changes M, settings ...M) (bool, error) {
	return a.steamCatalogMutateControls(ctx, server, changes, nil, nil, settings...)
}

func (a *App) steamCatalogMutateControls(ctx context.Context, server M, changes M, extra map[string]string, guard func(context.Context) error, settings ...M) (bool, error) {
	configuration, state, err := a.steamCatalogLoad(ctx, server)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return true, err
	}
	game := str(state["game"])
	if len(steamCatalogFields(game)) == 0 {
		return false, nil
	}
	for key := range changes {
		if !steamCatalogHasField(game, key) {
			return true, bad("Unsupported Steam control: " + key)
		}
	}
	conn, err := a.DB.Acquire(ctx)
	if err != nil {
		return true, err
	}
	defer steamUnlock(conn)
	if err = steamSessionLock(ctx, conn, "voltra:server-mutation:"+str(server["uuid"])); err != nil {
		return true, err
	}
	if err = a.quickSetupStopped(ctx, server); err != nil {
		return true, err
	}
	active, err := a.one(ctx, "SELECT EXISTS(SELECT 1 FROM steam_jobs WHERE server_id=$1 AND status IN ('queued','running')) AS active", server["id"])
	if err != nil {
		return true, err
	}
	if boolean(active["active"]) {
		return true, APIError{409, "SteamMaintenanceActive", "Wait for Steam maintenance before changing its controls."}
	}
	if guard != nil {
		if err = guard(ctx); err != nil {
			return true, err
		}
	}
	// Reload after acquiring the shared lock to avoid overwriting another edit.
	configuration, state, err = a.steamCatalogLoad(ctx, server)
	if err != nil {
		return true, err
	}
	cleaned := M{}
	for key, value := range changes {
		if steamCatalogSecretColumn(key) != "" && str(value) == steamCatalogSecretPlaceholder {
			continue
		}
		cleaned[key] = value
	}
	changes = cleaned
	if len(changes) == 0 && len(settings) == 0 && len(extra) == 0 {
		return true, nil
	}
	values := M{}
	for name, current := range configuration.Values {
		values[name] = current
	}
	for name, secret := range configuration.Secrets {
		values[name] = secret
	}
	keys := []string{}
	for key, value := range changes {
		values[key] = value
		keys = append(keys, key)
	}
	next, err := steamCatalogParse(game, values, 0)
	if err != nil {
		return true, err
	}
	for name, secret := range configuration.Secrets {
		if _, present := changes[name]; !present {
			next.Secrets[name] = secret
		}
	}
	if next.Branch == "public" {
		next.Secrets["SRCDS_BETAPASS"] = ""
	}
	startup := str(server["startup"])
	if _, changingPlayers := changes["MAX_PLAYERS"]; game == "satisfactory" && changingPlayers {
		startup, err = steamCatalogPlayersStartup(startup, next.Players)
		if err != nil {
			return true, err
		}
	}
	if _, changingPort := changes["RELIABLE_PORT"]; changingPort {
		if num(next.Values["RELIABLE_PORT"]) == 0 {
			allocation, allocationErr := a.one(ctx, `SELECT port FROM allocations WHERE server_id=$1 AND id<>$2 ORDER BY id LIMIT 1`, server["id"], server["allocation_id"])
			if allocationErr != nil {
				return true, bad("Assign a distinct reliable port before selecting automatic allocation.")
			}
			next.Values["RELIABLE_PORT"] = str(allocation["port"])
		}
		startup, err = steamCatalogReliableStartup(startup, num(next.Values["RELIABLE_PORT"]))
		if err != nil {
			return true, err
		}
	}
	if next.Validate && !a.steamCatalogOptionsAvailable(num(server["node_id"])) || next.Secrets["SRCDS_BETAPASS"] != "" && !a.steamCatalogPrivateBranchAvailable(num(server["node_id"])) {
		return true, APIError{409, "SteamNodeUpgradeRequired", "Upgrade and reconnect the node to use validation or private branch credentials."}
	}
	if err = a.steamCatalogValidateAllocation(ctx, server, next); err != nil {
		return true, err
	}
	consoleCipher, betaCipher, joinCipher := str(state["console_password_encrypted"]), str(state["beta_password_encrypted"]), str(state["join_password_encrypted"])
	if value, present := changes["PASSWORD"]; present {
		consoleCipher = ""
		if str(value) != "" {
			consoleCipher, err = a.seal(str(value))
		}
	}
	if err != nil {
		return true, err
	}
	for key, target := range map[string]*string{"ADMIN_PASSWORD": &consoleCipher, "SERVER_PASSWORD": &joinCipher} {
		if value, present := changes[key]; present {
			*target = ""
			if str(value) != "" {
				*target, err = a.seal(str(value))
				if err != nil {
					return true, err
				}
			}
		}
	}
	if value, present := changes["SRCDS_BETAPASS"]; present {
		betaCipher = ""
		if str(value) != "" {
			betaCipher, err = a.seal(str(value))
		}
	}
	if err != nil {
		return true, err
	}
	if next.Branch == "public" {
		betaCipher = ""
	}
	mode := str(state["mode"])
	if _, present := changes["AUTO_UPDATE"]; present {
		mode = "off"
		if next.Automatic {
			mode = "on_start"
		}
	}
	interval := num(state["check_interval_seconds"])
	if len(settings) > 0 {
		if requested, present := settings[0]["mode"]; present {
			mode = str(requested)
			if _, explicitAutomatic := changes["AUTO_UPDATE"]; explicitAutomatic && (mode != "off") != next.Automatic {
				return true, bad("Automatic update mode and AUTO_UPDATE must agree.")
			}
		}
		if requested, present := settings[0]["check_interval_seconds"]; present {
			interval = num(requested)
		}
	}
	branchChanged := str(state["branch"]) != next.Branch
	tx, err := conn.Begin(ctx)
	if err != nil {
		return true, err
	}
	defer tx.Rollback(ctx)
	if startup != str(server["startup"]) {
		if _, err = tx.Exec(ctx, "UPDATE servers SET startup=$2,updated_at=now() WHERE id=$1", server["id"], startup); err != nil {
			return true, err
		}
	}
	for key := range changes {
		stored := str(next.Values[key])
		if steamCatalogSecretColumn(key) != "" {
			stored = ""
		}
		if _, err = tx.Exec(ctx, `INSERT INTO server_variables(server_id,variable_id,variable_value) SELECT $1,id,$3 FROM egg_variables WHERE egg_id=$2 AND env_variable=$4 ON CONFLICT(server_id,variable_id) DO UPDATE SET variable_value=EXCLUDED.variable_value,updated_at=now()`, server["id"], server["egg_id"], stored, key); err != nil {
			return true, err
		}
	}
	if _, err = tx.Exec(ctx, `UPDATE steam_servers SET branch=$2,mode=$3,validate_on_start=$4,beta_password_encrypted=$5,console_password_encrypted=$6,needs_repair=needs_repair OR $7,last_checked_at=CASE WHEN $7 THEN NULL ELSE last_checked_at END,join_password_encrypted=$8,updated_at=now() WHERE server_id=$1`, server["id"], next.Branch, mode, next.Validate, betaCipher, consoleCipher, branchChanged, joinCipher); err != nil {
		return true, err
	}
	if _, err = tx.Exec(ctx, "UPDATE steam_servers SET check_interval_seconds=$2 WHERE server_id=$1", server["id"], interval); err != nil {
		return true, err
	}
	var undoConfiguration func() error
	if boolean(state["initialized"]) {
		if err = a.steamCatalogApplyConfigurationExtra(ctx, server, next, keys, extra, &undoConfiguration); err != nil {
			if errors.Is(err, errSteamCatalogRestore) {
				_ = tx.Rollback(ctx)
				cleanup, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				defer cancel()
				_ = a.exec(cleanup, "UPDATE steam_servers SET needs_repair=true WHERE server_id=$1", server["id"])
			}
			return true, err
		}
	}
	if err = tx.Commit(ctx); err != nil {
		if undoConfiguration != nil {
			if restoreErr := undoConfiguration(); restoreErr != nil {
				cleanup, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				defer cancel()
				_ = a.exec(cleanup, "UPDATE steam_servers SET needs_repair=true WHERE server_id=$1", server["id"])
				return true, errors.Join(err, restoreErr)
			}
		}
		return true, err
	}
	server["startup"] = startup
	if err = a.syncServer(ctx, server); err != nil {
		return true, err
	}
	return true, nil
}

func (a *App) steamCatalogUpdateVariable(ctx context.Context, server, changed M, value string) (bool, error) {
	key := str(changed["env_variable"])
	state, err := a.one(ctx, "SELECT game FROM steam_servers WHERE server_id=$1", server["id"])
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return true, err
	}
	if !steamCatalogHasField(str(state["game"]), key) {
		return false, nil
	}
	handled, err := a.steamCatalogUpdateControls(ctx, server, M{key: value})
	if err != nil || !handled {
		return handled, err
	}
	configuration, _, err := a.steamCatalogLoad(ctx, server)
	if err != nil {
		return true, err
	}
	changed["server_value"] = configuration.Values[key]
	if steamCatalogSecretColumn(key) != "" {
		changed["secret"] = true
		changed["configured"] = configuration.Secrets[key] != ""
		if configuration.Secrets[key] != "" {
			changed["server_value"] = steamCatalogSecretPlaceholder
		}
	}
	return true, nil
}

func (a *App) satisfactoryAfterInstall(ctx context.Context, server, settings M) error {
	_, initialized, err := a.quickSetupRead(ctx, server, "/FactoryGame/Saved/.voltra-managed-initialized")
	if err != nil || initialized {
		return err
	}
	configuration, _, err := a.steamCatalogLoad(ctx, server)
	if err != nil {
		return err
	}
	if err = a.steamCatalogApplyConfiguration(ctx, server, configuration, nil); err != nil {
		return err
	}
	return a.quickSetupWrite(ctx, server, "/FactoryGame/Saved/.voltra-managed-initialized", []byte("initialized\n"))
}

func steamCatalogFieldRows(game string) []M {
	rows := []M{}
	for _, field := range steamCatalogFields(game) {
		if field.Key == "MAX_PLAYERS" || field.Type == "fixed" || steamPalworldVariant(game) && field.Key == "SERVER_PASSWORD" {
			continue
		}
		row := M{"key": field.Key, "label": field.Label, "type": field.Type, "default": field.Default, "secret": field.Secret}
		row["required"] = field.Required
		if len(field.Options) > 0 {
			row["options"] = field.Options
		}
		if field.MaxLength > 0 {
			row["max_length"] = field.MaxLength
		}
		if field.Type == "number" || field.Type == "integer" {
			row["min"] = field.Min
			row["max"] = field.Max
		}
		if field.Key == "RELIABLE_PORT" {
			row["description"] = "0 chooses an available reliable port automatically; another value must be an allocation on the selected node."
		}
		if field.Key == "SRCDS_BETAPASS" {
			row["description"] = "Private branch credentials are temporarily unavailable while native SteamCMD command parsing is verified. Public and password-free branches remain available."
		}
		rows = append(rows, row)
	}
	return rows
}

func steamCatalogVariableRules(field steamCatalogField) string {
	switch field.Type {
	case "boolean":
		return "required|boolean"
	case "integer":
		return fmt.Sprintf("required|integer|between:%.0f,%.0f", field.Min, field.Max)
	case "number":
		return "required|numeric|min:1"
	case "fixed":
		return "required|string|in:" + field.Default
	}
	return "nullable|string|max:4096"
}

func steamCatalogReliableAllocation(selected, available []M, values M) ([]M, error) {
	if len(selected) < 2 {
		return nil, bad("Satisfactory requires two allocations.")
	}
	requested := num(values["RELIABLE_PORT"])
	if requested == 0 {
		values["RELIABLE_PORT"] = fmt.Sprint(num(selected[1]["port"]))
		return selected, nil
	}
	for _, reliable := range available {
		if num(reliable["port"]) != requested {
			continue
		}
		for _, primary := range available {
			if str(primary["ip"]) == str(reliable["ip"]) && num(primary["id"]) != num(reliable["id"]) {
				return []M{primary, reliable}, nil
			}
		}
	}
	return nil, bad("The requested reliable port and a separate game port must be free allocations on the same address.")
}

func (a *App) steamCatalogProvision(ctx context.Context, server M, configuration steamCatalogConfiguration, settings M) error {
	if err := a.steamCatalogValidateAllocation(ctx, server, configuration); err != nil {
		return err
	}
	tx, err := a.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	for key, value := range configuration.Values {
		if _, err = tx.Exec(ctx, `INSERT INTO server_variables(server_id,variable_id,variable_value) SELECT $1,id,$3 FROM egg_variables WHERE egg_id=$2 AND env_variable=$4 ON CONFLICT(server_id,variable_id) DO UPDATE SET variable_value=EXCLUDED.variable_value,updated_at=now()`, server["id"], server["egg_id"], str(value), key); err != nil {
			return err
		}
	}
	mode := "off"
	if configuration.Automatic {
		mode = "on_start"
	}
	if _, err = tx.Exec(ctx, `UPDATE steam_servers SET mode=$2,validate_on_start=$3,beta_password_encrypted=$4,console_password_encrypted=$5,join_password_encrypted=$6 WHERE server_id=$1`, server["id"], mode, configuration.Validate, str(settings["beta_password_encrypted"]), str(settings["console_password_encrypted"]), str(settings["join_password_encrypted"])); err != nil {
		return err
	}
	if err = tx.Commit(ctx); err != nil {
		return err
	}
	return a.syncServer(ctx, server)
}
