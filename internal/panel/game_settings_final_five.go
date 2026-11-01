package panel

import (
	"context"
	"encoding/json"
	"strconv"
	"strings"
)

func finalFiveRecipe(recipe string) bool {
	switch recipe {
	case "gta/openmp/egg-open-m-p.json", "gta/mtasa/egg-multi-theft-auto.json", "rimworld/open_world/egg-rimworld-open-world.json", "rimworld/together/egg-rimworld-together.json", kspLMPRecipe:
		return true
	}
	return false
}
func finalLMPDocuments() []string {
	out := []string{}
	for _, name := range []string{"General", "MasterServer", "Website", "Connection", "Gameplay", "Warp", "Log", "Screenshot", "Interval"} {
		out = append(out, "/LMPServer/Config/"+name+"Settings.xml")
	}
	return out
}

// files contains exact canonical emitted bytes already checked through bounded
// Wings parent and regular-file reads. This does not attest native consumption.
func (a *App) prepareFinalFiveSettings(ctx context.Context, s, egg M, recipe string, env map[string]string, files map[string][]byte, config M, mappings []byte) (settingsPathAuthority, error) {
	refuse := func() (settingsPathAuthority, error) { return settingsPathAuthority{}, notFound() }
	if root := env["VOLTRA_SERVER_ROOT"]; root != "" && root != "/home/container" {
		return refuse()
	}
	for _, key := range []string{"OTHER_ARGS", "SERVER_ARGS", "STARTUP_ARGS", "BASH_ENV", "ENV"} {
		if env[key] != "" {
			return refuse()
		}
	}
	rows, err := a.query(ctx, "SELECT port FROM allocations WHERE server_id=$1", s["id"])
	if err != nil {
		return settingsPathAuthority{}, err
	}
	ports := map[int64]bool{}
	values := []string{}
	for _, row := range rows {
		p := num(row["port"])
		ports[p] = true
		values = append(values, strconv.FormatInt(p, 10))
	}
	primary := num(asMap(asMap(config["allocations"])["default"])["port"])
	if primary < 1 || primary > 65535 || !ports[primary] {
		return refuse()
	}
	env["SERVER_PORT"] = strconv.FormatInt(primary, 10)
	env["VOLTRA_ALLOCATED_PORTS"] = strings.Join(values, ",")
	file := "/Data/Config.json"
	switch recipe {
	case "gta/openmp/egg-open-m-p.json":
		file = "/openmp/config.json"
	case "gta/mtasa/egg-multi-theft-auto.json":
		file = "/mtasa/mods/deathmatch/mtaserver.conf"
	case "rimworld/together/egg-rimworld-together.json":
		file = "/Configs/ServerConfig.json"
	case kspLMPRecipe:
		file = finalLMPDocuments()[0]
	}
	read := func(file string) ([]byte, error) {
		data, exists, e := a.quickSetupRead(ctx, s, file)
		if e != nil {
			return nil, e
		}
		if !exists {
			return nil, notFound()
		}
		files[strings.TrimPrefix(file, "/")] = data
		return data, nil
	}
	raw, e := read(file)
	if e != nil {
		return settingsPathAuthority{}, e
	}
	if strings.HasPrefix(recipe, "gta/") {
		return ResolveGTANativeAuthority(recipe, mappings, settingsAuthorityInput{Startup: str(s["startup"]), Env: env, Files: files})
	}
	if recipe == kspLMPRecipe {
		if str(s["startup"]) != kspLMPStartup {
			return refuse()
		}
		for _, key := range []string{"MaxPlayers", "GameDifficulty", "GameMode"} {
			if env[key] != "" && env[strings.ToUpper(key)] != "" && env[key] != env[strings.ToUpper(key)] {
				return refuse()
			}
		}
		status := primary
		if env["STATUS_PORT"] != "" {
			status, e = strconv.ParseInt(env["STATUS_PORT"], 10, 32)
			if e != nil || !ports[status] {
				return refuse()
			}
		}
		for _, name := range []string{"Connection", "Website"} {
			data, e := read("/LMPServer/Config/" + name + "Settings.xml")
			if e != nil {
				return settingsPathAuthority{}, e
			}
			parsed, e := parseKspLMPSettings("/LMPServer/Config/"+name+"Settings.xml", data)
			if e != nil {
				return refuse()
			}
			required := map[string]string{"ListenAddress": "0.0.0.0", "Port": strconv.FormatInt(primary, 10)}
			if name == "Website" {
				required["Port"] = strconv.FormatInt(status, 10)
			} else {
				required["Upnp"] = "false"
			}
			for _, f := range parsed.fields {
				deleteIfMatching(required, f.key, f.value)
			}
			if len(required) != 0 {
				return refuse()
			}
		}
		if _, e := parseKspLMPSettings(file, raw); e != nil {
			return refuse()
		}
	} else {
		game := rimworldDialect(recipe, file)
		if str(s["startup"]) != rimworldStartupPrefix+game {
			return refuse()
		}
		if _, e := parseRimworldSettings(recipe, file, raw); e != nil {
			return refuse()
		}
		var native map[string]json.RawMessage
		if json.Unmarshal(raw, &native) != nil {
			return refuse()
		}
		ip, port := "LocalAddress", "ServerPort"
		if game == "together" {
			ip, port = "IP", "Port"
		}
		var bind string
		var p int64
		if json.Unmarshal(native[ip], &bind) != nil || bind != "0.0.0.0" || json.Unmarshal(native[port], &p) != nil || p != primary {
			return refuse()
		}
	}
	return settingsAuthorityResult(file, str(s["startup"])), nil
}
func deleteIfMatching(required map[string]string, key, value string) {
	if v, ok := required[strings.TrimPrefix(key, "/")]; ok && v == value {
		delete(required, strings.TrimPrefix(key, "/"))
	}
}
