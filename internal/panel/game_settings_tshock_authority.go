package panel

import (
	"context"
	"encoding/json"
	"reflect"
	"strings"
)

const tshockAuthorityRecipe = "terraria/tshock/egg-tshock.json"
const tshockLegacyAuthorityRecipe = "terraria/tshock/egg-tshock-legacy.json"

func tshockAuthorityDocument(file string) bool {
	return file == "/serverconfig.txt" || file == "/tshock/config.json"
}
func tshockCurrentAuthority(startup, eggStartup, canonical string, mappings, expected any, env map[string]string) error {
	if startup != canonical || eggStartup != canonical || canonical == "" {
		return notFound()
	}
	a, _ := json.Marshal(mappings)
	b, _ := json.Marshal(expected)
	var x, y any
	if json.Unmarshal(a, &x) != nil || json.Unmarshal(b, &y) != nil || !reflect.DeepEqual(x, y) {
		return notFound()
	}
	for k, v := range env {
		if v != "" && (strings.HasPrefix(k, "PYTHON") || strings.HasPrefix(k, "LD_") || k == "BASH_ENV" || k == "ENV") {
			return notFound()
		}
	}
	if v := env["VOLTRA_SERVER_ROOT"]; v != "" && v != "/home/container" {
		return notFound()
	}
	return nil
}
func (a *App) prepareTShockAuthority(ctx context.Context, s, egg M) error {
	entry, ok := gameSettingsProfile(egg)
	if !ok {
		return notFound()
	}
	canonical, _, e := parseEggDocument(entry.Egg)
	if e != nil {
		return e
	}
	config, e := a.serverConfig(ctx, s)
	if e != nil {
		return e
	}
	env := map[string]string{}
	for k, v := range asMap(config["environment"]) {
		env[k] = str(v)
	}
	if e = tshockCurrentAuthority(str(s["startup"]), str(egg["startup"]), str(entry.Egg["startup"]), egg["config_files"], canonical["config_files"], env); e != nil {
		return e
	}
	files := map[string][]byte{}
	// Legacy executes Mono directly. Its installer modules do not run on boot.
	if entry.Path == tshockAuthorityRecipe {
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
			data, exists, err := a.quickSetupRead(ctx, s, "/"+name)
			if err != nil {
				return err
			}
			if !exists || string(data) != expected+"\n" {
				return notFound()
			}
			files[name] = data
		}
		if len(files) == 0 {
			return notFound()
		}
	}
	binding, _ := json.Marshal([]any{s["startup"], env, files, egg["config_files"]})
	egg["_campaign_parser_path"] = "/serverconfig.txt"
	egg["_campaign_parser_binding"] = settingsAuthorityHash(binding)
	return nil
}
