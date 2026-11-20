package gamesettings

import (
	"regexp"
	"strings"
)

const CraftopiaSettingsPath = "/ServerSetting.ini"

// The publisher's shipped INI documents these fields as 1/0 bits. Keep the
// shared INI parser/writer; this changes scoped editor metadata and validation.
var CraftopiaSettingBits = map[string]bool{
	"Host/usePassword": true, "Graphics/grassBend": true, "Save/autoSavePerHour": true,
	"CreativeModeSetting/quickCraft": true, "CreativeModeSetting/noDeath": true,
	"CreativeModeSetting/noDamage": true, "CreativeModeSetting/noHunger": true,
	"CreativeModeSetting/infinitStamina": true, "CreativeModeSetting/buildingIgnoreDamage": true,
	"CreativeModeSetting/noBuild": true,
}

var craftopiaBitToken = regexp.MustCompile(`^[01][ \t]*(?:[;#][^\r\n]*)?$`)

// A boolean such as usePassword is a public flag, not the serverPassword PIN.
// The response formatter may use this guard to avoid masking the flag merely
// because the generic credential-name regex matches its name.
func CraftopiaSettingsBit(egg M, file, key string) bool {
	return file == CraftopiaSettingsPath && CraftopiaSettingBits[key] && IsRecipe(egg, "craftopia/egg-craftopia.json")
}

func CraftopiaSettingsFields(egg M, file string, data []byte, parsed Parsed) Parsed {
	if file != CraftopiaSettingsPath || !IsRecipe(egg, "craftopia/egg-craftopia.json") {
		return parsed
	}
	identities := map[string]string{}
	counts := map[string]int{}
	canonicalTokens := map[string]bool{}
	section := ""
	for _, line := range strings.Split(string(data), "\n") {
		text := strings.TrimSpace(line)
		if text == "" || strings.HasPrefix(text, "#") || strings.HasPrefix(text, ";") {
			continue
		}
		if strings.HasPrefix(text, "[") {
			if end := strings.IndexByte(text, ']'); end >= 0 {
				section = text[1:end]
			}
			continue
		}
		if index := strings.IndexByte(line, '='); index >= 0 {
			key := strings.TrimSpace(line[:index])
			if section != "" {
				key = section + "/" + key
			}
			if CraftopiaSettingBits[key] {
				canonicalTokens[key] = craftopiaBitToken.MatchString(strings.TrimSpace(line[index+1:]))
			}
		}
	}
	for key := range CraftopiaSettingBits {
		identities[INIFold(key)] = key
	}
	for _, field := range parsed.Fields {
		if canonical := identities[INIFold(field.Key)]; canonical != "" {
			counts[canonical]++
		}
	}
	writable := map[string]bool{}
	blocked := map[string]bool{}
	for i, field := range parsed.Fields {
		canonical := identities[INIFold(field.Key)]
		if canonical == "" {
			continue
		}
		// Never resurrect a repeated/unsupported field, quote-decoded text, or
		// a case alias as an editable bit whose native interpretation is unknown.
		if field.Key != canonical || counts[canonical] != 1 || field.Kind == "readonly" || !canonicalTokens[field.Key] || (field.Value != "0" && field.Value != "1") {
			parsed.Fields[i].Kind = "readonly"
			parsed.Fields[i].On, parsed.Fields[i].Off = "", ""
			parsed.Fields[i].structured = false
			blocked[field.Key] = true
			continue
		}
		parsed.Fields[i].Kind, parsed.Fields[i].On, parsed.Fields[i].Off = "boolean", "1", "0"
		writable[field.Key] = true
	}
	patch := parsed.Patch
	if patch == nil {
		return parsed
	}
	parsed.Patch = func(changes map[string]string) ([]byte, error) {
		for key, value := range changes {
			knownBit := identities[INIFold(key)] != ""
			if blocked[key] || knownBit && (!writable[key] || value != "0" && value != "1") {
				return nil, bad("This Craftopia bit requires an unambiguous native 0 or 1 value.")
			}
		}
		return patch(changes)
	}
	return parsed
}
