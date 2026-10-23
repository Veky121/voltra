package panel

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"path"
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode/utf8"
)

var serverConfigurationFields = []string{"config_files", "config_startup", "config_stop", "script_install", "script_container", "script_entry"}
var serverConfigurationEntrypoint = regexp.MustCompile(`^[A-Za-z0-9_./-]{1,191}$`)

func (a *App) registerServerConfiguration(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/client/servers/{server}/configuration", a.serverConfiguration)
	mux.HandleFunc("PUT /api/client/servers/{server}/configuration", a.serverConfiguration)
}

func configurationValues(egg M) M {
	out := M{}
	for _, key := range serverConfigurationFields {
		if key == "config_files" || key == "config_startup" {
			out[key] = asMap(egg[key])
		} else {
			out[key] = str(egg[key])
		}
	}
	return out
}

// Include inherited defaults and the server generation, so a stale editor
// cannot silently accept either a template edit or a concurrent server edit.
func configurationRevision(server, egg M) string {
	data, _ := json.Marshal(M{"server_id": server["id"], "egg_id": server["egg_id"], "updated_at": server["updated_at"], "defaults": configurationValues(egg), "overrides": asMap(server["configuration_overrides"])})
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func (a *App) configurationManaged(ctx context.Context, server, egg M) (bool, error) {
	var steam bool
	if err := a.DB.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM steam_servers WHERE server_id=$1)", server["id"]).Scan(&steam); err != nil {
		return false, err
	}
	return steam || steamGameID(egg) != "" || javaMinecraftEgg(egg) || boolean(asMap(egg["java_config"])["enabled"]) || boolean(asMap(server["java_config"])["enabled"]), nil
}

// Each field replaces that field's template default; omitted fields inherit.
// Never merge arbitrary server data into an egg, including privileged flags.
func (a *App) serverEffectiveEgg(ctx context.Context, server M) (M, error) {
	egg, err := a.effectiveEgg(ctx, num(server["egg_id"]))
	if err != nil {
		return nil, err
	}
	overrides, err := validateServerConfiguration(server["configuration_overrides"])
	if err != nil {
		return nil, err
	}
	managed, err := a.configurationManaged(ctx, server, egg)
	if err != nil {
		return nil, err
	}
	if err = configurationManagedOverrides(server, egg, overrides, managed); err != nil {
		return nil, err
	}
	for key, value := range overrides {
		egg[key] = value
	}
	return egg, nil
}

func configurationManagedOverrides(server, egg, overrides M, managed bool) error {
	if !managed {
		return nil
	}
	for _, key := range []string{"script_install", "script_container", "script_entry"} {
		if _, exists := overrides[key]; exists {
			return APIError{409, "ManagedInstallerConfiguration", "This server uses a managed installer. Remove installation overrides and use its game installation or Java settings controls."}
		}
	}
	// Process file rules can otherwise overwrite a managed launcher or its JVM
	// argument file, bypassing the same safeguards as an installer override.
	for name := range asMap(overrides["config_files"]) {
		base := strings.ToLower(path.Base(name))
		for _, config := range []M{asMap(egg["java_config"]), asMap(server["java_config"])} {
			if args := str(config["args_file"]); args != "" && strings.EqualFold(name, args) {
				return bad("Managed Java argument files must be changed through Java settings.")
			}
		}
		switch strings.ToLower(path.Ext(name)) {
		case ".properties", ".json", ".yaml", ".yml", ".ini", ".cfg", ".conf", ".xml", ".txt":
		default:
			return bad("Managed servers only support process file overrides for configuration documents, not launchers or executable files.")
		}
		if base == "user_jvm_args.txt" || base == "unix_args.txt" || base == "win_args.txt" {
			return bad("Managed Java argument files must be changed through Java settings.")
		}
	}
	return nil
}

// Validate raw JSON without normalizeInput trimming scripts or converting empty
// objects/strings into inheritance. Removing a key is the only reset operation.
func validateServerConfiguration(value any) (M, error) {
	if value == nil { // Old in-memory server maps may predate the new column.
		return M{}, nil
	}
	overrides, ok := value.(map[string]any)
	if !ok {
		return nil, bad("overrides must be a JSON object.")
	}
	encoded, err := json.Marshal(overrides)
	if err != nil || len(encoded) > 1<<20 {
		return nil, bad("Configuration overrides must contain at most 1 MiB of JSON.")
	}
	for key, value := range overrides {
		switch key {
		case "config_files":
			if err = validateConfigurationFiles(value); err != nil {
				return nil, err
			}
		case "config_startup":
			startup, ok := value.(map[string]any)
			if !ok {
				return nil, bad("config_startup must be a JSON object.")
			}
			for field, v := range startup {
				switch field {
				case "done":
					if text, ok := v.(string); ok {
						if !configurationText(text, 8192, false) {
							return nil, bad("Startup markers must be bounded strings without control characters.")
						}
					} else {
						markers, ok := v.([]any)
						if !ok || len(markers) > 128 {
							return nil, bad("config_startup.done must be a string or an array of strings.")
						}
						for _, marker := range markers {
							text, ok := marker.(string)
							if !ok || !configurationText(text, 8192, false) {
								return nil, bad("Startup markers must be bounded strings without control characters.")
							}
						}
					}
				case "strip_ansi":
					if _, ok := v.(bool); !ok {
						return nil, bad("config_startup.strip_ansi must be a boolean.")
					}
				default:
					return nil, bad("Unsupported config_startup field.")
				}
			}
		case "config_stop", "script_install", "script_container", "script_entry":
			text, ok := value.(string)
			limit := 191
			if key == "script_install" {
				limit = 512 << 10
			}
			if key == "script_container" {
				limit = 511
			}
			if !ok || !configurationText(text, limit, key == "script_install") {
				return nil, bad(key + " must be a bounded string without invalid control characters.")
			}
			if key == "script_container" && !javaImage.MatchString(text) {
				return nil, bad("script_container must be a valid container image reference.")
			}
			if key == "script_entry" && (!serverConfigurationEntrypoint.MatchString(text) || strings.Contains(text, "..")) {
				return nil, bad("script_entry must name an executable without arguments.")
			}
		default:
			return nil, bad("Unsupported configuration override field.")
		}
	}
	return overrides, nil
}

func configurationText(text string, limit int, multiline bool) bool {
	if !utf8.ValidString(text) || len(text) > limit {
		return false
	}
	for _, c := range text {
		if c < 32 || c == 127 {
			if multiline && (c == '\n' || c == '\r' || c == '\t') {
				continue
			}
			return false
		}
	}
	return true
}

func validateConfigurationFiles(value any) error {
	files, ok := value.(map[string]any)
	if !ok || len(files) > 128 {
		return bad("config_files must be an object with at most 128 files.")
	}
	for name, value := range files {
		if name == "" || name == "." || path.IsAbs(name) || path.Clean(name) != name || strings.ContainsAny(name, "\\:") || !configurationText(name, 512, false) {
			return bad("Configuration filenames must be safe paths relative to the server directory.")
		}
		for _, part := range strings.Split(name, "/") {
			if part == ".." {
				return bad("Configuration filenames cannot traverse directories.")
			}
		}
		file, ok := value.(map[string]any)
		if !ok {
			return bad("Each configuration file must be an object containing parser and find.")
		}
		if len(file) != 2 {
			return bad("Each configuration file must contain only parser and find.")
		}
		switch str(file["parser"]) {
		case "properties", "file", "yaml", "yml", "json", "ini", "xml":
		default:
			return bad("Choose a supported configuration file parser.")
		}
		find, ok := file["find"].(map[string]any)
		if !ok || len(find) > 512 {
			return bad("Configuration file find must be an object with at most 512 replacements.")
		}
		for match, replacement := range find {
			if match == "" || !configurationText(match, 8192, false) {
				return bad("Configuration matches must be bounded strings without control characters.")
			}
			if conditions, ok := replacement.(map[string]any); ok {
				for condition, replacement := range conditions {
					if !configurationText(condition, 8192, false) || !configurationReplacement(replacement) {
						return bad("Configuration replacements must be scalar values or conditional scalar values.")
					}
				}
			} else if !configurationReplacement(replacement) {
				return bad("Configuration replacements must be scalar values or conditional scalar values.")
			}
		}
	}
	return nil
}

func configurationReplacement(value any) bool {
	switch v := value.(type) {
	case string:
		return configurationText(v, 64<<10, true)
	case bool, json.Number, float64, int, int64:
		return true
	}
	return false
}

func (a *App) configurationStopped(ctx context.Context, server M) error {
	if str(server["status"]) != "" && str(server["status"]) != "reinstall_failed" || boolean(server["node_maintenance"]) || boolean(server["transferring"]) {
		return APIError{409, "ServerStateConflict", "The server is unavailable during installation, maintenance, suspension or transfer."}
	}
	var active bool
	if err := a.DB.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM steam_jobs WHERE server_id=$1 AND status IN ('queued','running')) OR EXISTS(SELECT 1 FROM steam_game_provisions WHERE server_id=$1 AND stage NOT IN ('queued','failed','complete'))`, server["id"]).Scan(&active); err != nil {
		return err
	}
	if active {
		return APIError{409, "ServerConfigurationLeaseConflict", "Wait for game installation or Steam maintenance to finish before changing configuration."}
	}
	res, err := a.daemonServer(ctx, server, "GET", "", nil)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	var info M
	if json.NewDecoder(io.LimitReader(res.Body, 64<<10)).Decode(&info) != nil {
		return APIError{502, "ServerConfigurationStateUnavailable", "The node returned invalid server state. No configuration was changed."}
	}
	if state := str(info["state"]); state != "offline" && state != "stopped" {
		return APIError{409, "ServerConfigurationRunning", "Stop the server before changing its configuration."}
	}
	return nil
}

func (a *App) configurationView(ctx context.Context, server M) (M, error) {
	egg, err := a.effectiveEgg(ctx, num(server["egg_id"]))
	if err != nil {
		return nil, err
	}
	managed, err := a.configurationManaged(ctx, server, egg)
	if err != nil {
		return nil, err
	}
	effective, err := a.serverEffectiveEgg(ctx, server)
	if err != nil {
		return nil, err
	}
	readinessErr := a.configurationStopped(ctx, server)
	view := M{"revision": configurationRevision(server, egg), "template": M{"id": egg["id"], "name": egg["name"], "nest_id": egg["nest_id"]}, "managed": managed, "overrides": asMap(server["configuration_overrides"]), "effective": configurationValues(effective), "defaults": configurationValues(egg), "can_update": readinessErr == nil, "applies": M{"process": "next_start", "installation": "next_install"}}
	if readinessErr != nil {
		// Do not expose daemon error bodies or transport details in this hint.
		reason := "Server readiness could not be confirmed. Check the node connection and reload before saving."
		var api APIError
		var apiPointer *APIError
		if errors.As(readinessErr, &apiPointer) {
			api = *apiPointer
		} else {
			_ = errors.As(readinessErr, &api)
		}
		switch api.Code {
		case "ServerStateConflict":
			reason = "The server is unavailable during installation, maintenance, suspension or transfer."
		case "ServerConfigurationLeaseConflict":
			reason = "Wait for game installation or Steam maintenance to finish."
		case "ServerConfigurationRunning":
			reason = "Stop the server before changing its configuration."
		}
		view["update_unavailable_reason"] = reason
	}
	return view, nil
}

func (a *App) serverConfiguration(w http.ResponseWriter, r *http.Request) {
	// requireAdmin has application-key semantics. This client route deliberately
	// checks the real account first, then retains server/client-key authorization.
	user, err := a.user(r)
	if err == nil && !boolean(user["root_admin"]) {
		err = forbidden()
	}
	if err != nil {
		fail(w, err)
		return
	}
	permission := "startup.read"
	if r.Method == "PUT" {
		permission = "startup.update"
	}
	lookup := r
	if r.Method == "GET" {
		// The server overview permits reading unavailable servers. Reuse its
		// authorization and fine-grained permission checks without the mutation
		// state gate, so readiness failures leave configuration readable.
		lookup = r.Clone(r.Context())
		lookup.URL.Path = strings.TrimSuffix(r.URL.Path, "/configuration")
	}
	server, err := a.server(lookup, permission)
	if err != nil {
		fail(w, err)
		return
	}
	if r.Method == "PUT" {
		input, err := decodeRaw(r)
		if err != nil {
			fail(w, err)
			return
		}
		for key := range input {
			if key != "revision" && key != "overrides" {
				fail(w, bad("Only revision and overrides may be supplied."))
				return
			}
		}
		revision, ok := input["revision"].(string)
		if !ok || len(revision) != 64 {
			fail(w, bad("Reload configuration before saving."))
			return
		}
		if value, ok := input["overrides"]; !ok || value == nil {
			fail(w, bad("overrides must be a JSON object; use an empty object to reset."))
			return
		}
		overrides, err := validateServerConfiguration(input["overrides"])
		if err != nil {
			fail(w, err)
			return
		}
		server, err = a.saveServerConfiguration(r.Context(), user, server, revision, overrides)
		if err != nil {
			fail(w, err)
			return
		}
	}
	view, err := a.configurationView(r.Context(), server)
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, 200, item("server_configuration", view))
}

func (a *App) saveServerConfiguration(ctx context.Context, user, server M, revision string, overrides M) (M, error) {
	// Keep advisory locks across committed writes and the daemon callback. Row
	// locks or uncommitted configuration would deadlock/hide Wings' callback.
	lock, err := a.DB.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer lock.Rollback(context.Background())
	if _, err = lock.Exec(ctx, "SELECT pg_advisory_xact_lock($1)", server["id"]); err != nil {
		return nil, err
	}
	if _, err = lock.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "voltra:server-mutation:"+str(server["uuid"])); err != nil {
		return nil, err
	}
	var stillAdmin bool
	if err = a.DB.QueryRow(ctx, "SELECT root_admin AND NOT disabled FROM users WHERE id=$1", user["id"]).Scan(&stillAdmin); err != nil {
		return nil, err
	}
	if !stillAdmin {
		return nil, forbidden()
	}
	current, err := a.one(ctx, `SELECT s.*,n.maintenance_mode AS node_maintenance,EXISTS(SELECT 1 FROM server_transfers t WHERE t.server_id=s.id AND t.successful IS NULL AND NOT t.archived) AS transferring FROM servers s JOIN nodes n ON n.id=s.node_id WHERE s.id=$1`, server["id"])
	if err != nil {
		return nil, err
	}
	egg, err := a.effectiveEgg(ctx, num(current["egg_id"]))
	if err != nil {
		return nil, err
	}
	if revision != configurationRevision(current, egg) {
		return nil, APIError{409, "ServerConfigurationRevisionConflict", "This server or its template changed. Reload configuration before saving."}
	}
	managed, err := a.configurationManaged(ctx, current, egg)
	if err != nil {
		return nil, err
	}
	if err = configurationManagedOverrides(current, egg, overrides, managed); err != nil {
		return nil, err
	}
	if err = a.configurationStopped(ctx, current); err != nil {
		return nil, err
	}
	updated, err := a.update(ctx, "servers", num(current["id"]), M{"configuration_overrides": overrides})
	if err != nil {
		return nil, err
	}
	if err = a.syncServer(ctx, updated); err != nil {
		cleanup, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		_, restoreErr := a.update(cleanup, "servers", num(current["id"]), M{"configuration_overrides": asMap(current["configuration_overrides"])})
		event := "server:configuration.sync-failed"
		properties := M{"restored": restoreErr == nil, "daemon_restored": false}
		if restoreErr == nil {
			properties["daemon_restored"] = a.syncServer(cleanup, current) == nil
		}
		_ = a.audit(cleanup, num(user["id"]), num(current["id"]), event, properties)
		if restoreErr != nil {
			return nil, APIError{502, "ServerConfigurationRollbackFailed", "The node rejected configuration and the previous settings could not be restored. Reload configuration and repair node synchronization before starting."}
		}
		if !boolean(properties["daemon_restored"]) {
			return nil, APIError{502, "ServerConfigurationResyncFailed", "Previous database settings were restored, but the node could not confirm restoration. Repair node synchronization before starting."}
		}
		return nil, APIError{502, "ServerConfigurationSyncFailed", "The node could not synchronize configuration. Previous settings were restored; check the node connection before retrying."}
	}
	keys := []string{}
	seen := map[string]bool{}
	for _, values := range []M{asMap(current["configuration_overrides"]), overrides} {
		for key := range values {
			if !seen[key] {
				keys = append(keys, key)
				seen[key] = true
			}
		}
	}
	sort.Strings(keys)
	_ = a.audit(ctx, num(user["id"]), num(current["id"]), "server:configuration.update", M{"fields": keys})
	return updated, nil
}
