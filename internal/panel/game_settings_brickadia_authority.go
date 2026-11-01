package panel

import (
	"context"
	"encoding/json"
	"strconv"
	"strings"
	"unicode/utf8"
)

// Source adapter admission only. This cannot attest interpreter or native consumption.
func (a *App) prepareBrickadiaAuthority(ctx context.Context, s, egg M) error {
	entry, _ := gameSettingsProfile(egg)
	if str(s["startup"]) != str(entry.Egg["startup"]) || str(egg["startup"]) != str(entry.Egg["startup"]) || len(asMap(egg["config_files"])) != 0 {
		return notFound()
	}
	config, err := a.serverConfig(ctx, s)
	if err != nil {
		return err
	}
	env := asMap(config["environment"])
	for _, k := range []string{"PYTHONPATH", "PYTHONHOME", "LD_PRELOAD", "LD_LIBRARY_PATH", "VOLTRA_SERVER_ROOT", "XDG_CONFIG_HOME"} {
		if str(env[k]) != "" {
			return notFound()
		}
	}
	script := str(asMap(asMap(entry.Egg["scripts"])["installation"])["script"])
	files := map[string]string{}
	count := 0
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
		count++
		files["/"+name] = string(data)
	}
	if count != 7 {
		return notFound()
	}
	port := int(num(asMap(asMap(config["allocations"])["default"])["port"]))
	if str(env["SERVER_PORT"]) != "" && str(env["SERVER_PORT"]) != strconv.Itoa(port) {
		return notFound()
	}
	if port < 1 || port > 65535 {
		return notFound()
	}
	allocated := false
	for _, v := range strings.Split(str(env["VOLTRA_ALLOCATED_PORTS"]), ",") {
		if v == strconv.Itoa(port) {
			allocated = true
		}
	}
	if !allocated {
		return notFound()
	}
	binding, err := json.Marshal([]any{entry.Path, s["startup"], egg["startup"], env, files, brickadiaPath, config["allocations"], s["allocation_id"], egg["config_files"]})
	if err != nil {
		return err
	}
	egg["_campaign_parser_path"] = brickadiaPath
	egg["_campaign_parser_binding"] = settingsAuthorityHash(binding)
	return nil
}

const brickadiaPath = "/.config/Epic/Brickadia/Saved/Config/LinuxServer/GameUserSettings.ini"
const brickadiaSection = "Server__BP_ServerSettings_General_C BP_ServerSettings_General_C/"

func parseBrickadia(file string, data []byte) (gameSettingsParsed, error) {
	if file != brickadiaPath {
		return gameSettingsParsed{}, notFound()
	}
	p, e := parseGameSettings(file, data)
	if e != nil {
		return p, e
	}
	allowed := map[string]bool{}
	for i := range p.fields {
		f := &p.fields[i]
		switch f.key {
		case brickadiaSection + "ServerName", brickadiaSection + "ServerPassword", brickadiaSection + "bPubliclyListed":
			if f.kind != "readonly" {
				allowed[f.key] = true
			}
			if e = brickadiaValue(f.key, f.value); e != nil {
				return p, e
			}
		default:
			f.kind = "readonly"
		}
	}
	patch := p.patch
	p.patch = func(changes map[string]string) ([]byte, error) {
		for k, v := range changes {
			if !allowed[k] {
				return nil, bad("Unsupported or managed Brickadia field")
			}
			if e := brickadiaValue(k, v); e != nil {
				return nil, e
			}
		}
		return patch(changes)
	}
	return p, nil
}
func brickadiaValue(k, v string) error {
	if !utf8.ValidString(v) || len(v) > 8192 || strings.ContainsAny(v, "\r\n\x00") {
		return bad("Invalid Brickadia value")
	}
	for _, c := range v {
		if c < 32 || c == 127 {
			return bad("Invalid Brickadia value")
		}
	}
	if k == brickadiaSection+"bPubliclyListed" && v != "True" && v != "False" {
		return bad("Invalid Brickadia listing flag")
	}
	return nil
}
