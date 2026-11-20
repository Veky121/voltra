package gamesettings

import "strings"

const Srb2SettingsRecipe = "sonic_robo_blast_2/egg-sonic-robo-blast2.json"
const Srb2SettingsPath = "/adedserv.cfg"

// SRB2 2.2.15 d_netcmd.c declares friendlyfire as CV_OnOff, CV_SAVE|CV_NETVAR.
// Other commands remain opaque. The launcher owns identity, room and password.
func ParseSRB2Settings(data []byte) (Parsed, error) {
	bom := ""
	body := string(data)
	if strings.HasPrefix(body, "\ufeff") {
		bom = "\ufeff"
		body = strings.TrimPrefix(body, bom)
	}
	kinds := map[string]string{"friendlyfire": "boolean", "servername": "readonly", "maxplayers": "readonly", "masterserver_room_id": "readonly", "password": "readonly", "port": "readonly"}
	parsed, err := parseSourceSettingsWithSchema([]byte(body), kinds, func(key, value string) bool {
		return key == "friendlyfire" && (value == "0" || value == "1" || strings.EqualFold(value, "On") || strings.EqualFold(value, "Off"))
	})
	if err != nil {
		return parsed, err
	}
	for i := range parsed.Fields {
		f := &parsed.Fields[i]
		if f.Key == "password" {
			f.Secret = true
		}
		if f.Key == "friendlyfire" && (strings.EqualFold(f.Value, "On") || strings.EqualFold(f.Value, "Off")) {
			f.On = "On"
			f.Off = "Off"
			if strings.EqualFold(f.Value, "On") {
				f.On = f.Value
			} else {
				f.Off = f.Value
			}
		}
	}
	missingFriendlyFire := true
	for _, f := range parsed.Fields {
		if f.Key == "friendlyfire" {
			missingFriendlyFire = false
		}
	}
	// A stock config omits this CV_SAVE variable. Its pinned native default is
	// Off. Only offer insertion when the same command grammar admits a unique
	// appended assignment; malformed duplicates and unsafe syntax stay opaque.
	newline := "\n"
	if strings.Contains(body, "\r\n") {
		newline = "\r\n"
	}
	separator := ""
	if body != "" && !strings.HasSuffix(body, "\n") {
		separator = newline
	}
	if missingFriendlyFire {
		probe, _ := parseSourceSettingsWithSchema([]byte(body+separator+"friendlyfire \"Off\""+newline), kinds, func(key, value string) bool {
			return key == "friendlyfire" && (value == "0" || value == "1" || strings.EqualFold(value, "On") || strings.EqualFold(value, "Off"))
		})
		missingFriendlyFire = false
		for _, f := range probe.Fields {
			if f.Key == "friendlyfire" && f.Kind == "boolean" {
				parsed.Fields = append(parsed.Fields, Setting{Key: "friendlyfire", Value: "Off", Kind: "boolean", On: "On", Off: "Off"})
				missingFriendlyFire = true
			}
		}
	}
	patch := parsed.Patch
	parsed.Patch = func(changes map[string]string) ([]byte, error) {
		appendValue := ""
		if value, ok := changes["friendlyfire"]; ok && missingFriendlyFire {
			switch {
			case value == "1" || strings.EqualFold(value, "On"):
				appendValue = "On"
			case value == "0" || strings.EqualFold(value, "Off"):
				appendValue = "Off"
			default:
				return nil, bad("Friendly fire must be on or off.")
			}
			copy := make(map[string]string, len(changes))
			for key, v := range changes {
				if key != "friendlyfire" {
					copy[key] = v
				}
			}
			changes = copy
		}
		b, e := patch(changes)
		if e != nil {
			return nil, e
		}
		if appendValue != "" {
			b = append(b, []byte(separator+"friendlyfire \""+appendValue+"\""+newline)...)
		}
		return []byte(bom + string(b)), nil
	}
	return parsed, nil
}
