package panel

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"unicode/utf16"
)

const palworldSettingsPath = "/Pal/Saved/Config/LinuxServer/PalWorldSettings.ini"
const quickFileLimit = 1 << 20

type quickField struct {
	Key, Label, Type string
	Min, Max         float64
	Options          []string
	Secret           bool
}

func quickSingleLine(value string) bool {
	return strings.IndexFunc(value, func(r rune) bool { return r < 32 || r == 127 }) < 0
}

func quickFields(game string) []quickField {
	switch game {
	case "7days":
		return []quickField{{Key: "ServerName", Label: "Server name", Type: "text", Max: 100}, {Key: "ServerDescription", Label: "Description", Type: "text", Max: 512}, {Key: "ServerPassword", Label: "Join password", Type: "text", Max: 128, Secret: true}, {Key: "ServerMaxPlayerCount", Label: "Player limit", Type: "number", Min: 1, Max: 32}, {Key: "GameDifficulty", Label: "Difficulty", Type: "select", Options: []string{"0", "1", "2", "3", "4", "5"}}, {Key: "DayNightLength", Label: "Minutes per game day", Type: "number", Min: 10, Max: 240}, {Key: "DayLightLength", Label: "Daylight hours", Type: "number", Min: 0, Max: 24}, {Key: "BloodMoonFrequency", Label: "Days between blood moons", Type: "number", Min: 0, Max: 365}, {Key: "LootAbundance", Label: "Loot abundance (%)", Type: "number", Min: 25, Max: 300}}
	case "valheim":
		return []quickField{{Key: "name", Label: "Server name", Type: "text", Max: 100}, {Key: "password", Label: "Join password", Type: "text", Max: 20, Secret: true}, {Key: "world", Label: "World name", Type: "text", Max: 20}, {Key: "public", Label: "Show in server browser", Type: "boolean"}}
	case "minecraft":
		return []quickField{
			{Key: "motd", Label: "Server message", Type: "text", Max: 512},
			{Key: "max-players", Label: "Player limit", Type: "number", Min: 1, Max: 200},
			{Key: "gamemode", Label: "Game mode", Type: "select", Options: []string{"survival", "creative", "adventure", "spectator"}},
			{Key: "difficulty", Label: "Difficulty", Type: "select", Options: []string{"peaceful", "easy", "normal", "hard"}},
			{Key: "pvp", Label: "Player combat", Type: "boolean"},
			{Key: "white-list", Label: "Require allowlist", Type: "boolean"},
			{Key: "view-distance", Label: "View distance", Type: "number", Min: 2, Max: 32},
			{Key: "simulation-distance", Label: "Simulation distance", Type: "number", Min: 2, Max: 32},
			{Key: "spawn-protection", Label: "Spawn protection radius", Type: "number", Min: 0, Max: 1000},
			{Key: "allow-flight", Label: "Allow flight", Type: "boolean"},
		}
	case "palworld", "palworld-native", "palworld-proton":
		return []quickField{
			{Key: "ServerName", Label: "Server name", Type: "text", Max: 100},
			{Key: "ServerDescription", Label: "Description", Type: "text", Max: 512},
			{Key: "ServerPassword", Label: "Join password", Type: "text", Max: 128, Secret: true},
			{Key: "AdminPassword", Label: "Admin password", Type: "text", Max: 128, Secret: true},
			{Key: "ServerPlayerMaxNum", Label: "Player limit", Type: "number", Min: 1, Max: 32},
			{Key: "ExpRate", Label: "Experience multiplier", Type: "number", Min: 0.1, Max: 20},
			{Key: "CollectionDropRate", Label: "Gathering multiplier", Type: "number", Min: 0.1, Max: 20},
			{Key: "DeathPenalty", Label: "Death penalty", Type: "select", Options: []string{"None", "Item", "ItemAndEquipment", "All"}},
			{Key: "bIsUseBackupSaveData", Label: "Built-in world backups", Type: "boolean"},
		}
	}
	return []quickField{}
}

func (a *App) registerGameQuickSetup(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/client/servers/{server}/game-settings", a.gameSettings)
	mux.HandleFunc("PUT /api/client/servers/{server}/game-settings", a.gameSettings)
	mux.HandleFunc("GET /api/client/servers/{server}/game-settings/folders", a.gameSettingsFolders)
	mux.HandleFunc("GET /api/client/servers/{server}/quick-setup", a.gameQuickSetup)
	mux.HandleFunc("PUT /api/client/servers/{server}/quick-setup", a.gameQuickSetup)
}

func (a *App) quickGame(ctx context.Context, s M) (string, error) {
	egg, err := a.one(ctx, "SELECT * FROM eggs WHERE id=$1", s["egg_id"])
	if err != nil {
		return "", err
	}
	if game := steamGameID(egg); game != "" {
		return game, nil
	}
	if javaMinecraftEgg(egg) {
		return "minecraft", nil
	}
	return "", APIError{404, "QuickSetupUnavailable", "Quick setup is not available for this game template."}
}

func quickConfigPath(game string) string {
	if game == "7days" {
		return sevenDaysSettingsPath
	}
	if game == "valheim" {
		return valheimSettingsPath
	}
	if game == "minecraft" {
		return "/server.properties"
	}
	if game == "palworld" || steamPalworldVariant(game) {
		return steamPalworldSettingsPath(game)
	}
	return ""
}

func quickRevision(game, file string, content []byte, exists bool) string {
	h := sha256.New()
	fmt.Fprintf(h, "%s\x00%s\x00%t\x00", game, file, exists)
	h.Write(content)
	return hex.EncodeToString(h.Sum(nil))
}

func (a *App) gameQuickSetup(w http.ResponseWriter, r *http.Request) {
	s, err := a.server(r, "file.read-content")
	if err != nil {
		fail(w, err)
		return
	}
	ctx := r.Context()
	game, err := a.quickGame(ctx, s)
	if err != nil {
		fail(w, err)
		return
	}
	file := quickConfigPath(game)
	if r.Method == "PUT" {
		u, e := a.user(r)
		if e != nil {
			fail(w, e)
			return
		}
		if !a.can(ctx, u, s, "file.update") {
			fail(w, forbidden())
			return
		}
		var in M
		if steamPalworldVariant(game) {
			in, e = decodeRaw(r)
		} else {
			in, e = decode(r)
		}
		if e != nil {
			fail(w, e)
			return
		}
		settings, ok := in["settings"].(map[string]any)
		if !ok || len(settings) == 0 {
			fail(w, bad("Choose at least one setting to save."))
			return
		}
		patch, e := quickValidateSettings(game, settings)
		if e != nil {
			fail(w, e)
			return
		}
		revision, ok := in["revision"].(string)
		if !ok || len(revision) != 64 {
			fail(w, bad("Reload Quick setup before saving."))
			return
		}
		if steamPalworldVariant(game) {
			if e = a.steamPalworldQuickUpdate(ctx, s, game, file, revision, settings, patch); e != nil {
				fail(w, e)
				return
			}
			keys := make([]string, 0, len(patch))
			for key := range patch {
				keys = append(keys, key)
			}
			sort.Strings(keys)
			_ = a.audit(ctx, num(u["id"]), num(s["id"]), "server:quick-setup.update", M{"game": game, "keys": keys})
			result, viewErr := a.quickSetupView(ctx, r, s, game)
			if viewErr != nil {
				fail(w, viewErr)
				return
			}
			writeJSON(w, 200, item("game_quick_setup", result))
			return
		}
		if game == "minecraft" {
			if e = a.minecraftQuickUpdate(ctx, s, file, revision, patch); e != nil {
				fail(w, e)
				return
			}
			keys := make([]string, 0, len(patch))
			for key := range patch {
				keys = append(keys, key)
			}
			sort.Strings(keys)
			_ = a.audit(ctx, num(u["id"]), num(s["id"]), "server:quick-setup.update", M{"game": game, "keys": keys})
			result, viewErr := a.quickSetupView(ctx, r, s, game)
			if viewErr != nil {
				fail(w, viewErr)
				return
			}
			writeJSON(w, 200, item("game_quick_setup", result))
			return
		}
		tx, e := a.DB.Begin(ctx)
		if e != nil {
			fail(w, e)
			return
		}
		defer tx.Rollback(ctx)
		if _, e = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "voltra:server-mutation:"+str(s["uuid"])); e != nil {
			fail(w, e)
			return
		}
		if e = a.quickSetupStopped(ctx, s); e != nil {
			fail(w, e)
			return
		}
		content, exists, e := a.quickSetupRead(ctx, s, file)
		if e != nil {
			fail(w, e)
			return
		}
		if revision != quickRevision(game, file, content, exists) {
			fail(w, APIError{409, "QuickSetupRevisionConflict", "These settings changed since you opened Quick setup. Reload before saving."})
			return
		}
		if !exists {
			fail(w, APIError{409, "QuickSetupConfigMissing", "The game has not created its configuration yet. Start it once, stop it, then reload Quick setup."})
			return
		}
		var updated []byte
		if game == "7days" {
			updated, e = quickPatchXMLProperties(content, "ServerSettings", patch)
		} else if game == "valheim" {
			updated, e = valheimPatch(content, patch)
		} else if game == "minecraft" {
			updated, e = quickPatchProperties(content, patch)
		} else if game == "palworld" || steamPalworldVariant(game) {
			updated, e = quickPatchPalworld(content, patch)
		} else {
			e = bad("Manage Satisfactory settings in the game's built-in Server Manager.")
		}
		if e != nil {
			fail(w, e)
			return
		}
		// Recheck the real daemon state immediately before the file write. The
		// shared lock also excludes panel power and Steam mutation operations.
		if e = a.quickSetupStopped(ctx, s); e != nil {
			fail(w, e)
			return
		}
		if e = a.quickSetupWrite(ctx, s, file, updated); e != nil {
			fail(w, e)
			return
		}
		if e = tx.Commit(ctx); e != nil {
			fail(w, e)
			return
		}
		keys := make([]string, 0, len(patch))
		for key := range patch {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		_ = a.audit(ctx, num(u["id"]), num(s["id"]), "server:quick-setup.update", M{"game": game, "keys": keys})
	}
	result, err := a.quickSetupView(ctx, r, s, game)
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, 200, item("game_quick_setup", result))
}

func quickValidateSettings(game string, settings M) (map[string]string, error) {
	allowed := map[string]quickField{}
	for _, field := range quickFields(game) {
		allowed[field.Key] = field
	}
	out := map[string]string{}
	for key, value := range settings {
		field, ok := allowed[key]
		if !ok {
			return nil, bad("This setting is not available in Quick setup.")
		}
		var encoded string
		switch field.Type {
		case "text":
			v, ok := value.(string)
			if !ok || len([]rune(v)) > int(field.Max) || !quickSingleLine(v) {
				return nil, bad("Enter a valid " + strings.ToLower(field.Label) + " without line breaks.")
			}
			if game == "7days" {
				encoded = v
			} else if game == "valheim" {
				if key == "password" && (len([]rune(v)) < 5 || len([]rune(v)) > 20) {
					return nil, bad("Choose a password from 5 to 20 characters.")
				}
				if (key == "name" && strings.TrimSpace(v) == "") || (key == "world" && !regexp.MustCompile(`^[a-zA-Z0-9_-]{1,20}$`).MatchString(v)) {
					return nil, bad("Enter a server name and a world name using letters, numbers, underscores or dashes.")
				}
				encoded = v
			} else if game == "palworld" || steamPalworldVariant(game) {
				encoded = quickUnrealQuote(v)
			} else {
				encoded = quickPropertyEscape(v)
			}
		case "select":
			v, ok := value.(string)
			found := false
			for _, option := range field.Options {
				if v == option {
					found = true
				}
			}
			if !ok || !found {
				return nil, bad("Select a valid " + strings.ToLower(field.Label) + ".")
			}
			encoded = v
		case "number":
			v, ok := applicationNumeric(value)
			if !ok || v < field.Min || v > field.Max {
				return nil, bad("Choose a valid " + strings.ToLower(field.Label) + ".")
			}
			if game == "minecraft" || game == "7days" || key == "ServerPlayerMaxNum" {
				if _, ok = applicationInteger(value); !ok {
					return nil, bad("The player limit and distance settings must be whole numbers.")
				}
			}
			encoded = strconv.FormatFloat(v, 'f', -1, 64)
		case "boolean":
			v, ok := value.(bool)
			if !ok {
				return nil, bad("Choose true or false for " + strings.ToLower(field.Label) + ".")
			}
			encoded = strconv.FormatBool(v)
			if game == "palworld" || steamPalworldVariant(game) {
				if v {
					encoded = "True"
				} else {
					encoded = "False"
				}
			}
		}
		out[key] = encoded
	}
	return out, nil
}

func (a *App) quickSetupView(ctx context.Context, r *http.Request, s M, game string) (M, error) {
	// Share listings only within this view. Saves must always read fresh state.
	ctx = context.WithValue(ctx, quickListingContextKey{}, map[string][]M{})
	file := quickConfigPath(game)
	var content []byte
	exists := true
	var err error
	if file != "" {
		content, exists, err = a.quickSetupRead(ctx, s, file)
		if err != nil {
			return nil, err
		}
	}
	values := map[string]string{}
	if exists && game == "7days" {
		records, _, e := quickXMLProperties(content, "ServerSettings")
		if e != nil {
			return nil, e
		}
		for key, record := range records {
			values[key] = record.Value
		}
	}
	if exists && game == "valheim" {
		values, err = valheimValues(content)
		if err != nil {
			return nil, err
		}
	}
	if exists && game == "minecraft" {
		records, e := quickPropertyRecords(content)
		if e != nil {
			return nil, e
		}
		for _, record := range records {
			if record.Key != "" {
				values[record.Key] = minecraftPropertyEnumLabel(record.Key, record.Value)
			}
		}
	}
	if exists && (game == "palworld" || steamPalworldVariant(game)) {
		_, values, err = quickPalworldOptions(content)
		if err != nil {
			return nil, err
		}
	}
	fields := []M{}
	if exists {
		for _, field := range quickFields(game) {
			var value any
			raw, found := values[field.Key]
			if found {
				value = raw
				switch field.Type {
				case "boolean":
					if strings.EqualFold(raw, "true") {
						value = true
					} else if strings.EqualFold(raw, "false") {
						value = false
					} else {
						value = nil
					}
				case "number":
					if n, e := strconv.ParseFloat(raw, 64); e == nil {
						value = n
					} else {
						value = nil
					}
				}
			}
			row := M{"key": field.Key, "label": field.Label, "type": field.Type, "value": value}
			if field.Type == "number" {
				row["min"], row["max"] = field.Min, field.Max
			}
			if field.Secret {
				row["secret"] = true
				if steamPalworldVariant(game) {
					row["value"] = nil
					row["configured"] = found && raw != ""
					row["required"] = field.Key == "AdminPassword"
				}
			}
			if field.Type == "select" {
				options := []M{}
				for _, option := range field.Options {
					options = append(options, M{"value": option, "label": option})
				}
				row["options"] = options
			}
			fields = append(fields, row)
		}
	}
	help := steamGameHelp(game)
	if game == "minecraft" {
		help = []M{{"label": "Minecraft properties", "text": "Changes take effect on the next start. Properties outside this form are preserved. Empty values mean the property is absent or could not be parsed; the game applies its defaults."}}
	}
	if !exists {
		help = append(help, M{"label": "Configuration not created yet", "text": "Start the game once, stop it, then reload Quick setup."})
	}
	folders := []M{}
	u, e := a.user(r)
	if e != nil {
		return nil, e
	}
	if a.can(ctx, u, s, "file.read") {
		folders, err = a.quickSetupFolders(ctx, s, game, values)
		if err != nil {
			return nil, err
		}
	}
	return M{"game": game, "fields": fields, "folders": folders, "help": help, "requires_stop": true, "revision": quickRevision(game, file, content, exists)}, nil
}

func (a *App) quickSetupRead(ctx context.Context, s M, file string) ([]byte, bool, error) {
	parts, err := quickPathParts(file)
	if err != nil {
		return nil, false, err
	}
	if len(parts) == 0 {
		return nil, false, bad("Quick setup requires a file path.")
	}
	entries, exists, err := a.quickSetupList(ctx, s, path.Dir(file))
	if err != nil || !exists {
		return nil, false, err
	}
	entry, exists, err := quickFindEntry(entries, parts[len(parts)-1])
	if err != nil || !exists {
		return nil, false, err
	}
	if !quickFileEntry(entry) {
		return nil, false, bad("Quick setup cannot read a configuration that is a directory, symlink or unknown file type.")
	}
	res, err := a.daemonServer(ctx, s, "GET", "/files/contents?"+url.Values{"file": {file}}.Encode(), nil)
	if err != nil {
		return nil, false, err
	}
	defer res.Body.Close()
	data, err := io.ReadAll(io.LimitReader(res.Body, quickFileLimit+1))
	if err != nil {
		return nil, false, err
	}
	if len(data) > quickFileLimit {
		return nil, false, bad("This configuration is too large for Quick setup. Use Files to edit it.")
	}
	return data, true, nil
}
func (a *App) quickSetupWrite(ctx context.Context, s M, file string, data []byte) error {
	res, err := a.daemonServer(ctx, s, "POST", "/files/write?"+url.Values{"file": {file}}.Encode(), bytes.NewReader(data))
	if err != nil {
		return err
	}
	return res.Body.Close()
}
func (a *App) quickSetupStopped(ctx context.Context, s M) error {
	res, err := a.daemonServer(ctx, s, "GET", "", nil)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	var info M
	if json.NewDecoder(io.LimitReader(res.Body, 64<<10)).Decode(&info) != nil {
		return bad("The node returned invalid game state. No settings were changed.")
	}
	state := str(info["state"])
	if state != "offline" && state != "stopped" {
		return APIError{409, "QuickSetupServerRunning", "Stop the server before changing Quick setup settings."}
	}
	return nil
}
func (a *App) quickSetupList(ctx context.Context, s M, folder string) ([]M, bool, error) {
	parts, err := quickPathParts(folder)
	if err != nil {
		return nil, false, err
	}
	current := "/"
	entries, err := a.quickSetupListExisting(ctx, s, current)
	if err != nil {
		return nil, false, err
	}
	for _, part := range parts {
		entry, exists, e := quickFindEntry(entries, part)
		if e != nil {
			return nil, false, e
		}
		if !exists {
			return []M{}, false, nil
		}
		if !quickDirectoryEntry(entry) {
			return nil, false, bad("A Quick setup folder path contains a file, symlink or unknown directory type.")
		}
		current = path.Join(current, part)
		entries, err = a.quickSetupListExisting(ctx, s, current)
		if err != nil {
			return nil, false, err
		}
	}
	return entries, true, nil
}

// Only list a directory whose existence was established by its parent's
// successful listing. Stock Wings may return 500 for an absent intermediate
// parent through openat2. No HTTP error, including 404/500, proves absence.
type quickListingContextKey struct{}

func (a *App) quickSetupListExisting(ctx context.Context, s M, folder string) ([]M, error) {
	cache, _ := ctx.Value(quickListingContextKey{}).(map[string][]M)
	key := str(s["uuid"]) + "\x00" + folder
	if entries, ok := cache[key]; ok {
		return entries, nil
	}
	res, err := a.daemonServer(ctx, s, "GET", "/files/list-directory?"+url.Values{"directory": {folder}}.Encode(), nil)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	var entries []M
	data, err := io.ReadAll(io.LimitReader(res.Body, quickFileLimit+1))
	if err != nil {
		return nil, err
	}
	if len(data) > quickFileLimit || json.Unmarshal(data, &entries) != nil {
		return nil, bad("The node returned an invalid or oversized folder listing.")
	}
	if cache != nil {
		cache[key] = entries
	}
	return entries, nil
}

// A shortcut needs the directory entry, not a listing of its contents.
func (a *App) quickSetupFolderExists(ctx context.Context, s M, folder string) (bool, error) {
	parts, err := quickPathParts(folder)
	if err != nil {
		return false, err
	}
	if len(parts) == 0 {
		_, exists, err := a.quickSetupList(ctx, s, folder)
		return exists, err
	}
	entries, exists, err := a.quickSetupList(ctx, s, path.Dir(folder))
	if err != nil || !exists {
		return false, err
	}
	entry, exists, err := quickFindEntry(entries, parts[len(parts)-1])
	if err != nil || !exists {
		return false, err
	}
	return quickDirectoryEntry(entry), nil
}

func quickPathParts(name string) ([]string, error) {
	if !strings.HasPrefix(name, "/") || path.Clean(name) != name || len(name) > 4096 {
		return nil, bad("Invalid Quick setup file path.")
	}
	if name == "/" {
		return []string{}, nil
	}
	parts := strings.Split(strings.TrimPrefix(name, "/"), "/")
	for _, part := range parts {
		if !quickSafeDirectory(part) {
			return nil, bad("Invalid Quick setup file path.")
		}
	}
	return parts, nil
}
func quickFindEntry(entries []M, name string) (M, bool, error) {
	var found M
	for _, entry := range entries {
		if str(entry["name"]) == name {
			if found != nil {
				return nil, false, bad("The node returned ambiguous file entries.")
			}
			found = entry
		}
	}
	return found, found != nil, nil
}
func quickSafeDirectory(name string) bool {
	return name != "" && name != "." && name != ".." && len(name) <= 255 && !strings.ContainsAny(name, "/\\\x00\r\n")
}

func quickDirectoryEntry(entry M) bool {
	if boolean(entry["symlink"]) || boolean(entry["is_symlink"]) {
		return false
	}
	// Wings returns directory/file/symlink; the client file API transforms
	// those names to is_file/is_symlink. Prefer the real daemon shape.
	if directory, ok := entry["directory"].(bool); ok {
		return directory
	}
	if isFile, ok := entry["is_file"].(bool); ok {
		return !isFile
	}
	return false
}

func quickFileEntry(entry M) bool {
	if boolean(entry["symlink"]) || boolean(entry["is_symlink"]) || boolean(entry["directory"]) {
		return false
	}
	if file, ok := entry["file"].(bool); ok {
		return file
	}
	if file, ok := entry["is_file"].(bool); ok {
		return file
	}
	return false
}
func (a *App) quickSetupFolders(ctx context.Context, s M, game string, values map[string]string) ([]M, error) {
	out := []M{}
	add := func(label, folder, description string) error {
		exists, err := a.quickSetupFolderExists(ctx, s, folder)
		if err != nil {
			return err
		}
		if exists {
			out = append(out, M{"label": label, "path": folder, "description": description})
		}
		return nil
	}
	if game == "satisfactory" {
		base := "/.config/Epic/FactoryGame/Saved/SaveGames"
		if err := add("Saved games", base+"/server", "Upload a .sav while stopped, then load it in the in-game Server Manager."); err != nil {
			return nil, err
		}
		entries, _, err := a.quickSetupList(ctx, s, base+"/blueprints")
		if err != nil {
			return nil, err
		}
		for _, entry := range entries {
			if quickDirectoryEntry(entry) && quickSafeDirectory(str(entry["name"])) {
				folder := base + "/blueprints/" + str(entry["name"])
				if err = add("Blueprints: "+str(entry["name"]), folder, "Upload .sbp and .sbpcfg files for this session while stopped."); err != nil {
					return nil, err
				}
			}
		}
		if err = add("Game configuration", "/FactoryGame/Saved/Config/LinuxServer", "Use Server Manager for server claiming, passwords and session settings."); err != nil {
			return nil, err
		}
	} else if game == "7days" {
		for _, folder := range []struct{ label, path string }{{"World data and saves", "/saves"}, {"Game logs", "/logs"}} {
			if err := add(folder.label, folder.path, "Stop the game before replacing world files. Keep a backup of the complete world folder."); err != nil {
				return nil, err
			}
		}
	} else if game == "valheim" {
		if err := add("World saves", "/saves", "Back up and replace the complete world folder and its matching metadata while stopped. Save formats vary by game version."); err != nil {
			return nil, err
		}
	} else if game == "palworld" || steamPalworldVariant(game) {
		for _, folder := range []struct{ label, path string }{{"Saved games", "/Pal/Saved/SaveGames"}, {"Server configuration", "/Pal/Saved/Config/LinuxServer"}} {
			if err := add(folder.label, folder.path, "Stop the server before uploading or replacing files. Back up saved games first."); err != nil {
				return nil, err
			}
		}
	} else if game == "minecraft" {
		for _, folder := range []string{"mods", "plugins", "resourcepacks"} {
			if err := add(strings.ToUpper(folder[:1])+folder[1:], "/"+folder, "Upload files compatible with your server version and loader while stopped."); err != nil {
				return nil, err
			}
		}
		world := values["level-name"]
		if world == "" {
			world = "world"
		}
		if quickSafeDirectory(world) {
			for _, name := range []string{world, world + "_nether", world + "_the_end"} {
				if err := add("World: "+name, "/"+name, "Stop the server before replacing a world. Back it up first."); err != nil {
					return nil, err
				}
			}
		}
	}
	return out, nil
}

func (a *App) quickSetupMkdirAll(ctx context.Context, s M, folder string) error {
	parts, err := quickPathParts(folder)
	if err != nil {
		return err
	}
	current := "/"
	entries, err := a.quickSetupListExisting(ctx, s, current)
	if err != nil {
		return err
	}
	for _, part := range parts {
		target := path.Join(current, part)
		entry, exists, e := quickFindEntry(entries, part)
		if e != nil {
			return e
		}
		if exists && !quickDirectoryEntry(entry) {
			return bad("Cannot prepare a game folder over a file, symlink or unknown directory type.")
		}
		if !exists {
			res, e := a.daemonServer(ctx, s, "POST", "/files/create-directory", M{"path": current, "name": part})
			if e != nil {
				return e
			}
			res.Body.Close()
		}
		current = target
		entries, err = a.quickSetupListExisting(ctx, s, current)
		if err != nil {
			return err
		}
	}
	return nil
}

// Java properties are edited by logical record, retaining unknown physical
// lines, comments, whitespace and line endings exactly, including continuations.
type quickPropertyRecord struct{ Raw, Key, Value string }

func quickPropertyRecords(data []byte) ([]quickPropertyRecord, error) {
	lines := strings.SplitAfter(string(data), "\n")
	out := []quickPropertyRecord{}
	for i := 0; i < len(lines); i++ {
		raw := lines[i]
		logical := strings.TrimSuffix(strings.TrimSuffix(lines[i], "\n"), "\r")
		comment := strings.TrimLeft(logical, " \t\f")
		// Java comments end at the physical newline even when the last byte is
		// a backslash; they cannot consume the following property's record.
		if comment == "" || comment[0] == '#' || comment[0] == '!' {
			out = append(out, quickPropertyRecord{Raw: raw})
			continue
		}
		for quickContinued(logical) {
			logical = logical[:len(logical)-1]
			i++
			if i >= len(lines) {
				return nil, bad("The properties file ends in an incomplete continuation.")
			}
			raw += lines[i]
			logical += strings.TrimLeft(strings.TrimSuffix(strings.TrimSuffix(lines[i], "\n"), "\r"), " \t\f")
		}
		trimmed := strings.TrimLeft(logical, " \t\f")
		record := quickPropertyRecord{Raw: raw}
		if trimmed != "" && trimmed[0] != '#' && trimmed[0] != '!' {
			end := 0
			escaped := false
			for end < len(trimmed) {
				c := trimmed[end]
				if !escaped && (c == '=' || c == ':' || c == ' ' || c == '\t' || c == '\f') {
					break
				}
				if c == '\\' && !escaped {
					escaped = true
				} else {
					escaped = false
				}
				end++
			}
			rest := strings.TrimLeft(trimmed[end:], " \t\f")
			if len(rest) > 0 && (rest[0] == '=' || rest[0] == ':') {
				rest = strings.TrimLeft(rest[1:], " \t\f")
			}
			var err error
			record.Key, err = quickPropertyUnescape(trimmed[:end])
			if err != nil {
				return nil, err
			}
			record.Value, err = quickPropertyUnescape(rest)
			if err != nil {
				return nil, err
			}
		}
		out = append(out, record)
	}
	return out, nil
}
func quickContinued(s string) bool {
	count := 0
	for i := len(s) - 1; i >= 0 && s[i] == '\\'; i-- {
		count++
	}
	return count%2 == 1
}
func quickPropertyUnescape(s string) (string, error) {
	var out strings.Builder
	for i := 0; i < len(s); i++ {
		if s[i] != '\\' {
			out.WriteByte(s[i])
			continue
		}
		i++
		if i >= len(s) {
			return "", bad("Invalid properties escape.")
		}
		switch s[i] {
		case 't':
			out.WriteByte('\t')
		case 'r':
			out.WriteByte('\r')
		case 'n':
			out.WriteByte('\n')
		case 'f':
			out.WriteByte('\f')
		case 'u':
			if i+4 >= len(s) {
				return "", bad("Invalid properties Unicode escape.")
			}
			n, e := strconv.ParseUint(s[i+1:i+5], 16, 16)
			if e != nil {
				return "", bad("Invalid properties Unicode escape.")
			}
			i += 4
			r := rune(n)
			if utf16.IsSurrogate(r) && i+6 < len(s) && s[i+1:i+3] == "\\u" {
				next, e := strconv.ParseUint(s[i+3:i+7], 16, 16)
				if e == nil {
					decoded := utf16.DecodeRune(r, rune(next))
					if decoded != '\uFFFD' {
						r = decoded
						i += 6
					}
				}
			}
			out.WriteRune(r)
		default:
			out.WriteByte(s[i])
		}
	}
	return out.String(), nil
}
func quickPropertyEscape(s string) string {
	var out strings.Builder
	for i, r := range s {
		switch r {
		case '\\':
			out.WriteString("\\\\")
		case '\t':
			out.WriteString("\\t")
		case '\n':
			out.WriteString("\\n")
		case '\r':
			out.WriteString("\\r")
		case '\f':
			out.WriteString("\\f")
		case ' ':
			if i == 0 {
				out.WriteByte('\\')
			}
			out.WriteRune(r)
		default:
			if r < 32 || r > 126 {
				for _, unit := range utf16.Encode([]rune{r}) {
					fmt.Fprintf(&out, "\\u%04x", unit)
				}
			} else {
				out.WriteRune(r)
			}
		}
	}
	return out.String()
}
func quickPatchProperties(data []byte, patch map[string]string) ([]byte, error) {
	records, err := quickPropertyRecords(data)
	if err != nil {
		return nil, err
	}
	newline := "\n"
	if bytes.Contains(data, []byte("\r\n")) {
		newline = "\r\n"
	}
	seen := map[string]bool{}
	var out strings.Builder
	for _, record := range records {
		if value, ok := patch[record.Key]; ok {
			if !seen[record.Key] {
				out.WriteString(record.Key + "=" + value + newline)
				seen[record.Key] = true
			}
		} else {
			out.WriteString(record.Raw)
		}
	}
	keys := []string{}
	for key := range patch {
		if !seen[key] {
			keys = append(keys, key)
		}
	}
	sort.Strings(keys)
	for _, key := range keys {
		if out.Len() > 0 && !strings.HasSuffix(out.String(), "\n") {
			out.WriteString(newline)
		}
		out.WriteString(key + "=" + patch[key] + newline)
	}
	return []byte(out.String()), nil
}

func quickUnrealQuote(s string) string {
	return `"` + strings.ReplaceAll(strings.ReplaceAll(s, `\`, `\\`), `"`, `\"`) + `"`
}

type quickPalTuple struct {
	Start, End int
	Segments   []string
}

func quickSplitTuple(value string) ([]string, error) {
	segments := []string{}
	start, depth := 0, 0
	quoted, escaped := false, false
	for i, c := range value {
		if quoted {
			if escaped {
				escaped = false
			} else if c == '\\' {
				escaped = true
			} else if c == '"' {
				quoted = false
			}
			continue
		}
		switch c {
		case '"':
			quoted = true
		case '(':
			depth++
		case ')':
			depth--
			if depth < 0 {
				return nil, bad("The Palworld settings tuple is malformed.")
			}
		case ',':
			if depth == 0 {
				segments = append(segments, value[start:i])
				start = i + 1
			}
		}
	}
	if quoted || depth != 0 {
		return nil, bad("The Palworld settings tuple is malformed.")
	}
	if strings.TrimSpace(value[start:]) != "" {
		segments = append(segments, value[start:])
	}
	return segments, nil
}
func quickPalworldOptions(data []byte) (quickPalTuple, map[string]string, error) {
	content := string(data)
	section := ""
	offset := 0
	tuple := quickPalTuple{Start: -1}
	values := map[string]string{}
	for _, line := range strings.SplitAfter(content, "\n") {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "[") && strings.HasSuffix(trimmed, "]") {
			section = trimmed
		}
		if section == "[/Script/Pal.PalGameWorldSettings]" && !strings.HasPrefix(trimmed, ";") && !strings.HasPrefix(trimmed, "#") {
			key, value, ok := strings.Cut(trimmed, "=")
			if ok && strings.TrimSpace(key) == "OptionSettings" {
				if tuple.Start != -1 {
					return tuple, nil, bad("The Palworld configuration has multiple OptionSettings entries. Resolve them in Files before using Quick setup.")
				}
				value = strings.TrimSpace(value)
				if len(value) < 2 || value[0] != '(' || value[len(value)-1] != ')' {
					return tuple, nil, bad("The Palworld settings tuple is malformed.")
				}
				start := strings.Index(line, "=") + 1
				for start < len(line) && (line[start] == ' ' || line[start] == '\t') {
					start++
				}
				tuple.Start = offset + start
				tuple.End = tuple.Start + len(value)
				segments, err := quickSplitTuple(value[1 : len(value)-1])
				if err != nil {
					return tuple, nil, err
				}
				tuple.Segments = segments
				for _, segment := range segments {
					key, raw, ok := strings.Cut(segment, "=")
					if !ok {
						return tuple, nil, bad("The Palworld settings tuple is malformed.")
					}
					key = strings.TrimSpace(key)
					raw = strings.TrimSpace(raw)
					if strings.HasPrefix(raw, `"`) {
						unquoted, e := strconv.Unquote(raw)
						if e != nil {
							return tuple, nil, bad("The Palworld settings contain an invalid quoted value.")
						}
						raw = unquoted
					}
					values[key] = raw
				}
			}
		}
		offset += len(line)
	}
	if tuple.Start == -1 {
		return tuple, nil, bad("No Palworld OptionSettings entry was found. Restore the native default configuration or edit it in Files.")
	}
	return tuple, values, nil
}
func quickPatchPalworld(data []byte, patch map[string]string) ([]byte, error) {
	tuple, _, err := quickPalworldOptions(data)
	if err != nil {
		return nil, err
	}
	segments := []string{}
	seen := map[string]bool{}
	for _, segment := range tuple.Segments {
		key, _, _ := strings.Cut(segment, "=")
		key = strings.TrimSpace(key)
		if value, ok := patch[key]; ok {
			if !seen[key] {
				prefix := segment[:len(segment)-len(strings.TrimLeft(segment, " \t"))]
				segments = append(segments, prefix+key+"="+value)
				seen[key] = true
			}
		} else {
			segments = append(segments, segment)
		}
	}
	keys := []string{}
	for key := range patch {
		if !seen[key] {
			keys = append(keys, key)
		}
	}
	sort.Strings(keys)
	for _, key := range keys {
		segments = append(segments, key+"="+patch[key])
	}
	out := append([]byte{}, data[:tuple.Start]...)
	out = append(out, []byte("("+strings.Join(segments, ",")+")")...)
	out = append(out, data[tuple.End:]...)
	return out, nil
}
