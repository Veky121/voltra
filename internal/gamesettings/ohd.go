package gamesettings

import (
	"strconv"
	"strings"
)

const OhdSettingsRecipe = "operation_harsh_doorstop/egg-operation-harsh-doorstop.json"
const OhdSettingsPath = "/HarshDoorstop/Saved/Config/LinuxServer/Game.ini"
const ohdSettingsStartup = "exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/ohd_runtime.py run"

// Root must gate this adapter on current server startup AND installed helper
// hashes. Catalog identity alone cannot establish the active launcher.
func ohdSettingsDocument(egg M, file string) bool {
	return IsRecipe(egg, OhdSettingsRecipe) && file == OhdSettingsPath && str(egg["startup"]) == ohdSettingsStartup
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

func parseOHDSettings(data []byte) (Parsed, error) {
	p, err := Parse(OhdSettingsPath, data)
	if err != nil {
		return p, err
	}
	p = gameSettingsINICaseSafety(OhdSettingsPath, data, p)
	allowed := map[string]string{}
	fields := []Setting{}
	for _, f := range p.Fields {
		kind := ohdSettingKind(f.Key)
		if kind == "" || f.Kind == "readonly" {
			continue
		}
		f.Kind = kind
		f.Secret = strings.HasSuffix(strings.ToLower(f.Key), "/password")
		if kind == "boolean" {
			f.On, f.Off = "True", "False"
		}
		allowed[f.Key] = kind
		fields = append(fields, f)
	}
	patch := p.Patch
	p.Fields = fields
	p.Patch = func(changes map[string]string) ([]byte, error) {
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
