package panel

import (
	"context"
	"encoding/json"
	"strconv"
	"strings"
)

const archeanRepairRecipe = "Archean/egg-archean.json"
const archeanRepairPath = "/Archean-data/server/server.ini"

// Caller must route the exact Archean recipe here on read and final freshness.
func (a *App) prepareArcheanRepairAuthority(ctx context.Context, s, egg M) error {
	mapping, e := json.Marshal(egg["config_files"])
	var mappings map[string]json.RawMessage
	if e != nil || json.Unmarshal(mapping, &mappings) != nil || mappings == nil || len(mappings) != 0 {
		return notFound()
	}
	entry, ok := gameSettingsProfile(egg)
	if !ok || str(s["startup"]) != str(entry.Egg["startup"]) || str(egg["startup"]) != str(entry.Egg["startup"]) || len(asMap(egg["config_files"])) != 0 {
		return notFound()
	}
	config, err := a.serverConfig(ctx, s)
	if err != nil {
		return err
	}
	env := asMap(config["environment"])
	if str(env["PYTHONHOME"]) != "" && str(env["PYTHONHOME"]) != "/home/container/.voltra/python" {
		return notFound()
	}
	if str(env["LD_LIBRARY_PATH"]) != "" && str(env["LD_LIBRARY_PATH"]) != "/home/container/.voltra/python/lib" {
		return notFound()
	}
	if str(env["VOLTRA_SERVER_ROOT"]) != "" && str(env["VOLTRA_SERVER_ROOT"]) != "/home/container" {
		return notFound()
	}
	if num(asMap(asMap(config["allocations"])["default"])["port"]) != num(env["SERVER_PORT"]) {
		return notFound()
	}
	port, e := strconv.Atoi(str(env["SERVER_PORT"]))
	if e != nil || port < 1 || port > 65535 {
		return notFound()
	}

	for _, key := range []string{"PYTHONPATH", "LD_PRELOAD", "EXTRA_ARGS", "ADDITIONAL_ARGS", "OTHER_ARGS", "SERVER_ARGS", "STARTUP_ARGS"} {
		if str(env[key]) != "" {
			return notFound()
		}
	}
	script := str(asMap(asMap(entry.Egg["scripts"])["installation"])["script"])
	files := map[string][]byte{}
	count := 0
	for _, chunk := range strings.Split(script, "cat > ")[1:] {
		head, body, ok := strings.Cut(chunk, "\n")
		if !ok {
			return notFound()
		}
		name, marker, ok := strings.Cut(head, " <<'")
		if !ok || !strings.HasPrefix(name, ".voltra/") {
			return notFound()
		}
		expected, _, ok := strings.Cut(body, "\n"+strings.TrimSuffix(marker, "'")+"\n")
		if !ok {
			return notFound()
		}
		data, exists, e := a.quickSetupRead(ctx, s, "/"+name)
		if e != nil {
			return e
		}
		if !exists || string(data) != expected+"\n" {
			return notFound()
		}
		files[name] = data
		count++
	}
	if count == 0 {
		return notFound()
	}
	binding, _ := json.Marshal([]any{entry.Path, s["startup"], env, files, archeanRepairPath, config["allocations"], s["allocation_id"]})
	egg["_campaign_parser_path"] = archeanRepairPath
	egg["_campaign_parser_binding"] = settingsAuthorityHash(binding)
	return nil
}

// Adapter contract bounds, not a new publisher grammar. Unknown fields remain in Files.
func parseArcheanRepairSettings(file string, data []byte) (gameSettingsParsed, error) {
	if file != archeanRepairPath || strings.HasPrefix(string(data), "\ufeff") {
		return gameSettingsParsed{}, notFound()
	}
	parsed, err := parseGameSettingsLines(file, data)
	if err != nil {
		return parsed, err
	}
	known := map[string]string{
		"server/server_public_name": "text", "server/password": "text", "server/game_mode": "bit", "server/server_online": "yesno", "server/accept_remote_connections": "yesno", "server/max_simultaneous_players": "positive", "game/spawn": "spawn", "game/world": "world", "game/auto_save_interval_seconds": "nonnegative", "game/updates_per_second": "positive", "game/physics_steps_per_update": "positive", "networking/listen_port": "port",
	}
	validate := func(key, value string) error {
		kind := known[key]
		if kind == "" {
			return bad("Use Files for undocumented Archean settings.")
		}
		if !quickSingleLine(value) || strings.ContainsAny(value, ";#\"'") {
			return bad("Unsupported Archean scalar syntax. Use Files.")
		}
		switch kind {
		case "bit":
			if value != "0" && value != "1" {
				return bad("Expected 0 or 1.")
			}
		case "yesno":
			if value != "yes" && value != "no" {
				return bad("Expected yes or no.")
			}
		case "spawn":
			if value != "earth" && value != "moon" {
				return bad("Expected earth or moon.")
			}
		case "world":
			if len(value) > 100 || value == "." || value == ".." || strings.ContainsAny(value, "/\\:") {
				return bad("Expected a world name.")
			}
		case "text":
			if len([]rune(value)) > 255 {
				return bad("Value too long.")
			}
		default:
			n, e := strconv.ParseUint(value, 10, 31)
			if e != nil || value == "" || strings.Trim(value, "0123456789") != "" || ((kind == "positive" || kind == "port") && n < 1) || (kind == "port" && n > 65535) {
				return bad("Invalid Archean integer.")
			}
		}
		return nil
	}
	seen := map[string]bool{}
	for i := range parsed.fields {
		f := &parsed.fields[i]
		folded := strings.ToLower(f.key)
		if known[folded] != "" && (folded != f.key || seen[folded] || f.kind == "readonly") {
			return parsed, bad("Ambiguous Archean setting.")
		}
		seen[folded] = true
		if known[f.key] == "" {
			f.kind = "readonly"
			continue
		}
		if err = validate(f.key, f.value); err != nil {
			return parsed, err
		}
		f.kind = "text"
		if f.key == "networking/listen_port" {
			f.kind = "readonly"
		}
	}
	patch := parsed.patch
	parsed.patch = func(changes map[string]string) ([]byte, error) {
		for key, value := range changes {
			if !seen[key] {
				return nil, bad("Unknown setting.")
			}
			if e := validate(key, value); e != nil {
				return nil, e
			}
			if key == "networking/listen_port" {
				return nil, bad("Allocation managed.")
			}
		}
		return patch(changes)
	}
	return parsed, nil
}
