package panel

import (
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"
)

const wave85ASA = "ark_survival_ascended/egg-ark-survival-ascended.json"
const wave85ASE = "ark_survival_evolved/egg-ark--survival-evolved.json"
const wave85TML = "terraria/tmodloader/egg-t-modloader.json"
const wave85ASAFile = "/ShooterGame/Saved/Config/WindowsServer/GameUserSettings.ini"
const wave85ASEFile = "/ShooterGame/Saved/Config/LinuxServer/GameUserSettings.ini"

func wave85ASEManaged(egg M, file, key string) bool {
	if file != wave85ASEFile || !nativeSettingsIsRecipe(egg, wave85ASE) {
		return false
	}
	switch strings.ToLower(key) {
	case "/script/engine.gamesession/maxplayers", "serversettings/activemods", "serversettings/rconenabled":
		return true
	}
	return false
}

// Match the emitted native launch validators, only for their exact file fields.
func wave85NativeChanges(egg M, file string, changes M) error {
	asa := file == wave85ASAFile && nativeSettingsIsRecipe(egg, wave85ASA)
	tml := file == "/serverconfig.txt" && nativeSettingsIsRecipe(egg, wave85TML)
	if !asa && !tml {
		return nil
	}
	for key, raw := range changes {
		k := strings.ToLower(key)
		if asa {
			switch k {
			case "/script/engine.gamesession/maxplayers", "sessionsettings/sessionname", "serversettings/serverpassword", "serversettings/serveradminpassword":
			default:
				continue
			}
		}
		if tml {
			switch k {
			case "maxplayers", "difficulty", "autocreate", "worldname", "password", "motd", "worldpath", "world":
			default:
				continue
			}
		}
		v, ok := raw.(string)
		if !ok {
			return bad("Enter a native setting as text.")
		}
		invalid := false
		match := func(pattern string) bool { return regexp.MustCompile("^(?:" + pattern + ")$").MatchString(v) }
		integer := func(limit int) bool {
			n, e := strconv.Atoi(v)
			return match("[0-9]+") && e == nil && n >= 1 && n <= limit
		}
		control := func() bool {
			for _, c := range v {
				if c < 32 || c == 127 {
					return true
				}
			}
			return false
		}
		if asa {
			switch k {
			case "/script/engine.gamesession/maxplayers":
				invalid = !integer(200)
			case "sessionsettings/sessionname":
				invalid = utf8.RuneCountInString(v) > 256 || control() || strings.ContainsAny(v, "?\"\\")
			case "serversettings/serverpassword", "serversettings/serveradminpassword":
				invalid = utf8.RuneCountInString(v) > 128 || control() || (v != "" && !match("[A-Za-z0-9_-]+")) || (k == "serversettings/serveradminpassword" && v == "")
			}
		}
		if tml {
			invalid = control()
			switch k {
			case "maxplayers":
				invalid = invalid || !integer(255) || !match("[0-9]{1,3}")
			case "difficulty":
				invalid = invalid || !match("[0-3]")
			case "autocreate":
				invalid = invalid || !match("[123]")
			case "worldname":
				invalid = invalid || !match("[A-Za-z0-9_-]{1,20}")
			case "password":
				invalid = invalid || utf8.RuneCountInString(v) > 20
			case "motd":
				invalid = invalid || utf8.RuneCountInString(v) > 40
			case "worldpath":
				invalid = invalid || v != "/home/container/saves/Worlds"
			case "world":
				invalid = invalid || !match("/home/container/saves/Worlds/[A-Za-z0-9_-]{1,20}\\.wld")
			}
		}
		if invalid {
			return bad("This value is rejected by the native launcher: " + key)
		}
	}
	return nil
}
