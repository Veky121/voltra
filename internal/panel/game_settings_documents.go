package panel

import (
	"context"
	"encoding/json"
	"math"
	"net/http"
	"path"
	"regexp"
	"sort"
	"strconv"
	"strings"

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
}
type gameSettingsParsed struct {
	fields []gameSetting
	patch  func(map[string]string) ([]byte, error)
}

var gameSettingSecret = regexp.MustCompile(`(?i)password|passwd|passphrase|secret|token|api.?key|auth.?key|license.?key|private.?key|credential`)
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
	entries, err := a.quickSetupListExisting(ctx, s, "/")
	if err != nil {
		return nil, nil, err
	}
	docs := []gameSettingsDocument{}
	seen := map[string]bool{}
	add := func(file string) {
		file = "/" + strings.TrimPrefix(file, "/")
		if _, e := quickPathParts(file); e != nil || seen[file] || gameSettingsFormat(file) == "" {
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
	candidates := []string{}
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
	if game == "satisfactory" {
		candidates = append(candidates, "/FactoryGame/Saved/Config/LinuxServer/Game.ini", "/FactoryGame/Saved/Config/LinuxServer/Engine.ini")
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
		return docs[i].Path < docs[j].Path
	})
	folders := []M{}
	for _, e := range entries {
		name := str(e["name"])
		if quickDirectoryEntry(e) && quickSafeDirectory(name) && (worldFolders[name] || map[string]bool{"config": true, "mods": true, "plugins": true, "resourcepacks": true, "saves": true, "worlds": true, "world": true}[strings.ToLower(name)]) {
			folders = append(folders, M{"label": name, "path": "/" + name})
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
		// Discovery's cache is never used to validate a write.
		fresh := r.Context()
		if e = a.quickSetupStopped(fresh, s); e != nil {
			fail(w, e)
			return
		}
		data, e := read(fresh)
		if e != nil {
			fail(w, e)
			return
		}
		if str(in["revision"]) != quickRevision("native", file, data, true) {
			fail(w, APIError{409, "QuickSetupRevisionConflict", "These settings changed. Reload before saving."})
			return
		}
		parsed, e := parseGameSettings(file, data)
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
		// Validate the resulting document before writing anything.
		if _, e = parseGameSettings(file, updated); e != nil {
			fail(w, e)
			return
		}
		if e = a.quickSetupStopped(fresh, s); e != nil {
			fail(w, e)
			return
		}
		if e = a.quickSetupWrite(fresh, s, file, updated); e != nil {
			fail(w, e)
			return
		}
		if e = tx.Commit(ctx); e != nil {
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
	parsed, err := parseGameSettings(file, data)
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
		secret := gameSettingSecret.MatchString(f.key)
		field := M{"key": f.key, "label": f.key, "type": kind, "value": value, "secret": secret, "readonly": gameSettingManaged(egg, file, f.key)}
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
		fields = append(fields, field)
	}
	result["fields"], result["revision"] = fields, quickRevision("native", file, data, true)
	writeJSON(w, 200, item("game_settings", result))
}

func gameSettingManaged(egg M, file, key string) bool {
	normalized := strings.ToLower(strings.NewReplacer("-", "", "_", "", ".", "", "/", "").Replace(key))
	if map[string]bool{"serverport": true, "rconport": true, "queryport": true, "restapiport": true, "publicport": true, "gameport": true, "serverip": true, "publicip": true, "bindaddress": true, "listenaddress": true}[normalized] {
		return true
	}
	if steamPalworldVariant(steamGameID(egg)) {
		if map[string]bool{"ServerName": true, "ServerDescription": true, "ServerPassword": true, "AdminPassword": true, "ServerPlayerMaxNum": true, "PublicIP": true, "PublicPort": true, "RCONEnabled": true, "RCONPort": true, "RESTAPIEnabled": true, "RESTAPIPort": true, "CrossplayPlatforms": true, "AllowConnectPlatform": true}[key] {
			return true
		}
	}
	rule := asMap(asMap(egg["config_files"])[strings.TrimPrefix(file, "/")])
	find := asMap(rule["find"])
	for name, value := range find {
		if (name == key || strings.ReplaceAll(strings.TrimPrefix(key, "/"), "/", ".") == name) && strings.Contains(str(value), "{{") {
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
		if n, e := strconv.ParseFloat(value, 64); e == nil && !math.IsNaN(n) && !math.IsInf(n, 0) && !strings.HasPrefix(value, "0") {
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
	if path.Base(file) == "PalWorldSettings.ini" {
		tuple, values, err := quickPalworldOptions(data)
		if err != nil {
			return out, err
		}
		quoted := map[string]bool{}
		complex := map[string]bool{}
		for _, segment := range tuple.Segments {
			key, raw, _ := strings.Cut(strings.TrimSpace(segment), "=")
			key = strings.TrimSpace(key)
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
				if err := n.Decode(&value); err != nil {
					return bad("This list cannot be edited here.")
				}
				encoded, err := json.Marshal(value)
				if err != nil {
					return bad("This list cannot be edited here.")
				}
				out.fields = append(out.fields, gameSetting{key: prefix, value: string(encoded), kind: "list", node: n})
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
				if e := root.Decode(&value); e != nil {
					return nil, e
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
		return parseGameSettingsLines(file, data)
	default:
		return out, bad("This configuration format does not have a settings editor yet.")
	}
	sort.Slice(out.fields, func(i, j int) bool { return out.fields[i].key < out.fields[j].key })
	if len(out.fields) > 4000 {
		return out, bad("This configuration has too many settings to edit here.")
	}
	return out, nil
}

// INI/TOML scalar edits replace only the value span, keeping sections, comments,
// unknown syntax and newline style. Complex TOML values remain read-only.
func parseGameSettingsLines(file string, data []byte) (gameSettingsParsed, error) {
	out := gameSettingsParsed{fields: []gameSetting{}}
	lines := strings.SplitAfter(string(data), "\n")
	type span struct {
		line, start, end int
		quote            byte
	}
	spans := map[string]span{}
	section := ""
	toml := strings.HasSuffix(file, ".toml")
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
			return out, bad("Duplicate configuration keys cannot be edited here.")
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
		spans[key] = span{index, start, end, quote}
		out.fields = append(out.fields, f)
		if len(out.fields) > 4000 {
			return out, bad("This configuration has too many settings to edit here.")
		}
	}
	out.patch = func(changes map[string]string) ([]byte, error) {
		updated := append([]string(nil), lines...)
		for key, value := range changes {
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
			} else if strings.ContainsAny(value, "#;\r\n") {
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
	for _, folder := range []string{"config", "saves", "worlds", "logs", "mods", "plugins"} {
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
