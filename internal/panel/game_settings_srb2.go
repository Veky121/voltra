package panel

import "strings"

const srb2SettingsRecipe = "sonic_robo_blast_2/egg-sonic-robo-blast2.json"
const srb2SettingsPath = "/adedserv.cfg"

// SRB2 2.2.15 d_netcmd.c declares friendlyfire as CV_OnOff, CV_SAVE|CV_NETVAR.
// Other commands remain opaque. The launcher owns identity, room and password.
func parseSRB2Settings(data []byte) (gameSettingsParsed, error) {
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
	for i := range parsed.fields {
		f := &parsed.fields[i]
		if f.key == "password" {
			f.secret = true
		}
		if f.key == "friendlyfire" && (strings.EqualFold(f.value, "On") || strings.EqualFold(f.value, "Off")) {
			f.on = "On"
			f.off = "Off"
			if strings.EqualFold(f.value, "On") {
				f.on = f.value
			} else {
				f.off = f.value
			}
		}
	}
	missingFriendlyFire := true
	for _, f := range parsed.fields {
		if f.key == "friendlyfire" {
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
		for _, f := range probe.fields {
			if f.key == "friendlyfire" && f.kind == "boolean" {
				parsed.fields = append(parsed.fields, gameSetting{key: "friendlyfire", value: "Off", kind: "boolean", on: "On", off: "Off"})
				missingFriendlyFire = true
			}
		}
	}
	patch := parsed.patch
	parsed.patch = func(changes map[string]string) ([]byte, error) {
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
