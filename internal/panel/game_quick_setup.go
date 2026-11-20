package panel

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"path"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"voltra/internal/gamesettings"
)

const palworldSettingsPath = "/Pal/Saved/Config/LinuxServer/PalWorldSettings.ini"
const quickFileLimit = 1 << 20

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
	return "", APIError{Status: 404, Code: "QuickSetupUnavailable", Detail: "Quick setup is not available for this game template."}
}

func quickConfigPath(game string) string {
	if game == "7days" {
		return gamesettings.SevenDaysSettingsPath
	}
	if game == "valheim" {
		return gamesettings.ValheimSettingsPath
	}
	if game == "minecraft" {
		return "/server.properties"
	}
	if game == "palworld" || steamPalworldVariant(game) {
		return steamPalworldSettingsPath(game)
	}
	return ""
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
		if revision != gamesettings.QuickRevision(game, file, content, exists) {
			fail(w, APIError{Status: 409, Code: "QuickSetupRevisionConflict", Detail: "These settings changed since you opened Quick setup. Reload before saving."})
			return
		}
		if !exists {
			fail(w, APIError{Status: 409, Code: "QuickSetupConfigMissing", Detail: "The game has not created its configuration yet. Start it once, stop it, then reload Quick setup."})
			return
		}
		var updated []byte
		if game == "7days" {
			updated, e = gamesettings.QuickPatchXMLProperties(content, "ServerSettings", patch)
		} else if game == "valheim" {
			updated, e = gamesettings.ValheimPatch(content, patch)
		} else if game == "minecraft" {
			updated, e = gamesettings.QuickPatchProperties(content, patch)
		} else if game == "palworld" || steamPalworldVariant(game) {
			updated, e = gamesettings.QuickPatchPalworld(content, patch)
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
	allowed := map[string]gamesettings.QuickField{}
	for _, field := range gamesettings.QuickFields(game) {
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
			if !ok || len([]rune(v)) > int(field.Max) || !gamesettings.QuickSingleLine(v) {
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
				encoded = gamesettings.QuickUnrealQuote(v)
			} else {
				encoded = gamesettings.QuickPropertyEscape(v)
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
	ctx = context.WithValue(ctx, gamesettings.QuickListingContextKey{}, map[string][]M{})
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
		records, _, e := gamesettings.QuickXMLProperties(content, "ServerSettings")
		if e != nil {
			return nil, e
		}
		for key, record := range records {
			values[key] = record.Value
		}
	}
	if exists && game == "valheim" {
		values, err = gamesettings.ValheimValues(content)
		if err != nil {
			return nil, err
		}
	}
	if exists && game == "minecraft" {
		records, e := gamesettings.QuickPropertyRecords(content)
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
		_, values, err = gamesettings.QuickPalworldOptions(content)
		if err != nil {
			return nil, err
		}
	}
	canvas, paper := false, false
	if game == "minecraft" {
		egg, e := a.one(ctx, "SELECT * FROM eggs WHERE id=$1", s["egg_id"])
		if e != nil {
			return nil, e
		}
		canvas = gamesettings.IsRecipe(egg, gamesettings.CanvasSettingsRecipe)
		paper = gamesettings.IsRecipe(egg, gamesettings.PaperDifficultyRecipe)
	}
	fields := []M{}
	if exists {
		for _, field := range gamesettings.QuickFields(game) {
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
			if canvas {
				gamesettings.CanvasDifficultyPresentation(row)
			}
			if paper {
				gamesettings.PaperDifficultyPresentation(row)
			}
			fields = append(fields, row)
		}
	}
	help := steamGameHelp(game)
	if game == "minecraft" {
		help = []M{{"label": "Minecraft properties", "text": "Changes take effect on the next start. Properties outside this form are preserved. Empty values mean the property is absent or could not be parsed; the game applies its defaults."}}
	}
	if canvas {
		help = []M{{"label": "Minecraft properties", "text": "Most properties take effect on the next start. Difficulty applies to newly created worlds. Properties outside this form are preserved."}, gamesettings.CanvasDifficultyHelp()}
	}
	if paper {
		help = []M{{"label": "Minecraft properties", "text": "Most properties take effect on the next start. Existing worlds may keep their saved difficulty. Properties outside this form are preserved."}, gamesettings.PaperDifficultyHelp()}
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
	return M{"game": game, "fields": fields, "folders": folders, "help": help, "requires_stop": true, "revision": gamesettings.QuickRevision(game, file, content, exists)}, nil
}

func (a *App) quickSetupRead(ctx context.Context, s M, file string) ([]byte, bool, error) {
	parts, err := gamesettings.QuickPathParts(file)
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
	entry, exists, err := gamesettings.QuickFindEntry(entries, parts[len(parts)-1])
	if err != nil || !exists {
		return nil, false, err
	}
	if !gamesettings.QuickFileEntry(entry) {
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
		return APIError{Status: 409, Code: "QuickSetupServerRunning", Detail: "Stop the server before changing Quick setup settings."}
	}
	return nil
}
func (a *App) quickSetupList(ctx context.Context, s M, folder string) ([]M, bool, error) {
	parts, err := gamesettings.QuickPathParts(folder)
	if err != nil {
		return nil, false, err
	}
	current := "/"
	entries, err := a.quickSetupListExisting(ctx, s, current)
	if err != nil {
		return nil, false, err
	}
	for _, part := range parts {
		entry, exists, e := gamesettings.QuickFindEntry(entries, part)
		if e != nil {
			return nil, false, e
		}
		if !exists {
			return []M{}, false, nil
		}
		if !gamesettings.QuickDirectoryEntry(entry) {
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

func (a *App) quickSetupListExisting(ctx context.Context, s M, folder string) ([]M, error) {
	cache, _ := ctx.Value(gamesettings.QuickListingContextKey{}).(map[string][]M)
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
	parts, err := gamesettings.QuickPathParts(folder)
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
	entry, exists, err := gamesettings.QuickFindEntry(entries, parts[len(parts)-1])
	if err != nil || !exists {
		return false, err
	}
	return gamesettings.QuickDirectoryEntry(entry), nil
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
			if gamesettings.QuickDirectoryEntry(entry) && gamesettings.QuickSafeDirectory(str(entry["name"])) {
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
		if gamesettings.QuickSafeDirectory(world) {
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
	parts, err := gamesettings.QuickPathParts(folder)
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
		entry, exists, e := gamesettings.QuickFindEntry(entries, part)
		if e != nil {
			return e
		}
		if exists && !gamesettings.QuickDirectoryEntry(entry) {
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
