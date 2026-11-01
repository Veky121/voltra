package panel

import (
	"context"
	"encoding/json"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"
)

const assettoVanillaRecipe = "assetto_corsa/egg-assetto-corsa.json"
const assettoAIRecipe = "assetto_corsa/egg-assetto-corsa--freeroam--a-i.json"

func assettoSettingsRecipe(egg M) bool {
	return nativeSettingsIsRecipe(egg, assettoVanillaRecipe) || nativeSettingsIsRecipe(egg, assettoAIRecipe)
}
func (a *App) prepareAssettoSettings(ctx context.Context, s, egg M) error {
	entry, ok := gameSettingsProfile(egg)
	if !ok || str(s["startup"]) != str(entry.Egg["startup"]) || str(egg["startup"]) != str(entry.Egg["startup"]) || len(asMap(egg["config_files"])) != 0 {
		return notFound()
	}
	config, e := a.serverConfig(ctx, s)
	if e != nil {
		return e
	}
	env := asMap(config["environment"])
	for _, k := range []string{"PYTHONPATH", "LD_PRELOAD", "EXTRA_ARGS", "ADDITIONAL_ARGS"} {
		if str(env[k]) != "" {
			return notFound()
		}
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
	}
	if len(files) == 0 {
		return notFound()
	}
	binding, _ := json.Marshal([]any{entry.Path, s["startup"], env, files, "/cfg/server_cfg.ini"})
	egg["_campaign_parser_path"] = "/cfg/server_cfg.ini"
	egg["_campaign_parser_binding"] = settingsAuthorityHash(binding)
	return nil
}

var assettoComponent = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)

// Only existing SERVER scalars with explicit emitted-helper validation are exposed.
// Semicolons belong to CARS. Full-line comments and every unrelated byte survive.
func parseAssettoSettings(egg M, data []byte) (gameSettingsParsed, error) {
	out := gameSettingsParsed{}
	if !utf8.Valid(data) || strings.ContainsRune(string(data), 0) {
		return out, bad("Invalid Assetto INI")
	}
	lines := strings.Split(string(data), "\n")
	indexes := map[string]int{}
	starts := map[string]int{}
	ends := map[string]int{}
	seen := map[string]bool{}
	active := false
	sections := map[string]bool{}
	ai := nativeSettingsIsRecipe(egg, assettoAIRecipe)
	valid := func(k, v string) bool {
		if !utf8.ValidString(v) || strings.ContainsAny(v, "\"\\#") || strings.IndexFunc(v, func(r rune) bool { return r < 32 || r == 127 }) >= 0 {
			return false
		}
		switch k {
		case "CARS":
			for _, c := range strings.Split(v, ";") {
				if !assettoComponent.MatchString(strings.TrimSpace(c)) {
					return false
				}
			}
			return v != ""
		case "TRACK":
			return assettoComponent.MatchString(v)
		case "CONFIG_TRACK":
			return v == "" || assettoComponent.MatchString(v)
		case "REGISTER_TO_LOBBY":
			return v == "0" || v == "1"
		case "MAX_CLIENTS":
			n, e := strconv.Atoi(v)
			return ai && e == nil && n >= 2 && n <= 25
		case "NAME", "PASSWORD", "ADMIN_PASSWORD":
			limit := 40
			if k == "NAME" && !ai {
				limit = 45
			}
			if k != "NAME" && ai {
				limit = 64
			}
			return !strings.Contains(v, ";") && utf8.RuneCountInString(v) <= limit && (k != "ADMIN_PASSWORD" || utf8.RuneCountInString(v) >= 8)
		}
		return false
	}
	for i, line := range lines {
		t := strings.TrimSpace(strings.TrimPrefix(line, "\ufeff"))
		if t == "" || strings.HasPrefix(t, ";") || strings.HasPrefix(t, "#") {
			continue
		}
		if strings.HasPrefix(t, "[") {
			end := strings.Index(t, "]")
			if end < 0 {
				return out, bad("Malformed Assetto section")
			}
			section := strings.ToUpper(t[1:end])
			if sections[section] {
				return out, bad("Duplicate Assetto section")
			}
			sections[section] = true
			active = section == "SERVER"
			if active && t[1:end] != "SERVER" {
				return out, bad("Noncanonical Assetto section")
			}
			continue
		}
		if !active {
			continue
		}
		eq := strings.Index(line, "=")
		if eq < 0 {
			return out, bad("Malformed Assetto scalar")
		}
		original := strings.TrimSpace(line[:eq])
		k := strings.ToUpper(original)
		if seen[k] {
			return out, bad("Ambiguous Assetto alias")
		}
		seen[k] = true
		// The AI parser requires exact SERVER spelling and case-insensitive options;
		// requiring canonical key spelling avoids differing vanilla writer aliases.
		v := strings.TrimSpace(line[eq+1:])
		if k == "UDP_PORT" || k == "TCP_PORT" || k == "HTTP_PORT" {
			out.fields = append(out.fields, gameSetting{key: "SERVER/" + k, value: v, kind: "readonly"})
			continue
		}
		if !valid(k, v) {
			continue
		}
		if original != k {
			return out, bad("Noncanonical Assetto key")
		}
		start := eq + 1
		for start < len(line) && (line[start] == ' ' || line[start] == '\t') {
			start++
		}
		end := len(strings.TrimRight(line, " \t\r"))
		if end < start {
			end = start
		}
		indexes[k] = i
		starts[k] = start
		ends[k] = end
		kind := "text"
		if k == "MAX_CLIENTS" {
			kind = "number"
		}
		out.fields = append(out.fields, gameSetting{key: "SERVER/" + k, value: v, kind: kind, secret: strings.Contains(k, "PASSWORD")})
	}
	out.patch = func(changes map[string]string) ([]byte, error) {
		next := append([]string(nil), lines...)
		for key, v := range changes {
			k := strings.TrimPrefix(key, "SERVER/")
			i, ok := indexes[k]
			if !ok || key != "SERVER/"+k || !valid(k, v) {
				return nil, bad("Invalid reviewed Assetto setting")
			}
			next[i] = lines[i][:starts[k]] + v + lines[i][ends[k]:]
		}
		return []byte(strings.Join(next, "\n")), nil
	}
	return out, nil
}
