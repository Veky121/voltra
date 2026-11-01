package panel

import "strings"

func gameSettingsContainsSecret(value any) bool {
	switch v := value.(type) {
	case map[string]any:
		for key, child := range v {
			if gameSettingSecret.MatchString(key) || gameSettingsContainsSecret(child) {
				return true
			}
		}
	case []any:
		for _, child := range v {
			if gameSettingsContainsSecret(child) {
				return true
			}
		}
	}
	return false
}

// The specialized parser uses exact native spelling. Reject case aliases and
// repeated outer tuples before selecting a value rather than hiding a shadow.
func validatePalworldSettingsIdentity(data []byte) error {
	const canonical = "/Script/Pal.PalGameWorldSettings"
	section := ""
	count := 0
	for _, line := range strings.Split(string(data), "\n") {
		trim := strings.TrimSpace(line)
		if strings.HasPrefix(trim, "[") && strings.HasSuffix(trim, "]") {
			section = trim[1 : len(trim)-1]
			if strings.EqualFold(section, canonical) && section != canonical {
				return bad("Case-variant Palworld section requires review in Files.")
			}
			continue
		}
		if section != canonical || strings.HasPrefix(trim, ";") || strings.HasPrefix(trim, "#") {
			continue
		}
		key, _, found := strings.Cut(trim, "=")
		key = strings.TrimSpace(key)
		if found && strings.EqualFold(key, "OptionSettings") {
			count++
			if count > 1 || key != "OptionSettings" {
				return bad("Ambiguous Palworld settings require review in Files.")
			}
		}
	}
	return nil
}
