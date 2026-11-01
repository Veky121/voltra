package panel

import (
	"strconv"
	"strings"
)

// OpenTTD15.3 separates native public, private and secret documents. Classify
// the publisher's entire secrets network section, including invite codes that
// do not match generic password/token spellings. Never redact only known keys.
func openttdSettingsFields(egg M, file string, parsed gameSettingsParsed) gameSettingsParsed {
	if !nativeSettingsIsRecipe(egg, "openttd/egg-open-t-t-d-server.json") || (file != "/openttd.cfg" && file != "/private.cfg" && file != "/secrets.cfg") {
		return parsed
	}
	for i := range parsed.fields {
		field := &parsed.fields[i]
		folded := strings.ToLower(gameSettingsINIFold(field.key))
		if file == "/openttd.cfg" && folded == "network/max_password_time" {
			if field.kind != "readonly" && openttdTimeoutValue(field.value) {
				field.kind = "number"
			} else {
				field.kind = "readonly"
			}
		}

		if strings.HasPrefix(folded, "version/") {
			field.kind = "readonly"
		}
		if file != "/secrets.cfg" || !strings.HasPrefix(folded, "network/") {
			continue
		}
		field.secret = true
		switch folded {
		case "network/server_password", "network/rcon_password", "network/admin_password":
			if field.kind != "readonly" {
				field.kind = "text"
			}
		default:
			// Generated cryptographic identity and invite codes are runtime-owned.
			// Unknown future secret keys remain hidden/read-only until reviewed.
			field.kind = "readonly"
		}
	}

	patch := parsed.patch
	parsed.patch = func(changes map[string]string) ([]byte, error) {
		for key, value := range changes {
			if file == "/openttd.cfg" && strings.ToLower(gameSettingsINIFold(key)) == "network/max_password_time" && !openttdTimeoutValue(value) {
				return nil, bad("Password-entry timeout must be a whole number from 0 to 32000.")
			}
		}
		return patch(changes)
	}
	return parsed
}

// Publisher15.3 network_settings.ini: SLE_UINT16, default2000, min0, max32000.
// This is a public timeout, not a credential. Exceptions require valid numeric
// type/value AND exact recipe/document/key; actual passwords stay protected.
func openttdTimeoutValue(value string) bool {
	n, err := strconv.ParseUint(value, 10, 16)
	return err == nil && n <= 32000 && strconv.FormatUint(n, 10) == value
}
func openttdPublicNumericField(egg M, file string, field gameSetting) bool {
	return file == "/openttd.cfg" && field.kind == "number" && strings.ToLower(gameSettingsINIFold(field.key)) == "network/max_password_time" && openttdTimeoutValue(field.value) && nativeSettingsIsRecipe(egg, "openttd/egg-open-t-t-d-server.json")
}
