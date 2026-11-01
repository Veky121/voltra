package panel

import (
	"context"
	"encoding/json"
	"strings"
)

func beamngSettingsRecipe(egg M) string {
	for _, recipe := range []string{"beamng/beammp/egg-beam-m-p-server.json", "beamng/kissmp/egg-kissmp.json"} {
		if nativeSettingsIsRecipe(egg, recipe) {
			return recipe
		}
	}
	return ""
}

// Source adapter admission only. Exact helper bytes do not attest game binaries.
// Called by shared discovery, locked refresh and final publication refresh.
func (a *App) prepareBeamngSettingsAuthority(ctx context.Context, s, egg M) error {
	recipe := beamngSettingsRecipe(egg)
	entry, ok := gameSettingsProfile(egg)
	if !ok || recipe == "" {
		return notFound()
	}
	startup := str(entry.Egg["startup"])
	if str(s["startup"]) != startup || str(egg["startup"]) != startup {
		return notFound()
	}
	expectedMapping, _ := json.Marshal(entry.Egg["config_files"])
	actualMapping, _ := json.Marshal(egg["config_files"])
	// Import represents no mappings as {}, while template metadata can use null.
	// Both leave the native file in control. Nonempty mappings remain exact.
	emptyMapping := func(data []byte) bool { return string(data) == "null" || string(data) == "{}" }
	if string(expectedMapping) != string(actualMapping) && !(emptyMapping(expectedMapping) && emptyMapping(actualMapping)) {
		return notFound()
	}
	config, err := a.serverConfig(ctx, s)
	if err != nil {
		return err
	}
	env := asMap(config["environment"])
	for _, key := range []string{"PYTHONPATH", "PYTHONHOME", "LD_PRELOAD", "LD_LIBRARY_PATH", "EXTRA_ARGS", "ADDITIONAL_ARGS", "SERVER_ARGS", "STARTUP_ARGS", "OTHER_ARGS", "VOLTRA_SERVER_ROOT"} {
		if str(env[key]) != "" {
			return notFound()
		}
	}
	if strings.Contains(recipe, "beammp") && str(env["VERSION"]) != "" && str(env["VERSION"]) != "v3.9.3" {
		return notFound()
	}
	files := map[string][]byte{}
	script := str(asMap(asMap(entry.Egg["scripts"])["installation"])["script"])
	for _, chunk := range strings.Split(script, "cat > ")[1:] {
		head, body, ok := strings.Cut(chunk, "\n")
		if !ok {
			continue
		}
		name, marker, ok := strings.Cut(head, " <<'")
		if !ok || !strings.HasPrefix(name, ".voltra/") {
			continue
		}
		marker = strings.TrimSuffix(marker, "'")
		expected, _, ok := strings.Cut(body, "\n"+marker+"\n")
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
	}
	if len(files) == 0 {
		return notFound()
	}
	allocations, err := a.query(ctx, "SELECT id,port FROM allocations WHERE server_id=$1 ORDER BY id", s["id"])
	if err != nil {
		return err
	}
	path := "/config.json"
	if strings.Contains(recipe, "beammp") {
		path = "/ServerConfig.toml"
	}
	binding, _ := json.Marshal(M{"startup": startup, "environment": env, "helpers": files, "path": path, "allocations": allocations, "primary": s["allocation_id"], "mapping": egg["config_files"]})
	if recipe == "beamng/beammp/egg-beam-m-p-server.json" {
		egg["_beammp_effective_environment"] = env
	}
	egg["_campaign_parser_path"] = path
	egg["_campaign_parser_binding"] = settingsAuthorityHash(binding)
	return nil
}
