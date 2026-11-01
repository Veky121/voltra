package panel

import "encoding/json"

const factorioNativeRecipe = "factorio/factorio/egg-factorio.json"
const factorioNativeStartup = "exec bash .voltra/factorio-native-start.sh"

func factorioNativeSettings(egg M) bool { return nativeSettingsIsRecipe(egg, factorioNativeRecipe) }

// Validate the complete patched document using the emitted launcher's listing
// predicate. Never include native credential values in errors.
func validateFactorioNativeSettings(egg M, file string, data []byte) error {
	if !factorioNativeSettings(egg) || file != "/data/server-settings.json" {
		return nil
	}
	var value map[string]json.RawMessage
	invalid := func() error {
		return APIError{422, "InvalidFactorioSettings", "Native settings invalid or public listing credentials absent."}
	}
	if json.Unmarshal(data, &value) != nil || value == nil {
		return invalid()
	}
	visibility := map[string]json.RawMessage{}
	if raw, ok := value["visibility"]; ok && string(raw) != "null" {
		if json.Unmarshal(raw, &visibility) != nil || visibility == nil {
			return invalid()
		}
	}
	public := false
	for _, key := range []string{"public", "lan"} {
		raw, ok := visibility[key]
		if !ok || string(raw) == "null" || string(raw) == "false" {
			continue
		}
		var b bool
		if json.Unmarshal(raw, &b) != nil {
			return invalid()
		}
		if key == "public" {
			public = b
		}
	}
	credentials := map[string]string{}
	for _, key := range []string{"username", "token", "password"} {
		raw, ok := value[key]
		if !ok || string(raw) == "null" || string(raw) == "false" {
			continue
		}
		var v string
		if json.Unmarshal(raw, &v) != nil {
			return invalid()
		}
		credentials[key] = v
	}
	if public && (credentials["username"] == "" || (credentials["token"] == "" && credentials["password"] == "")) {
		return invalid()
	}
	return nil
}
