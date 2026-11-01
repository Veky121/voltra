package panel

import (
	"regexp"
	"strings"
)

const craftopiaSettingsPath = "/ServerSetting.ini"

// The publisher's shipped INI documents these fields as 1/0 bits. Keep the
// shared INI parser/writer; this changes scoped editor metadata and validation.
var craftopiaSettingBits = map[string]bool{
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
func craftopiaSettingsBit(egg M, file, key string) bool {
	return file == craftopiaSettingsPath && craftopiaSettingBits[key] && nativeSettingsIsRecipe(egg, "craftopia/egg-craftopia.json")
}

func craftopiaSettingsFields(egg M, file string, data []byte, parsed gameSettingsParsed) gameSettingsParsed {
	if file != craftopiaSettingsPath || !nativeSettingsIsRecipe(egg, "craftopia/egg-craftopia.json") {
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
			if craftopiaSettingBits[key] {
				canonicalTokens[key] = craftopiaBitToken.MatchString(strings.TrimSpace(line[index+1:]))
			}
		}
	}
	for key := range craftopiaSettingBits {
		identities[gameSettingsINIFold(key)] = key
	}
	for _, field := range parsed.fields {
		if canonical := identities[gameSettingsINIFold(field.key)]; canonical != "" {
			counts[canonical]++
		}
	}
	writable := map[string]bool{}
	blocked := map[string]bool{}
	for i, field := range parsed.fields {
		canonical := identities[gameSettingsINIFold(field.key)]
		if canonical == "" {
			continue
		}
		// Never resurrect a repeated/unsupported field, quote-decoded text, or
		// a case alias as an editable bit whose native interpretation is unknown.
		if field.key != canonical || counts[canonical] != 1 || field.kind == "readonly" || !canonicalTokens[field.key] || (field.value != "0" && field.value != "1") {
			parsed.fields[i].kind = "readonly"
			parsed.fields[i].on, parsed.fields[i].off = "", ""
			parsed.fields[i].structured = false
			blocked[field.key] = true
			continue
		}
		parsed.fields[i].kind, parsed.fields[i].on, parsed.fields[i].off = "boolean", "1", "0"
		writable[field.key] = true
	}
	patch := parsed.patch
	if patch == nil {
		return parsed
	}
	parsed.patch = func(changes map[string]string) ([]byte, error) {
		for key, value := range changes {
			knownBit := identities[gameSettingsINIFold(key)] != ""
			if blocked[key] || knownBit && (!writable[key] || value != "0" && value != "1") {
				return nil, bad("This Craftopia bit requires an unambiguous native 0 or 1 value.")
			}
		}
		return patch(changes)
	}
	return parsed
}
