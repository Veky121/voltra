package panel

import (
	"crypto/sha256"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"
)

const projectZomboidSettingsRecipe = "project_zomboid/egg-project-zomboid.json"
const projectZomboidSettingsStartup = "exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/project_zomboid_runtime.py"

var projectZomboidSettingsSources = map[string]string{
	".voltra/steam_template.py":          "7d908cdc739fbb999fdfb13f48f3e8d3a5fdf26fbfa48091dee1442913078897",
	".voltra/bundle_debian_python.py":    "16b2ebdcfa2656b591624c9d627defa4c3940be4c8a69d8842778ff25ea0cdc0",
	".voltra/project_zomboid_runtime.py": "95aba2c8dc6fc7f49a9bf78d1b7471c46ad39bfa95c8dc70ed4d9937f44ee106",
}
var projectZomboidSettingsName = regexp.MustCompile(`^[A-Za-z0-9]{1,64}$`)

// Snapshots must be confined bounded regular-file reads. No filesystem or process
// access occurs here. Root must repeat authority and content reads under its lock.
// SERVER_NAME is world/database identity, never a writable settings field.
func projectZomboidSettingsAuthority(recipe, eggStartup string, in settingsAuthorityInput) (settingsPathAuthority, error) {
	refuse := fmt.Errorf("Project Zomboid launcher or selected identity is unsupported")
	if recipe != projectZomboidSettingsRecipe || eggStartup != projectZomboidSettingsStartup || in.Startup != eggStartup {
		return settingsPathAuthority{}, refuse
	}
	for key, value := range in.Env {
		if strings.HasPrefix(key, "BASH_FUNC_") && value != "" {
			return settingsPathAuthority{}, refuse
		}
	}
	for _, key := range []string{"PYTHONPATH", "LD_PRELOAD", "BASH_ENV", "ENV", "SHELLOPTS", "BASHOPTS", "JAVA_TOOL_OPTIONS", "_JAVA_OPTIONS", "JDK_JAVA_OPTIONS"} {
		if in.Env[key] != "" {
			return settingsPathAuthority{}, refuse
		}
	}
	if v := in.Env["PYTHONHOME"]; v != "" && v != "/home/container/.voltra/python" {
		return settingsPathAuthority{}, refuse
	}
	identity := in.Startup
	for _, name := range []string{".voltra/steam_template.py", ".voltra/bundle_debian_python.py", ".voltra/project_zomboid_runtime.py"} {
		digest := fmt.Sprintf("%x", sha256.Sum256(in.Files[name]))
		if digest != projectZomboidSettingsSources[name] {
			return settingsPathAuthority{}, refuse
		}
		identity += "\x00" + digest
	}
	name, present := in.Env["SERVER_NAME"]
	if !present {
		name = "Pterodactyl"
	}
	if !projectZomboidSettingsName.MatchString(name) {
		return settingsPathAuthority{}, refuse
	}
	file := "/.cache/Server/" + name + ".ini"
	data, ok := in.Files[strings.TrimPrefix(file, "/")]
	if !ok {
		return settingsPathAuthority{}, refuse
	}
	if _, err := parseProjectZomboidSettings(data); err != nil {
		return settingsPathAuthority{}, err
	}
	return settingsAuthorityResult(file, identity), nil
}

func projectZomboidSettingKind(key string) string {
	switch key {
	case "PublicName", "Password", "ServerWelcomeMessage":
		return "text"
	case "MaxPlayers":
		return "number"
	case "Public", "PVP", "PauseEmpty", "UPnP":
		return "boolean"
	case "DefaultPort", "UDPPort":
		return "readonly"
	}
	return ""
}

func projectZomboidSettingMetadata(key string) M {
	labels := map[string]string{"PublicName": "Server name", "Password": "Server password", "ServerWelcomeMessage": "Welcome message", "MaxPlayers": "Maximum players", "Public": "Public listing", "PVP": "Player versus player", "PauseEmpty": "Pause when empty", "UPnP": "UPnP", "DefaultPort": "Game port", "UDPPort": "UDP port"}
	m := M{"label": labels[key], "group": "General", "restart_required": true}
	if key == "MaxPlayers" {
		m["min"], m["max"] = 1, 100
	}
	if key == "Password" {
		m["secret"] = true
	}
	if key == "DefaultPort" || key == "UDPPort" {
		m["readOnly"], m["managed"] = true, true
	}
	return m
}

// Reuse the shared byte-span INI editor. This allowlist adds no absent keys and
// never exposes SandboxVars Lua, arrays, Workshop lists or database credentials.
func parseProjectZomboidSettings(data []byte) (gameSettingsParsed, error) {
	if len(data) > 8*1024*1024 || !utf8.Valid(data) || strings.ContainsRune(string(data), 0) {
		return gameSettingsParsed{}, bad("Invalid Zomboid INI")
	}
	p, err := parseGameSettings("/.cache/Server/selected.ini", data)
	if err != nil {
		return p, err
	}
	counts := map[string]int{}
	for _, f := range p.fields {
		alias := strings.TrimLeft(f.key, "+-.!")
		if cut := strings.IndexByte(alias, '['); cut >= 0 {
			alias = alias[:cut]
		}
		counts[strings.ToLower(alias)]++
	}
	allowed := map[string]bool{}
	fields := []gameSetting{}
	for _, f := range p.fields {
		kind := projectZomboidSettingKind(f.key)
		if kind == "" {
			continue
		}
		if counts[strings.ToLower(f.key)] != 1 || f.kind == "readonly" || f.structured {
			return gameSettingsParsed{}, bad("Ambiguous Zomboid scalar")
		}
		f.kind, f.on, f.off, f.secret = kind, "true", "false", f.key == "Password"
		fields = append(fields, f)
		allowed[f.key] = kind != "readonly"
	}
	patch := p.patch
	p.fields = fields
	p.patch = func(changes map[string]string) ([]byte, error) {
		for key, value := range changes {
			if !allowed[key] {
				return nil, bad("Zomboid setting is absent, opaque or managed")
			}
			if !utf8.ValidString(value) || strings.ContainsFunc(value, unicode.IsControl) || strings.ContainsAny(value, "\"'\\;#=[]") || strings.TrimSpace(value) != value {
				return nil, bad("Unsupported Zomboid scalar syntax")
			}
			switch projectZomboidSettingKind(key) {
			case "boolean":
				if value != "true" && value != "false" {
					return nil, bad("Use true or false")
				}
			case "number":
				n, e := strconv.Atoi(value)
				if e != nil || n < 1 || n > 100 || strconv.Itoa(n) != value {
					return nil, bad("Choose 1 to 100 players")
				}
			case "text":
				limit := 255
				if key == "Password" {
					limit = 128
				}
				if len(value) > limit {
					return nil, bad("Zomboid text exceeds byte limit")
				}
			}
		}
		return patch(changes)
	}
	return p, nil
}
