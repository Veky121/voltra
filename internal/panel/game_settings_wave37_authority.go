package panel

import (
	"strconv"
	"strings"
	"unicode/utf8"
)

const risingUnityRecipe = "rising_world/unity/egg-rising-world-unity.json"

// Use the shared properties reader and byte editor. The Unity launcher accepts
// canonical scalar identities only and does not evaluate plugin settings.
func parseRisingUnitySettings(data []byte) (gameSettingsParsed, error) {
	p, err := parseGameSettings("/server.properties", data)
	if err != nil {
		return p, err
	}
	records, err := quickPropertyRecords(data)
	if err != nil {
		return p, err
	}
	allowed := map[string]string{"Server_Name": "text", "Server_Password": "text", "World_GameMode": "text", "World_Name": "text", "RCON_Enabled": "boolean", "RCON_Password": "text", "Password": "text"}
	seen := map[string]bool{}
	for _, r := range records {
		for key := range allowed {
			if strings.EqualFold(r.Key, key) {
				if r.Key != key || seen[key] {
					return gameSettingsParsed{}, bad("Ambiguous Unity property.")
				}
				seen[key] = true
			}
		}
	}
	valid := func(k, v string) bool {
		if !utf8.ValidString(v) || strings.IndexFunc(v, func(r rune) bool { return r < 32 || r == 127 }) >= 0 {
			return false
		}
		switch k {
		case "Server_Name":
			return len(v) <= 4096
		case "Server_Password", "RCON_Password", "Password":
			return len(v) <= 4096
		case "World_Name":
			return len(v) > 0 && len(v) <= 20 && v != "." && v != ".." && !strings.ContainsAny(v, "/\\:")
		case "World_GameMode":
			return v == "" || v == "Survival" || v == "Creative"
		case "RCON_Enabled":
			_, e := strconv.ParseBool(v)
			return e == nil && (v == "true" || v == "false")
		}
		return false
	}
	fields := []gameSetting{}
	for _, f := range p.fields {
		if kind, ok := allowed[f.key]; ok {
			if !valid(f.key, f.value) {
				return gameSettingsParsed{}, bad("Invalid Unity scalar.")
			}
			f.kind = kind
			f.on = "true"
			f.off = "false"
			fields = append(fields, f)
		}
	}
	patch := p.patch
	p.fields = fields
	p.patch = func(changes map[string]string) ([]byte, error) {
		// RCON enablement is coupled to a reserved listener and credential. Keep it
		// visible but require Runtime until cross-field publication is available.
		for k, v := range changes {
			if k == "RCON_Enabled" || k == "RCON_Password" || seen["Password"] && (k == "Password" || k == "Server_Password") || !valid(k, v) {
				return nil, bad("Unsupported Unity change.")
			}
		}
		return patch(changes)
	}
	for i := range p.fields {
		if p.fields[i].key == "RCON_Enabled" || p.fields[i].key == "RCON_Password" || seen["Password"] && (p.fields[i].key == "Password" || p.fields[i].key == "Server_Password") {
			p.fields[i].kind = "readonly"
		}
	}
	return p, nil
}

const stationeersVanillaRecipe = "stationeers/stationeers_vanilla/egg-stationeers.json"
const bedrockVanillaRecipe = "minecraft/bedrock/bedrock/egg-vanilla-bedrock.json"
