package gamesettings

import (
	"strconv"
	"strings"
)

// OpenTTD15.3 separates native public, private and secret documents. Classify
// the publisher's entire secrets network section, including invite codes that
// do not match generic password/token spellings. Never redact only known keys.
func OpenttdSettingsFields(egg M, file string, parsed Parsed) Parsed {
	if !IsRecipe(egg, "openttd/egg-open-t-t-d-server.json") || (file != "/openttd.cfg" && file != "/private.cfg" && file != "/secrets.cfg") {
		return parsed
	}
	for i := range parsed.Fields {
		field := &parsed.Fields[i]
		folded := strings.ToLower(INIFold(field.Key))
		if file == "/openttd.cfg" && folded == "network/max_password_time" {
			if field.Kind != "readonly" && OpenttdTimeoutValue(field.Value) {
				field.Kind = "number"
			} else {
				field.Kind = "readonly"
			}
		}

		if strings.HasPrefix(folded, "version/") {
			field.Kind = "readonly"
		}
		if file != "/secrets.cfg" || !strings.HasPrefix(folded, "network/") {
			continue
		}
		field.Secret = true
		switch folded {
		case "network/server_password", "network/rcon_password", "network/admin_password":
			if field.Kind != "readonly" {
				field.Kind = "text"
			}
		default:
			// Generated cryptographic identity and invite codes are runtime-owned.
			// Unknown future secret keys remain hidden/read-only until reviewed.
			field.Kind = "readonly"
		}
	}

	patch := parsed.Patch
	parsed.Patch = func(changes map[string]string) ([]byte, error) {
		for key, value := range changes {
			if file == "/openttd.cfg" && strings.ToLower(INIFold(key)) == "network/max_password_time" && !OpenttdTimeoutValue(value) {
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
func OpenttdTimeoutValue(value string) bool {
	n, err := strconv.ParseUint(value, 10, 16)
	return err == nil && n <= 32000 && strconv.FormatUint(n, 10) == value
}
func OpenttdPublicNumericField(egg M, file string, field Setting) bool {
	return file == "/openttd.cfg" && field.Kind == "number" && strings.ToLower(INIFold(field.Key)) == "network/max_password_time" && OpenttdTimeoutValue(field.Value) && IsRecipe(egg, "openttd/egg-open-t-t-d-server.json")
}
