package panel

import (
	"bytes"
	"context"
	"encoding/json"
	"math"
	"net/http"
	"path"
	"reflect"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"

	"gopkg.in/yaml.v3"
)

// General server configuration only. Mod/plugin documents are reached through
// folder shortcuts rather than scanned and merged into server settings.
type gameSettingsDocument struct {
	Path  string `json:"path"`
	Label string `json:"label"`
}
type gameSetting struct {
	key, value, kind, on, off string
	node                      *yaml.Node
	structured                bool
	secret                    bool
}
type gameSettingsParsed struct {
	fields []gameSetting
	patch  func(map[string]string) ([]byte, error)
}

var gameSettingSecret = regexp.MustCompile(`(?i)password|passwd|passphrase|secret|token|api.?key|auth.?key|license.?key|private.?key|credential|gslt`)
var gameSettingBoolean = regexp.MustCompile(`(?i)(^|[./])(enabled?|disabled?|allow|require|use|show|hide|force|enforce|prevent|broadcast|log|is|has)([._/-]|$)|^(pvp|hardcore|online-mode|white-list|allowlist|public)$|(?:Enabled|Disabled)$`)

type gameSettingsContentsKey struct{}

func copyGameSettingsComments(old, next *yaml.Node) {
	next.HeadComment, next.LineComment, next.FootComment = old.HeadComment, old.LineComment, old.FootComment
	for i := 0; i < len(old.Content) && i < len(next.Content); i++ {
		copyGameSettingsComments(old.Content[i], next.Content[i])
	}
}

func gameSettingsFormat(file string) string {
	switch strings.ToLower(path.Ext(file)) {
	case ".properties":
		return "properties"
	case ".json":
		return "json"
	case ".yml", ".yaml":
		return "yaml"
	case ".ini", ".cfg", ".conf", ".toml":
		return "ini"
	case ".xml":
		if path.Base(file) == "serverconfig.xml" {
			return "xml"
		}
	case ".txt":
		if path.Base(file) == "serverconfig.txt" {
			return "properties"
		}
	}
	return ""
}

func (a *App) gameSettingsDocuments(ctx context.Context, s, egg M, includeWorlds, includePlatform bool) ([]gameSettingsDocument, []M, error) {
	// No publisher schema or active-file authority has been established for Battalion.
	// Keep raw Files and startup controls available through their existing routes.
	if nativeSettingsIsRecipe(egg, "battalion_legacy/egg-b-a-t-t-a-l-i-o-n--legacy.json") {
		return nil, nil, notFound()
	}
	if soldatSettingsRecipe(egg) && !soldatSettingsAuthority(s, egg) {
		return nil, nil, notFound()
	}
	if err := a.prepareCampaignSettingsAuthority(ctx, s, egg); err != nil {
		return nil, nil, err
	}
	entries, err := a.quickSetupListExisting(ctx, s, "/")
	if err != nil {
		return nil, nil, err
	}
	docs := []gameSettingsDocument{}
	declaredDocuments := nativeSettingsDocuments(egg)
	preferredDocuments := gameSettingsDeclaredDocuments(egg)
	preferredOrder := map[string]int{}
	for i, file := range preferredDocuments {
		if _, exists := preferredOrder[file]; !exists {
			preferredOrder[file] = i
		}
	}
	craftopia := nativeSettingsIsRecipe(egg, "craftopia/egg-craftopia.json")
	seen := map[string]bool{}
	add := func(file string) {
		file = "/" + strings.TrimPrefix(file, "/")
		if nativeSettingsIsRecipe(egg, "brickadia/egg-brickadia.json") && file != brickadiaPath {
			return
		}
		if p, _ := integratedScalarSettings(egg); p != "" && !integratedScalarDocument(egg, file) {
			return
		}
		if nativeSettingsIsRecipe(egg, "ddnet/egg-d-d-net.json") && file != ddnetSettingsPath {
			return
		}
		if hytaleLayoutSettings(egg) && file != "/Server/config.json" {
			return
		}
		// The publisher seed is not the configuration used by a running world.
		if craftopia && file == "/DefaultServerSetting.ini" {
			return
		}
		if _, e := quickPathParts(file); e != nil || seen[file] || (gameSettingsDiscoveryFormat(egg, file) == "" && declaredDocuments[file] == "") {
			return
		}
		seen[file] = true
		docs = append(docs, gameSettingsDocument{file, strings.TrimPrefix(file, "/")})
	}
	// Root-level server settings, not identity databases, bans, caches or mods.
	for _, e := range entries {
		name := str(e["name"])
		lower := strings.ToLower(name)
		if quickFileEntry(e) && !strings.HasPrefix(lower, "mod") && !strings.HasPrefix(lower, "plugin") && (strings.Contains(lower, "server") || strings.Contains(lower, "settings") || strings.Contains(lower, "config") || map[string]bool{"bukkit.yml": true, "spigot.yml": true, "paper.yml": true, "purpur.yml": true, "pufferfish.yml": true, "folia.yml": true, "openttd.cfg": true, "valheim_server.cfg": true}[lower]) {
			add(name)
		}
	}
	candidates := preferredDocuments
	for file := range declaredDocuments {
		candidates = append(candidates, file)
	}
	for name := range asMap(egg["config_files"]) {
		name = strings.TrimPrefix(name, "/")
		if _, err := quickPathParts("/" + name); err == nil && !strings.Contains(name, "{{") && !strings.HasPrefix(name, "plugins/") && !strings.HasPrefix(name, "mods/") && gameSettingsFormat(name) != "" {
			candidates = append(candidates, "/"+name)
		}
	}
	// Native files that live below the root. Only listed when their parent proves
	// they exist. Repeated parent walks reuse this response's listings.
	worldFolders := map[string]bool{}
	game := steamGameID(egg)
	if javaMinecraftEgg(egg) {
		if includePlatform {
			candidates = append(candidates, "/config/paper-global.yml", "/config/paper-world-defaults.yml", "/config/fml.toml", "/config/forge-common.toml", "/config/forge-server.toml", "/config/neoforge-common.toml", "/config/neoforge-server.toml")
		}
		if includeWorlds && seen["/server.properties"] {
			data, exists, e := a.quickSetupRead(ctx, s, "/server.properties")
			if e != nil {
				return nil, nil, e
			}
			if exists {
				if cache, ok := ctx.Value(gameSettingsContentsKey{}).(map[string][]byte); ok {
					cache["/server.properties"] = data
				}
				records, e := quickPropertyRecords(data)
				if e != nil {
					return nil, nil, e
				}
				world := "world"
				for _, r := range records {
					if r.Key == "level-name" && quickSafeDirectory(r.Value) {
						world = r.Value
					}
				}
				for _, w := range []string{world, world + "_nether", world + "_the_end"} {
					worldFolders[w] = true
					candidates = append(candidates, "/"+w+"/paper-world.yml", "/"+w+"/serverconfig/forge-server.toml", "/"+w+"/serverconfig/neoforge-server.toml")
				}
			}
		}
	}
	if file := quickConfigPath(game); file != "" {
		candidates = append(candidates, file)
	}
	if nativeSettingsGameID(egg) == "arma3" {
		candidates = append(candidates, "/server.cfg", "/basic.cfg")
	}
	if game == "satisfactory" {
		candidates = append(candidates, "/FactoryGame/Saved/Config/LinuxServer/Game.ini", "/FactoryGame/Saved/Config/LinuxServer/Engine.ini")
	}
	if nativeSettingsIsRecipe(egg, "ddracenetwork/egg-d-d-race-network.json") {
		// Match the wrapper's canonical-file precedence, never merge executable
		// exec documents or edit an inactive shadow configuration.
		for _, file := range []string{ddnetSettingsPath, ddnetDataSettingsPath} {
			es, exists, e := a.quickSetupList(ctx, s, path.Dir(file))
			if e != nil {
				return nil, nil, e
			}
			if !exists {
				continue
			}
			entry, found, e := quickFindEntry(es, path.Base(file))
			if e != nil {
				return nil, nil, e
			}
			if found && quickFileEntry(entry) {
				add(file)
				break
			}
		}
	}
	for _, file := range candidates {
		es, exists, e := a.quickSetupList(ctx, s, path.Dir(file))
		if e != nil {
			return nil, nil, e
		}
		if exists {
			entry, found, e := quickFindEntry(es, path.Base(file))
			if e != nil {
				return nil, nil, e
			}
			if found && quickFileEntry(entry) {
				add(file)
			}
		}
	}
	sort.Slice(docs, func(i, j int) bool {
		if docs[i].Path == "/server.properties" {
			return true
		}
		if docs[j].Path == "/server.properties" {
			return false
		}
		left, leftDeclared := preferredOrder[docs[i].Path]
		right, rightDeclared := preferredOrder[docs[j].Path]
		if leftDeclared != rightDeclared {
			return leftDeclared
		}
		if leftDeclared && left != right {
			return left < right
		}
		return docs[i].Path < docs[j].Path
	})
	folders := []M{}
	for _, e := range entries {
		name := str(e["name"])
		if quickDirectoryEntry(e) && quickSafeDirectory(name) && (worldFolders[name] || map[string]bool{"config": true, "mods": true, "plugins": true, "resourcepacks": true, "saves": true, "worlds": true, "world": true}[strings.ToLower(name)]) {
			folders = append(folders, M{"label": name, "path": "/" + name})
		}
	}
	if nativeSettingsIsRecipe(egg, "minetest/egg-minetest.json") {
		children, exists, err := a.quickSetupList(ctx, s, "/.minetest")
		if err != nil {
			return nil, nil, err
		}
		if exists {
			for _, name := range []string{"mods", "games", "worlds"} {
				entry, found, err := quickFindEntry(children, name)
				if err != nil {
					return nil, nil, err
				}
				if found && quickDirectoryEntry(entry) {
					folders = append(folders, M{"label": name, "path": "/.minetest/" + name})
				}
			}
		}
	}
	if nativeSettingsIsRecipe(egg, "openra/openra_red_alert/egg-open-r-a.json") {
		entry, found, err := quickFindEntry(entries, "OpenRAData")
		if err != nil {
			return nil, nil, err
		}
		if found && quickDirectoryEntry(entry) {
			folders = append(folders, M{"label": "OpenRAData", "path": "/OpenRAData"})
		}
	}
	return docs, folders, nil
}

func (a *App) gameSettings(w http.ResponseWriter, r *http.Request) {
	s, err := a.server(r, "file.read-content")
	if err != nil {
		fail(w, err)
		return
	}
	ctx := context.WithValue(r.Context(), quickListingContextKey{}, map[string][]M{})
	ctx = context.WithValue(ctx, gameSettingsContentsKey{}, map[string][]byte{})
	egg, err := a.serverEffectiveEgg(ctx, s)
	if err != nil {
		fail(w, err)
		return
	}
	// ET's native document requires the reviewed launcher on the actual server.
	if nativeSettingsIsRecipe(egg, etlegacySettingsRecipe) &&
		(!etlegacySettingsDocument(egg, etlegacySettingsPath) || str(s["startup"]) != str(egg["startup"])) {
		fail(w, notFound())
		return
	}
	if err = a.prepareSTKSettingsEgg(ctx, s, egg); err != nil {
		fail(w, err)
		return
	}
	if err = a.prepareBananaSettingsEgg(ctx, s, egg); err != nil {
		fail(w, err)
		return
	}
	if err = a.prepareOpenArenaSettingsEgg(ctx, s, egg); err != nil {
		fail(w, err)
		return
	}
	u, err := a.user(r)
	if err != nil {
		fail(w, err)
		return
	}
	file := r.URL.Query().Get("file")
	inventory := r.Method == "GET" && r.URL.Query().Get("inventory") == "all"
	includeWorlds := inventory || strings.Count(file, "/") > 1 && !strings.HasPrefix(file, "/config/")
	includePlatform := inventory || includeWorlds || strings.HasPrefix(file, "/config/")
	docs, folders, err := a.gameSettingsDocuments(ctx, s, egg, includeWorlds, includePlatform)
	if err != nil {
		fail(w, err)
		return
	}
	if !a.can(ctx, u, s, "file.read") {
		folders = []M{}
	}
	if file == "" && len(docs) > 0 {
		file = docs[0].Path
	}
	found := false
	for _, d := range docs {
		if d.Path == file {
			found = true
		}
	}
	if file != "" && !found {
		fail(w, notFound())
		return
	}
	result := M{"game": "native", "documents": docs, "file": file, "fields": []M{}, "folders": folders, "help": []M{}, "requires_stop": true, "revision": ""}
	if game := steamGameID(egg); game != "" {
		result["game"] = game
	}
	if javaMinecraftEgg(egg) {
		result["game"] = "minecraft"
	}
	if inventory {
		writeJSON(w, 200, item("game_settings", result))
		return
	}
	if file == "" {
		if r.Method == "PUT" {
			fail(w, bad("Choose a configuration document."))
			return
		}
		writeJSON(w, 200, item("game_settings", result))
		return
	}
	read := func(ctx context.Context) ([]byte, error) {
		data, exists, e := a.quickSetupRead(ctx, s, file)
		if e != nil {
			return nil, e
		}
		if !exists {
			return nil, APIError{409, "GameSettingsMissing", "This configuration no longer exists. Refresh settings."}
		}
		return data, nil
	}
	if r.Method == "PUT" {
		if !a.can(ctx, u, s, "file.update") {
			fail(w, forbidden())
			return
		}
		if boolean(s["is_node_under_maintenance"]) || str(s["status"]) != "" {
			fail(w, bad("This server is not available for configuration updates."))
			return
		}
		in, e := decodeRaw(r)
		if e != nil {
			fail(w, e)
			return
		}
		changes, ok := in["settings"].(map[string]any)
		if !ok || len(changes) == 0 {
			fail(w, bad("Choose at least one setting to save."))
			return
		}
		playersAuthority, e := a.satisfactoryPlayersAuthority(ctx, s, egg, file)
		if e != nil {
			fail(w, e)
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
		var publicationServer, publicationEgg M
		// Startup can change while this request waits for the mutation lock.
		// Recheck ET authority from the database before touching native bytes.
		{
			s, e = a.server(r, "file.read-content")
			if e != nil {
				fail(w, e)
				return
			}
			egg, e = a.serverEffectiveEgg(r.Context(), s)
			if e != nil {
				fail(w, e)
				return
			}
			u, e = a.user(r)
			if e != nil {
				fail(w, e)
				return
			}
			if !a.can(ctx, u, s, "file.read-content") || !a.can(ctx, u, s, "file.update") {
				fail(w, forbidden())
				return
			}
			if boolean(s["is_node_under_maintenance"]) || str(s["status"]) != "" {
				fail(w, bad("This server is not available for configuration updates."))
				return
			}
			publicationServer = M{}
			for _, key := range []string{"id", "uuid", "node_id", "egg_id", "allocation_id", "startup", "image"} {
				publicationServer[key] = s[key]
			}
			publicationEgg = M{}
			for key, value := range egg {
				publicationEgg[key] = value
			}
			if e = a.prepareCampaignSettingsAuthority(r.Context(), s, egg); e != nil {
				fail(w, e)
				return
			}
			if campaignSettingsRequiresAuthority(egg) && str(s["startup"]) != str(egg["startup"]) || soldatSettingsRecipe(egg) && !soldatSettingsAuthority(s, egg) {
				fail(w, notFound())
				return
			}
		}
		if e = a.checkSatisfactoryPlayersAuthority(ctx, s, egg, file, playersAuthority); e != nil {
			fail(w, e)
			return
		}
		// Refresh dynamic paths on the newly loaded effective egg before
		// rediscovery. Admission-time selections belong to the previous egg map.
		fresh := r.Context()
		if e = a.prepareSTKSettingsEgg(fresh, s, egg); e != nil {
			fail(w, e)
			return
		}
		if e = a.prepareBananaSettingsEgg(fresh, s, egg); e != nil {
			fail(w, e)
			return
		}
		if e = a.prepareOpenArenaSettingsEgg(fresh, s, egg); e != nil {
			fail(w, e)
			return
		}
		// Re-discover with no request cache after acquiring the mutation lock.
		// A deleted file or changed active-document selection cannot retain
		// authority from the inventory that admitted this request.
		currentDocs, _, discoveryErr := a.gameSettingsDocuments(r.Context(), s, egg, includeWorlds, includePlatform)
		if discoveryErr != nil {
			fail(w, discoveryErr)
			return
		}
		selected := false
		for _, document := range currentDocs {
			if document.Path == file {
				selected = true
				break
			}
		}
		if !selected {
			fail(w, APIError{409, "GameSettingsSelectionChanged", "The active configuration changed. Reload settings before saving."})
			return
		}
		// Discovery's cache is never used to validate a write.
		if nativeSettingsIsRecipe(egg, quakeLiveSettingsRecipe) && file != str(egg["_quakelive_settings_path"]) {
			fail(w, APIError{409, "GameSettingsSelectionChanged", "The active configuration changed. Reload settings before saving."})
			return
		}
		if nativeSettingsIsSTK(egg) && file != str(egg["_stk_settings_path"]) || nativeSettingsIsRecipe(egg, "banana_shooter/egg-banana-shooter.json") && file != bananaSelectedSettingsDocument(egg) || nativeSettingsIsRecipe(egg, openArenaSettingsRecipe) && file != openArenaSelectedSettingsDocument(egg) {
			fail(w, APIError{409, "GameSettingsSelectionChanged", "The active configuration changed. Reload settings before saving."})
			return
		}
		if e = a.quickSetupStopped(fresh, s); e != nil {
			fail(w, e)
			return
		}
		data, e := read(fresh)
		if e != nil {
			fail(w, e)
			return
		}
		if str(in["revision"]) != campaignParserRevision(egg, file, data) {
			fail(w, APIError{409, "QuickSetupRevisionConflict", "These settings changed. Reload before saving."})
			return
		}
		parsed, e := parseDiscoveredGameSettings(egg, file, data)
		if e != nil {
			fail(w, e)
			return
		}
		patch, e := gameSettingsChanges(parsed.fields, changes, egg, file)
		if e != nil {
			fail(w, e)
			return
		}
		updated, e := parsed.patch(patch)
		if e != nil {
			fail(w, e)
			return
		}
		if nativeSettingsIsRecipe(egg, kf2SettingsRecipe) {
			if e = a.wave43ValidateKF2Update(fresh, s, file, updated); e != nil {
				fail(w, e)
				return
			}
		}
		if e = validateFactorioNativeSettings(egg, file, updated); e != nil {
			fail(w, e)
			return
		}
		// Validate the resulting document before writing anything.
		if _, e = parseDiscoveredGameSettings(egg, file, updated); e != nil {
			fail(w, e)
			return
		}
		if e = a.quickSetupStopped(fresh, s); e != nil {
			fail(w, e)
			return
		}
		factorioAuthority := factorioNativeSettings(egg)
		{
			before := str(egg["_campaign_parser_binding"])
			// Daemon reads above can outlive a permission or startup change.
			// Reload database authority immediately before publication as well.
			s, e = a.server(r, "file.read-content")
			if e != nil {
				fail(w, e)
				return
			}
			u, e = a.user(r)
			if e != nil {
				fail(w, e)
				return
			}
			if !a.can(fresh, u, s, "file.update") {
				fail(w, forbidden())
				return
			}
			if boolean(s["is_node_under_maintenance"]) || str(s["status"]) != "" {
				fail(w, bad("This server is not available for configuration updates."))
				return
			}
			egg, e = a.serverEffectiveEgg(fresh, s)
			if e != nil {
				fail(w, e)
				return
			}
			if !reflect.DeepEqual(publicationEgg, egg) {
				fail(w, APIError{409, "GameSettingsAuthorityChanged", "Configuration authority changed. Reload settings."})
				return
			}
			if campaignParserRecipe(publicationEgg) != "" && campaignParserRecipe(egg) == "" {
				fail(w, notFound())
				return
			}
			if e = a.prepareCampaignSettingsAuthority(fresh, s, egg); e != nil {
				fail(w, e)
				return
			}
			if factorioAuthority && (!factorioNativeSettings(egg) || str(s["startup"]) != factorioNativeStartup || str(egg["startup"]) != factorioNativeStartup) {
				fail(w, notFound())
				return
			}
			// Compare the authority used to parse, allowing unchanged custom startup.
			for key, value := range publicationServer {
				if !reflect.DeepEqual(value, s[key]) {
					fail(w, APIError{409, "GameSettingsAuthorityChanged", "Configuration authority changed. Reload settings."})
					return
				}
			}
			if e = a.prepareSTKSettingsEgg(fresh, s, egg); e != nil {
				fail(w, e)
				return
			}
			if e = a.prepareBananaSettingsEgg(fresh, s, egg); e != nil {
				fail(w, e)
				return
			}
			if e = a.prepareOpenArenaSettingsEgg(fresh, s, egg); e != nil {
				fail(w, e)
				return
			}
			finalDocs, _, finalErr := a.gameSettingsDocuments(fresh, s, egg, includeWorlds, includePlatform)
			if finalErr != nil {
				fail(w, finalErr)
				return
			}
			selected = false
			for _, document := range finalDocs {
				if document.Path == file {
					selected = true
				}
			}
			if !selected || nativeSettingsIsSTK(egg) && file != str(egg["_stk_settings_path"]) || nativeSettingsIsRecipe(egg, "banana_shooter/egg-banana-shooter.json") && file != bananaSelectedSettingsDocument(egg) || nativeSettingsIsRecipe(egg, openArenaSettingsRecipe) && file != openArenaSelectedSettingsDocument(egg) || nativeSettingsIsRecipe(egg, quakeLiveSettingsRecipe) && file != str(egg["_quakelive_settings_path"]) {
				fail(w, APIError{409, "GameSettingsSelectionChanged", "The active configuration changed. Reload settings before saving."})
				return
			}
			latest, readErr := read(fresh)
			if readErr != nil {
				fail(w, readErr)
				return
			}
			if before != str(egg["_campaign_parser_binding"]) || !bytes.Equal(latest, data) {
				fail(w, APIError{409, "QuickSetupRevisionConflict", "These settings changed. Reload before saving."})
				return
			}
		}
		if e = a.checkSatisfactoryPlayersAuthority(fresh, s, egg, file, playersAuthority); e != nil {
			fail(w, e)
			return
		}
		if playersAuthority != "" {
			latestServer, err := a.server(r, "file.read-content")
			if err != nil {
				fail(w, err)
				return
			}
			latestUser, err := a.user(r)
			if err != nil {
				fail(w, err)
				return
			}
			if !a.can(fresh, latestUser, latestServer, "file.update") {
				fail(w, forbidden())
				return
			}
			latest, err := read(fresh)
			if err != nil {
				fail(w, err)
				return
			}
			if !bytes.Equal(latest, data) {
				fail(w, APIError{409, "QuickSetupRevisionConflict", "These settings changed. Reload before saving."})
				return
			}
		}
		if nativeSettingsIsRecipe(egg, "brickadia/egg-brickadia.json") || among165Recipe(egg) != "" || assettoSettingsRecipe(egg) || beamngSettingsRecipe(egg) != "" || nativeSettingsIsRecipe(egg, archeanRepairRecipe) || nativeSettingsIsRecipe(egg, urbanTerrorSettingsRecipe) || nativeSettingsIsRecipe(egg, srb2SettingsRecipe) {
			// Reads can outlive a launcher or permission change. Bind again at
			// the final publication boundary, outside the inventory cache.
			latestServer, err := a.server(r, "file.read-content")
			if err != nil {
				fail(w, err)
				return
			}
			latestUser, err := a.user(r)
			if err != nil {
				fail(w, err)
				return
			}
			if !a.can(fresh, latestUser, latestServer, "file.update") {
				fail(w, forbidden())
				return
			}
			latestEgg, err := a.serverEffectiveEgg(fresh, latestServer)
			if err != nil {
				fail(w, err)
				return
			}
			if (!nativeSettingsIsRecipe(latestEgg, "brickadia/egg-brickadia.json") && among165Recipe(latestEgg) == "" && !assettoSettingsRecipe(latestEgg) && beamngSettingsRecipe(latestEgg) == "" && !nativeSettingsIsRecipe(latestEgg, archeanRepairRecipe) && !nativeSettingsIsRecipe(latestEgg, urbanTerrorSettingsRecipe) && !nativeSettingsIsRecipe(latestEgg, srb2SettingsRecipe)) || !reflect.DeepEqual(publicationEgg, latestEgg) {
				fail(w, notFound())
				return
			}
			if err = a.prepareCampaignSettingsAuthority(fresh, latestServer, latestEgg); err != nil {
				fail(w, err)
				return
			}
			if str(latestEgg["_campaign_parser_binding"]) != str(egg["_campaign_parser_binding"]) {
				fail(w, APIError{409, "GameSettingsAuthorityChanged", "Configuration authority changed. Reload settings."})
				return
			}
		}

		if e = a.persistSatisfactoryPlayers(fresh, tx, s, egg, file, patch); e != nil {
			fail(w, e)
			return
		}
		if e = a.quickSetupWrite(fresh, s, file, updated); e != nil {
			if playersAuthority != "" {
				if restoreErr := a.quickSetupWrite(fresh, s, file, data); restoreErr != nil {
					fail(w, APIError{500, "GameSettingsRestoreFailed", "Native settings could not be restored after a failed write. Durable controls were not saved. Inspect the native file before starting."})
					return
				}
			}
			fail(w, e)
			return
		}
		if e = tx.Commit(ctx); e != nil {
			if playersAuthority != "" {
				if restoreErr := a.quickSetupWrite(fresh, s, file, data); restoreErr != nil {
					fail(w, APIError{500, "GameSettingsRestoreFailed", "Native settings could not be restored after a failed commit. Inspect the native file before starting."})
					return
				}
			}
			fail(w, e)
			return
		}
		keys := []string{}
		for key := range patch {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		_ = a.audit(ctx, num(u["id"]), num(s["id"]), "server:game-settings.update", M{"file": file, "keys": keys})
	}
	data, cached := ctx.Value(gameSettingsContentsKey{}).(map[string][]byte)[file]
	if !cached || r.Method == "PUT" {
		readContext := ctx
		if r.Method == "PUT" {
			readContext = r.Context()
		}
		data, err = read(readContext)
	}
	if err != nil {
		fail(w, err)
		return
	}
	parsed, err := parseDiscoveredGameSettings(egg, file, data)
	if err != nil {
		fail(w, err)
		return
	}
	fields := []M{}
	for _, f := range parsed.fields {
		value := any(f.value)
		kind := f.kind
		if kind == "boolean" {
			value = f.value == f.on
		}
		secret := f.secret || gameSettingSecret.MatchString(f.key) && !(nativeSettingsIsRecipe(egg, "windrose/egg-windrose.json") && f.key == windroseSettingsPrefix+"IsPasswordProtected" && f.kind == "boolean" || f.kind == "boolean" && craftopiaSettingsBit(egg, file, f.key) || tshockNativeBoolean(egg, file, f.key, f.kind) || openttdPublicNumericField(egg, file, f) || nativeSettingsIsRecipe(egg, portalKnightsRecipe) && f.kind == "boolean")
		field := M{"key": f.key, "label": f.key, "type": kind, "value": value, "secret": secret, "readonly": f.kind == "readonly" || gameSettingManaged(egg, file, f.key)}
		if wave85ASEManaged(egg, file, f.key) {
			field["description"] = "Managed by shared game setup controls for player capacity and mods, or the private console boundary."
		}
		switch campaignParserRecipe(egg) {
		case starmadeSettingsRecipe:
			starmadeSettingPresentation(field)
		case coreKeeperSettingsRecipe:
			coreKeeperSettingPresentation(field)
		case necesseSettingsRecipe:
			necesseSettingPresentation(field)
		case valheimPlusSettingsRecipe:
			metadata := valheimPlusLabels[f.key]
			field["label"], field["description"] = metadata[0], metadata[1]
			field["group"], _, _ = strings.Cut(f.key, "/")
			field["restart_required"] = true
			if f.key == "Server/maxPlayers" {
				field["min"], field["max"] = 1, 32
			}
		case bepinexLoggingRecipe:
			field["label"], field["description"] = "Disk logging", "Write BepInEx logs to disk."
			field["group"], field["restart_required"] = "Logging", true
		case nuclearRecipe, solaceSettingsRecipe, nzPortableSettingsRecipe, vrisingSettingsRecipe, gtacSettingsRecipe, clusterioSettingsRecipe, kspDMPRecipe, dstSettingsRecipe, "openrct2/egg-openrct2.json", ragecoopRecipe, romesteadSettingsRecipe:
			field["group"], field["restart_required"] = "General", true
		case enshroudedSettingsRecipe:
			enshroudedSettingPresentation(field)
		case projectZomboidSettingsRecipe:
			for k, v := range projectZomboidSettingMetadata(f.key) {
				field[k] = v
			}
		case groundBranchSettingsRecipe:
			groundBranchSettingPresentation(field)
		}

		if recipe := campaignParserRecipe(egg); recipe == mordhauLinuxSettingsRecipe || recipe == kf2SettingsRecipe || recipe == veinSettingsRecipe {
			field["group"], field["restart_required"] = "General", true
		}
		if recipe := campaignParserRecipe(egg); recipe == jc3SettingsRecipe || recipe == plainsSettingsRecipe {
			field["group"], field["restart_required"] = "General", true
		}
		if recipe := campaignParserRecipe(egg); recipe == ss14SettingsRecipe || recipe == stationeersBepinexRecipe || recipe == stationeersVanillaRecipe || recipe == "the_isle/evrima/egg-the-isle.json" {
			field["group"], field["restart_required"] = "General", true
			if recipe == ss14SettingsRecipe {
				for k, v := range ss14ReviewedMetadata(f.key) {
					field[k] = v
				}
			}
			if recipe == "the_isle/evrima/egg-the-isle.json" && f.kind == "boolean" {
				field["secret"] = false
				secret = false
			}
		}
		if recipe := campaignParserRecipe(egg); recipe == aapgSettingsRecipe || recipe == sandstormSettingsRecipe || recipe == "humanitz/egg-humanit-z.json" {
			field["group"], field["restart_required"] = "General", true
			if recipe == sandstormSettingsRecipe {
				sandstormSettingPresentation(field)
			}
		}
		if nativeSettingsIsRecipe(egg, resoniteSettingsRecipe) {
			field["group"] = "General"
			labels := map[string]string{"/comment": "Description", "/usernameOverride": "Display username", "/loginCredential": "Resonite account", "/loginPassword": "Resonite password"}
			field["label"] = labels[f.key]
		}
		if nativeSettingsIsRecipe(egg, portalKnightsRecipe) {
			parts := strings.Split(strings.TrimPrefix(f.key, "/"), "/")
			field["group"] = "General"
			if len(parts) == 2 && (parts[0] == "admins" || parts[0] == "users" || parts[0] == "guests") {
				field["group"] = parts[0]
			}
			labels := map[string]string{"name": "Server name", "universeSize": "Universe size", "canLogin": "Allow login", "canKickPlayers": "Allow kicking players", "canModifyWorld": "Allow world changes"}
			field["label"] = labels[parts[len(parts)-1]]
			if f.key == "/universeSize" {
				field["type"] = "select"
				field["options"] = []M{{"value": "Small", "label": "Small"}, {"value": "Normal", "label": "Normal"}, {"value": "Large", "label": "Large"}}
			}
		}
		if nativeSettingsIsRecipe(egg, redMSettingsRecipe) {
			field["group"] = "General"
			if f.key == "sv_hostname" {
				field["label"] = "Server name"
			} else {
				field["label"] = "LAN only"
			}
		}
		if cube := cubeGameSettingsKind(egg, file); cube != "" {
			if label := cubeGameSettingLabel(cube, f.key); label != "" {
				field["label"] = label
			}
			if cube == "sauerbraten" && f.key == "public-server-mode" {
				field["type"] = "select"
				field["options"] = []M{{"value": "0", "label": "Private privileges"}, {"value": "1", "label": "Public privileges"}, {"value": "2", "label": "Cooperative privileges"}}
			}
		}
		game := steamGameID(egg)
		if javaMinecraftEgg(egg) {
			game = "minecraft"
		}
		for _, spec := range quickFields(game) {
			if spec.Key == f.key {
				field["label"] = spec.Label
				if spec.Type == "select" {
					for _, option := range spec.Options {
						if f.value == option {
							choices := []M{}
							for _, value := range spec.Options {
								choices = append(choices, M{"value": value, "label": value})
							}
							field["type"], field["options"] = "select", choices
							break
						}
					}
				}
				break
			}
		}
		if secret {
			field["value"] = nil
			field["configured"] = f.value != ""
		}
		if nativeSettingsIsRecipe(egg, "ddnet/egg-d-d-net.json") && file == ddnetSettingsPath {
			labels := map[string]string{"sv_name": "Server name", "sv_map": "Map", "sv_register": "Public listing", "sv_max_clients": "Maximum clients", "sv_sixup": "0.7 protocol support", "sv_test_cmds": "Test commands"}
			if label := labels[f.key]; label != "" {
				field["label"], field["group"], field["restart_required"] = label, "General", true
			}
		}
		if p, _ := integratedScalarSettings(egg); p != "" {
			field["group"], field["restart_required"] = "General", true
			if p == towerSettingsPath {
				towerSettingPresentation(field)
			}
			if p == terraTechSettingsPath {
				if f.key == "SlotCount" {
					field["label"], field["min"], field["max"], field["type"] = "Player slots", 1, 6, "number"
				}
			}
			if p == windroseSettingsPath {
				labels := map[string]string{"ServerName": "Server name", "UseDirectConnection": "Use direct connection", "Password": "Password", "MaxPlayerCount": "Maximum players", "InviteCode": "Invite code", "IsPasswordProtected": "Password protection"}
				field["label"] = labels[strings.TrimPrefix(f.key, windroseSettingsPrefix)]
			}
		}
		if nativeSettingsIsRecipe(egg, gmodSettingsRecipe) && file == gmodSettingsPath {
			gmodSettingPresentation(field)
			field["description"] = "Native config value applied on restart. Plugins and gamemode scripts may change runtime behavior."
		}
		if (nativeSettingsIsRecipe(egg, tf2SettingsRecipe) && file == tf2SettingsPath || nativeSettingsIsRecipe(egg, nmrihSettingsRecipe) && file == nmrihSettingsPath) && f.key == "mp_timelimit" {
			field["label"], field["group"], field["min"] = "Time limit (minutes)", "General", 0
			field["description"] = "Native config value applied on restart. Map scripts and plugins may change runtime behavior."
		}
		if nativeSettingsIsRecipe(egg, astrocolonySettingsRecipe) {
			astrocolonySettingPresentation(field)
		}
		if file == "/server.properties" && nativeSettingsIsRecipe(egg, canvasSettingsRecipe) {
			canvasDifficultyPresentation(field)
		}
		if file == "/server.properties" && nativeSettingsIsRecipe(egg, paperDifficultyRecipe) {
			paperDifficultyPresentation(field)
		}
		carrierSettingPresentation(egg, file, field)
		hl2dmSettingPresentation(egg, file, field)
		sonsSettingPresentation(egg, file, field)
		sonsGameplaySettingPresentation(egg, file, field)
		resoniteSessionSettingPresentation(egg, file, field)
		goldSrcCS16SettingPresentation(egg, file, field)
		fields = append(fields, field)
	}
	if file == "/server.properties" && nativeSettingsIsRecipe(egg, canvasSettingsRecipe) {
		result["help"] = append(asSlice(result["help"]), canvasDifficultyHelp())
	}
	if file == "/server.properties" && nativeSettingsIsRecipe(egg, paperDifficultyRecipe) {
		result["help"] = append(asSlice(result["help"]), paperDifficultyHelp())
	}
	result["fields"], result["revision"] = fields, campaignParserRevision(egg, file, data)
	writeJSON(w, 200, item("game_settings", result))
}

func gameSettingManaged(egg M, file, key string) bool {
	if nativeSettingsIsRecipe(egg, necesseSettingsRecipe) && file == necesseSettingsPath {
		return !necesseEditable(key)
	}
	if nativeSettingsIsRecipe(egg, nmrihSettingsRecipe) && file == nmrihSettingsPath {
		switch strings.ToLower(key) {
		case "hostname", "sv_password", "rcon_password", "sv_lan", "tv_enable", "tv_port":
			return true
		}
	}

	if among165Recipe(egg) != "" && campaignParserPathAllowed(egg, file) && file == "/impostor/config.json" && (key == "/Server/PublicIp" || key == "/Server/PublicPort") {
		return false
	}

	if nativeSettingsIsRecipe(egg, soldatClassicRecipe) && soldatSettingsDocument(egg, file) && soldatNativeManaged(file, key) {
		return true
	}
	if gameSettingsRecipeManaged(egg, file, key) {
		return true
	}
	fullKey := strings.TrimPrefix(key, "/")
	caseInsensitive := gameSettingsCaseInsensitiveINI(file, nil) || strings.EqualFold(path.Base(file), "PalWorldSettings.ini")
	equal := func(a, b string) bool { return a == b || caseInsensitive && strings.EqualFold(a, b) }
	if i := strings.LastIndex(key, "/"); i >= 0 {
		key = key[i+1:]
	}
	normalized := strings.ToLower(strings.NewReplacer("-", "", "_", "", ".", "", "/", "").Replace(key))
	if map[string]bool{"serverport": true, "rconport": true, "queryport": true, "restapiport": true, "publicport": true, "gameport": true, "serverip": true, "publicip": true, "bindaddress": true, "listenaddress": true}[normalized] {
		return true
	}
	if steamPalworldVariant(steamGameID(egg)) {
		for _, managed := range []string{"ServerName", "ServerDescription", "ServerPassword", "AdminPassword", "ServerPlayerMaxNum", "PublicIP", "PublicPort", "RCONEnabled", "RCONPort", "RESTAPIEnabled", "RESTAPIPort", "CrossplayPlatforms", "AllowConnectPlatform"} {
			if strings.EqualFold(managed, key) {
				return true
			}
		}
	}
	rule := asMap(asMap(egg["config_files"])[strings.TrimPrefix(file, "/")])
	find := asMap(rule["find"])
	for name, value := range find {
		if (equal(name, key) || equal(strings.ReplaceAll(fullKey, "/", "."), name)) && strings.Contains(str(value), "{{") {
			return true
		}
	}
	// Minecraft's allocated listener is supplied by Wings, not an independent port.
	return javaMinecraftEgg(egg) && (key == "server-port" || key == "server-ip")
}
func gameSettingsChanges(fields []gameSetting, changes M, egg M, file string) (map[string]string, error) {
	if file == valheimSettingsPath {
		return quickValidateSettings("valheim", changes)
	}
	if err := wave85NativeChanges(egg, file, changes); err != nil {
		return nil, err
	}
	allowed := map[string]gameSetting{}
	for _, f := range fields {
		allowed[f.key] = f
	}
	out := map[string]string{}
	for key, value := range changes {
		f, ok := allowed[key]
		if !ok || gameSettingManaged(egg, file, key) || f.kind == "readonly" {
			return nil, bad("This setting cannot be changed here.")
		}
		game := steamGameID(egg)
		if javaMinecraftEgg(egg) {
			game = "minecraft"
		}
		for _, spec := range quickFields(game) {
			if spec.Key == key {
				validate := true
				if spec.Type == "select" {
					validate = false
					for _, option := range spec.Options {
						if f.value == option {
							validate = true
						}
					}
				}
				if validate {
					if _, err := quickValidateSettings(game, M{key: value}); err != nil {
						return nil, err
					}
				}
				break
			}
		}
		if f.kind == "boolean" {
			v, ok := value.(bool)
			if !ok {
				return nil, bad("Choose enabled or disabled.")
			}
			if v {
				out[key] = f.on
			} else {
				out[key] = f.off
			}
			continue
		}
		v, ok := value.(string)
		if !ok || len(v) > 65536 || strings.ContainsRune(v, 0) {
			return nil, bad("Enter a valid setting value.")
		}
		if file == "/webadmin.ini" && strings.EqualFold(key, "User:admin/Password") && nativeSettingsIsRecipe(egg, "minecraft/java/cuberite/egg-cuberite.json") && (utf8.RuneCountInString(v) < 12 || !quickSingleLine(v)) {
			return nil, bad("Choose a WebAdmin password of at least 12 characters on one line.")
		}
		if f.kind == "number" {
			if n, e := strconv.ParseFloat(v, 64); e != nil || math.IsNaN(n) || math.IsInf(n, 0) {
				return nil, bad("Enter a valid number.")
			}
		}
		out[key] = v
	}
	return out, nil
}
func gameSettingType(key, value string) gameSetting {
	f := gameSetting{key: key, value: value, kind: "text"}
	switch value {
	case "true", "false":
		f.kind, f.on, f.off = "boolean", "true", "false"
	case "True", "False":
		f.kind, f.on, f.off = "boolean", "True", "False"
	case "TRUE", "FALSE":
		f.kind, f.on, f.off = "boolean", "TRUE", "FALSE"
	case "0", "1":
		if gameSettingBoolean.MatchString(key) {
			f.kind, f.on, f.off = "boolean", "1", "0"
		}
	}
	if f.kind == "text" && value != "" {
		if n, e := strconv.ParseFloat(value, 64); e == nil && !math.IsNaN(n) && !math.IsInf(n, 0) && (value == "0" || !strings.HasPrefix(value, "0") || strings.HasPrefix(value, "0.")) {
			f.kind = "number"
		}
	}
	if gameSettingSecret.MatchString(key) {
		f.kind = "text"
	}
	return f
}

func parseGameSettings(file string, data []byte) (gameSettingsParsed, error) {
	out := gameSettingsParsed{fields: []gameSetting{}}
	if file == valheimSettingsPath {
		values, e := valheimValues(data)
		if e != nil {
			return out, e
		}
		for key, value := range values {
			f := gameSettingType(key, value)
			if key != "public" {
				f.kind = "text"
			}
			out.fields = append(out.fields, f)
		}
		sort.Slice(out.fields, func(i, j int) bool { return out.fields[i].key < out.fields[j].key })
		out.patch = func(changes map[string]string) ([]byte, error) { return valheimPatch(data, changes) }
		return out, nil
	}
	if gameSettingsFormat(file) == "ini" && (strings.EqualFold(path.Base(file), "PalWorldSettings.ini") || strings.Contains(string(data), "[/Script/Pal.PalGameWorldSettings]")) {
		if err := validatePalworldSettingsIdentity(data); err != nil {
			return out, err
		}
		tuple, values, err := quickPalworldOptions(data)
		if err != nil {
			return out, err
		}
		quoted := map[string]bool{}
		complex := map[string]bool{}
		folded := map[string]bool{}
		for _, segment := range tuple.Segments {
			key, raw, _ := strings.Cut(strings.TrimSpace(segment), "=")
			key = strings.TrimSpace(key)
			if folded[gameSettingsINIFold(key)] {
				return out, bad("Duplicate structured settings cannot be edited here.")
			}
			folded[gameSettingsINIFold(key)] = true
			raw = strings.TrimSpace(raw)
			quoted[key] = strings.HasPrefix(raw, "\"")
			complex[key] = strings.HasPrefix(raw, "(")
		}
		for key, value := range values {
			f := gameSettingType(key, value)
			if quoted[key] {
				f.kind = "text"
			}
			if complex[key] {
				f.kind = "readonly"
				f.secret = true
			}
			out.fields = append(out.fields, f)
		}
		sort.Slice(out.fields, func(i, j int) bool { return out.fields[i].key < out.fields[j].key })
		out.patch = func(changes map[string]string) ([]byte, error) {
			encoded := map[string]string{}
			for key, value := range changes {
				if quoted[key] {
					encoded[key] = quickUnrealQuote(value)
				} else {
					if strings.ContainsAny(value, ",()\r\n\"") {
						return nil, bad("Enter a scalar value for this setting.")
					}
					encoded[key] = value
				}
			}
			return quickPatchPalworld(data, encoded)
		}
		return out, nil
	}
	switch gameSettingsFormat(file) {
	case "properties":
		records, e := quickPropertyRecords(data)
		if e != nil {
			return out, e
		}
		byKey := map[string]string{}
		for _, r := range records {
			if r.Key != "" {
				byKey[r.Key] = r.Value
			}
		}
		for key, value := range byKey {
			out.fields = append(out.fields, gameSettingType(key, value))
		}
		out.patch = func(changes map[string]string) ([]byte, error) {
			escaped := map[string]string{}
			for k, v := range changes {
				escaped[k] = quickPropertyEscape(v)
			}
			return quickPatchProperties(data, escaped)
		}
	case "yaml", "json":
		if gameSettingsFormat(file) == "json" && !json.Valid(data) {
			return out, bad("This JSON configuration is invalid.")
		}
		var originalJSON any
		if gameSettingsFormat(file) == "json" {
			decoder := json.NewDecoder(bytes.NewReader(data))
			decoder.UseNumber()
			if e := decoder.Decode(&originalJSON); e != nil {
				return out, e
			}
		}
		var root yaml.Node
		if e := yaml.Unmarshal(data, &root); e != nil {
			return out, bad("The game configuration could not be parsed.")
		}
		if len(root.Content) == 0 {
			return out, bad("This configuration is empty.")
		}
		nodes := map[string]*yaml.Node{}
		var walk func(*yaml.Node, string) error
		walk = func(n *yaml.Node, prefix string) error {
			switch n.Kind {
			case yaml.MappingNode:
				seen := map[string]bool{}
				for i := 0; i < len(n.Content); i += 2 {
					k := n.Content[i]
					if k.Kind != yaml.ScalarNode || seen[k.Value] || k.Value == "<<" {
						return bad("Ambiguous configuration keys cannot be edited here.")
					}
					seen[k.Value] = true
					key := prefix + "/" + strings.ReplaceAll(strings.ReplaceAll(k.Value, "~", "~0"), "/", "~1")
					if e := walk(n.Content[i+1], key); e != nil {
						return e
					}
				}
			case yaml.SequenceNode:
				var value any
				if gameSettingsFormat(file) == "json" {
					value = originalJSON
					if prefix != "" {
						for _, part := range strings.Split(strings.TrimPrefix(prefix, "/"), "/") {
							key := strings.ReplaceAll(strings.ReplaceAll(part, "~1", "/"), "~0", "~")
							value = value.(map[string]any)[key]
						}
					}
				} else if err := n.Decode(&value); err != nil {
					return bad("This list cannot be edited here.")
				}
				encoded, err := json.Marshal(value)
				if err != nil {
					return bad("This list cannot be edited here.")
				}
				field := gameSetting{key: prefix, value: string(encoded), kind: "list", node: n}
				if gameSettingsContainsSecret(value) {
					field.secret = true
					field.kind = "readonly"
				}
				out.fields = append(out.fields, field)
				nodes[prefix] = n
			case yaml.ScalarNode:
				f := gameSettingType(prefix, n.Value)
				f.node = n
				if n.Tag == "!!str" {
					f.kind = "text"
				}
				if n.Tag == "!!null" {
					f.kind = "text"
				}
				out.fields = append(out.fields, f)
				nodes[prefix] = n
			default:
				return bad("YAML aliases cannot be edited here.")
			}
			return nil
		}
		if e := walk(root.Content[0], ""); e != nil {
			return out, e
		}
		out.patch = func(changes map[string]string) ([]byte, error) {
			for key, value := range changes {
				n := nodes[key]
				if n.Kind == yaml.SequenceNode {
					var list []any
					if json.Unmarshal([]byte(value), &list) != nil || !strings.HasPrefix(strings.TrimSpace(value), "[") {
						return nil, bad("Enter a JSON list, such as [\"item\"].")
					}
					var replacement yaml.Node
					if err := yaml.Unmarshal([]byte(value), &replacement); err != nil {
						return nil, bad("Enter a valid list.")
					}
					fresh := replacement.Content[0]
					copyGameSettingsComments(n, fresh)
					*n = *fresh
					continue
				}
				switch n.Tag {
				case "!!int":
					if _, e := strconv.ParseInt(value, 10, 64); e != nil {
						return nil, bad("Enter a whole number.")
					}
				case "!!float":
					v, e := strconv.ParseFloat(value, 64)
					if e != nil || strings.Contains(strings.ToLower(value), "inf") || strings.Contains(strings.ToLower(value), "nan") || v != v {
						return nil, bad("Enter a finite number.")
					}
				case "!!null":
					n.Tag = "!!str"
				}
				n.Value = value
			}
			if gameSettingsFormat(file) == "json" {
				var value any
				decoder := json.NewDecoder(bytes.NewReader(data))
				decoder.UseNumber()
				if e := decoder.Decode(&value); e != nil {
					return nil, e
				}
				for key, changed := range changes {
					n := nodes[key]
					var next any
					switch n.Tag {
					case "!!int", "!!float":
						next = json.Number(n.Value)
					case "!!seq":
						decoder := json.NewDecoder(strings.NewReader(changed))
						decoder.UseNumber()
						if e := decoder.Decode(&next); e != nil {
							return nil, e
						}
					default:
						if e := n.Decode(&next); e != nil {
							return nil, e
						}
					}
					value = replaceGameSettingsJSON(value, key, next)
				}
				return json.MarshalIndent(value, "", "  ")
			}
			return yaml.Marshal(&root)
		}
	case "xml":
		records, _, e := quickXMLProperties(data, "ServerSettings")
		if e != nil {
			return out, e
		}
		for key, r := range records {
			out.fields = append(out.fields, gameSettingType(key, r.Value))
		}
		out.patch = func(changes map[string]string) ([]byte, error) {
			return quickPatchXMLProperties(data, "ServerSettings", changes)
		}
	case "ini":
		parsed, err := parseGameSettingsLines(file, data)
		if err != nil {
			return out, err
		}
		parsed = gameSettingsINICaseSafety(file, data, parsed)
		expanded, err := expandGameSettingsStructs(parsed)
		if err != nil {
			return out, err
		}
		return gameSettingsINICaseSafety(file, data, expanded), nil
	default:
		return out, bad("This configuration format does not have a settings editor yet.")
	}
	sort.Slice(out.fields, func(i, j int) bool { return out.fields[i].key < out.fields[j].key })
	if len(out.fields) > 4000 {
		return out, bad("This configuration has too many settings to edit here.")
	}
	return out, nil
}

// Keep untouched JSON numbers exact, including IDs beyond uint64 and decimals.
// Paths come from the validated mapping walk; sequences are edited whole.
func replaceGameSettingsJSON(root any, pointer string, value any) any {
	if pointer == "" {
		return value
	}
	parts := strings.Split(strings.TrimPrefix(pointer, "/"), "/")
	current := root
	for i, part := range parts {
		key := strings.ReplaceAll(strings.ReplaceAll(part, "~1", "/"), "~0", "~")
		object := current.(map[string]any)
		if i == len(parts)-1 {
			object[key] = value
		} else {
			current = object[key]
		}
	}
	return root
}

// INI/TOML scalar edits replace only the value span, keeping sections, comments,
// unknown syntax and newline style. Complex TOML values remain read-only.
func parseGameSettingsLines(file string, data []byte) (gameSettingsParsed, error) {
	out := gameSettingsParsed{fields: []gameSetting{}}
	lines := strings.SplitAfter(string(data), "\n")
	type span struct {
		line, start, end int
		quote            byte
		structured       bool
	}
	spans := map[string]span{}
	duplicates := map[string]bool{}
	section := ""
	toml := strings.EqualFold(path.Ext(file), ".toml")
	inArray := false
	for index, line := range lines {
		trim := strings.TrimSpace(line)
		if inArray {
			if strings.Contains(trim, "]") {
				inArray = false
			}
			continue
		}
		if trim == "" || strings.HasPrefix(trim, "#") || strings.HasPrefix(trim, ";") {
			continue
		}
		if strings.HasPrefix(trim, "[") {
			end := strings.Index(trim, "]")
			if end < 0 || strings.HasPrefix(trim, "[[") {
				return out, bad("This configuration uses unsupported table syntax.")
			}
			section = trim[1:end]
			continue
		}
		eq := strings.IndexByte(line, '=')
		if eq < 0 {
			continue
		}
		name := strings.TrimSpace(line[:eq])
		if name == "" {
			continue
		}
		key := name
		if section != "" {
			key = section + "/" + name
		}
		if _, ok := spans[key]; ok {
			if toml {
				return out, bad("Duplicate configuration keys cannot be edited here.")
			}
			// Unreal INI arrays may repeat a key. Preserve every source line and
			// keep ambiguous values out of the scalar editor.
			duplicates[key] = true
			for i := range out.fields {
				if out.fields[i].key == key {
					out.fields[i].kind = "readonly"
					out.fields[i].structured = false
					out.fields[i].value = "Multiple values; edit this setting in Files."
					break
				}
			}
			continue
		}
		start := eq + 1
		for start < len(line) && (line[start] == ' ' || line[start] == '\t') {
			start++
		}
		end := len(strings.TrimRight(line, "\r\n"))
		quote := byte(0)
		inQuote := byte(0)
		escaped := false
		for i := start; i < end; i++ {
			c := line[i]
			if inQuote != 0 {
				if c == inQuote && !escaped {
					inQuote = 0
				}
				escaped = c == '\\' && !escaped
				continue
			}
			if c == '"' || c == '\'' {
				inQuote = c
				continue
			}
			if c == '#' || (!toml && c == ';') {
				end = i
				break
			}
		}
		if inQuote != 0 {
			return out, bad("Multiline configuration values need the file editor.")
		}
		for end > start && (line[end-1] == ' ' || line[end-1] == '\t') {
			end--
		}
		value := line[start:end]
		if toml && strings.HasPrefix(value, "[") && !strings.Contains(value, "]") {
			inArray = true
		}
		f := gameSettingType(key, value)
		if len(value) >= 2 && (value[0] == '"' || value[0] == '\'') && value[len(value)-1] == value[0] {
			quote = value[0]
			if quote == '"' {
				decoded, e := strconv.Unquote(value)
				if e != nil {
					return out, bad("Invalid quoted configuration value.")
				}
				f.value = decoded
			} else {
				f.value = value[1 : len(value)-1]
			}
			f.kind = "text"
		} else if toml && f.kind == "text" {
			f.kind = "readonly"
		}
		f.structured = !toml && quote == 0 && strings.HasPrefix(value, "(") && strings.HasSuffix(value, ")")
		spans[key] = span{index, start, end, quote, f.structured}
		out.fields = append(out.fields, f)
		if len(out.fields) > 4000 {
			return out, bad("This configuration has too many settings to edit here.")
		}
	}
	out.patch = func(changes map[string]string) ([]byte, error) {
		updated := append([]string(nil), lines...)
		for key, value := range changes {
			if duplicates[key] {
				return nil, bad("Repeated configuration values must be edited in Files.")
			}
			s := spans[key]
			if !quickSingleLine(value) {
				return nil, bad("Use a single line for this setting.")
			}
			if s.quote == '"' {
				quoted, _ := json.Marshal(value)
				value = string(quoted)
			} else if s.quote == '\'' {
				if strings.Contains(value, "'") {
					return nil, bad("This literal value cannot contain a quote.")
				}
				value = "'" + value + "'"
			} else if !s.structured && strings.ContainsAny(value, "#;\r\n") {
				return nil, bad("This unquoted value cannot contain comment delimiters.")
			}
			line := updated[s.line]
			updated[s.line] = line[:s.start] + value + line[s.end:]
		}
		return []byte(strings.Join(updated, "")), nil
	}
	sort.Slice(out.fields, func(i, j int) bool { return out.fields[i].key < out.fields[j].key })
	return out, nil
}

// Folder discovery is independent of the editor response, so deep save trees
// cannot delay the first editable settings.
func (a *App) gameSettingsFolders(w http.ResponseWriter, r *http.Request) {
	s, err := a.server(r, "file.read")
	if err != nil {
		fail(w, err)
		return
	}
	ctx := context.WithValue(r.Context(), quickListingContextKey{}, map[string][]M{})
	egg, err := a.serverEffectiveEgg(ctx, s)
	if err != nil {
		fail(w, err)
		return
	}
	game := steamGameID(egg)
	values := map[string]string{}
	if javaMinecraftEgg(egg) {
		game = "minecraft"
		u, e := a.user(r)
		if e != nil {
			fail(w, e)
			return
		}
		if a.can(ctx, u, s, "file.read-content") {
			data, exists, e := a.quickSetupRead(ctx, s, "/server.properties")
			if e != nil {
				fail(w, e)
				return
			}
			if exists {
				records, e := quickPropertyRecords(data)
				if e != nil {
					fail(w, e)
					return
				}
				for _, record := range records {
					values[record.Key] = record.Value
				}
			}
		}
	}
	folders, err := a.quickSetupFolders(ctx, s, game, values)
	if err != nil {
		fail(w, err)
		return
	}
	for _, feature := range asSlice(egg["features"]) {
		if str(feature) == "voltra_fs25" {
			for _, folder := range []struct{ label, path string }{{"Game installer", "/installer"}, {"DLC installers", "/dlc"}, {"Mods", "/data/mods"}, {"Installed DLCs", "/data/pdlc"}, {"Saves and logs", "/data"}} {
				exists, e := a.quickSetupFolderExists(ctx, s, folder.path)
				if e != nil {
					fail(w, e)
					return
				}
				if exists {
					folders = append(folders, M{"label": folder.label, "path": folder.path})
				}
			}
		}
	}
	commonFolders := []string{"config", "saves", "worlds", "logs", "mods", "plugins"}
	if nativeSettingsIsRecipe(egg, soldatClassicRecipe) {
		commonFolders = append(commonFolders, "maps", "scripts", "textures", "scenery-gfx", "bots")
	}
	if nativeSettingsIsRecipe(egg, soldat2Recipe) {
		commonFolders = append(commonFolders, "Levels", "Rules", "Modifiers", "Cycles", "Scripts")
	}
	if nativeSettingsIsRecipe(egg, "beamng/kissmp/egg-kissmp.json") {
		commonFolders = append(commonFolders, "addons")
	}
	for _, folder := range commonFolders {
		exists, e := a.quickSetupFolderExists(ctx, s, "/"+folder)
		if e != nil {
			fail(w, e)
			return
		}
		if exists {
			found := false
			for _, old := range folders {
				if old["path"] == "/"+folder {
					found = true
				}
			}
			if !found {
				folders = append(folders, M{"label": folder, "path": "/" + folder})
			}
		}
	}
	writeJSON(w, 200, item("game_settings_folders", M{"folders": folders}))
}
