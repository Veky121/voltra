package panel

import (
	"strconv"
	"strings"
)

const ohdSettingsRecipe = "operation_harsh_doorstop/egg-operation-harsh-doorstop.json"
const ohdSettingsPath = "/HarshDoorstop/Saved/Config/LinuxServer/Game.ini"
const ohdSettingsStartup = "exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/ohd_runtime.py run"

// Root must gate this adapter on current server startup AND installed helper
// hashes. Catalog identity alone cannot establish the active launcher.
func ohdSettingsDocument(egg M, file string) bool {
	return nativeSettingsIsRecipe(egg, ohdSettingsRecipe) && file == ohdSettingsPath && str(egg["startup"]) == ohdSettingsStartup
}

func ohdSettingKind(key string) string {
	switch strings.ToLower(key) {
	case "/script/engine.gamesession/maxplayers", "/script/rcon.rconserversystem/maxactiveconnections", "/script/rcon.rconserversystem/maxauthattempts":
		return "number"
	case "/script/engine.gamesession/servername", "/script/engine.gamesession/password", "/script/rcon.rconserversystem/password":
		return "text"
	case "/script/rcon.rconserversystem/benabled":
		return "boolean"
	}
	return ""
}

func parseOHDSettings(data []byte) (gameSettingsParsed, error) {
	p, err := parseGameSettings(ohdSettingsPath, data)
	if err != nil {
		return p, err
	}
	p = gameSettingsINICaseSafety(ohdSettingsPath, data, p)
	allowed := map[string]string{}
	fields := []gameSetting{}
	for _, f := range p.fields {
		kind := ohdSettingKind(f.key)
		if kind == "" || f.kind == "readonly" {
			continue
		}
		f.kind = kind
		f.secret = strings.HasSuffix(strings.ToLower(f.key), "/password")
		if kind == "boolean" {
			f.on, f.off = "True", "False"
		}
		allowed[f.key] = kind
		fields = append(fields, f)
	}
	patch := p.patch
	p.fields = fields
	p.patch = func(changes map[string]string) ([]byte, error) {
		for key, value := range changes {
			kind, ok := allowed[key]
			if !ok {
				return nil, bad("OHD setting is absent, ambiguous or managed.")
			}
			if kind == "number" {
				n, e := strconv.ParseInt(value, 10, 32)
				if e != nil || n < 1 {
					return nil, bad("Enter a positive OHD integer.")
				}
			} else if kind == "boolean" {
				if value != "True" && value != "False" {
					return nil, bad("Enter True or False.")
				}
			} else if len(value) > 200 || strings.ContainsAny(value, "\r\n\x00\"\\;#") {
				return nil, bad("Unsupported OHD scalar syntax.")
			}
			if strings.EqualFold(key, "/Script/RCON.RCONServerSystem/Password") && (len(value) == 0 || len(value) > 32) {
				return nil, bad("OHD RCON password requires 1 to 32 characters.")
			}
		}
		return patch(changes)
	}
	return p, nil
}
