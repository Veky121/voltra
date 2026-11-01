package panel

import (
	"bytes"
	"strconv"
	"strings"
	"unicode/utf8"
)

const gmodSettingsPath = "/garrysmod/cfg/server.cfg"
const gmodSettingsRecipe = "gmod/egg-garry-s-mod.json"

// Sandbox-only controls verified against Facepunch's sandbox Lua and ConVars
// reference. No defaults are seeded; absent keys remain absent.
func gmodSettingKinds() map[string]string {
	kinds := map[string]string{"sbox_godmode": "boolean", "sbox_noclip": "boolean", "sbox_playershurtplayers": "boolean", "sbox_weapons": "boolean", "physgun_limited": "boolean"}
	for _, name := range strings.Fields("props ragdolls npcs balloons effects dynamite lamps thrusters wheels hoverballs vehicles buttons sents emitters") {
		kinds["sbox_max"+name] = "number"
	}
	return kinds
}

func gmodSettingValue(key, value string) bool {
	kind := gmodSettingKinds()[key]
	if kind == "boolean" {
		return value == "0" || value == "1"
	}
	if kind != "number" || len(value) > 11 {
		return false
	}
	// Integer representation guard, not a claimed publisher clamp. Preserve -1.
	n, err := strconv.ParseInt(value, 10, 32)
	return err == nil && n >= -1
}

func parseGModSettings(data []byte) (gameSettingsParsed, error) {
	if len(data) > 65536 || !utf8.Valid(data) || bytes.HasPrefix(data, []byte{239, 187, 191}) {
		return gameSettingsParsed{}, bad("Invalid GMod configuration encoding or size.")
	}
	out, err := parseSourceSettingsWithSchema(data, gmodSettingKinds(), gmodSettingValue)
	if err != nil {
		return out, err
	}
	unsafe := false
	for _, c := range string(data) {
		if c < 32 && c != '\t' && c != '\r' && c != '\n' || c == 127 || c == '\u0085' || c == '\u2028' || c == '\u2029' {
			unsafe = true
		}
	}
	if bytes.Contains(bytes.ReplaceAll(data, []byte("\r\n"), nil), []byte{'\r'}) {
		unsafe = true
	}
	seen := map[string]bool{}
	for _, raw := range strings.Split(string(data), "\n") {
		line := strings.TrimSuffix(raw, "\r")
		trim := strings.TrimSpace(line)
		if trim == "" || strings.HasPrefix(trim, "//") {
			continue
		}
		m := sourceCvarLine.FindStringSubmatch(line)
		if m == nil {
			unsafe = true
			continue
		}
		key := strings.ToLower(m[2])
		// Unknown statements can execute arbitrary commands, even with one argument.
		// Managed identity/credentials are opaque preserved assignments, never fields.
		opaque := key == "hostname" || key == "sv_password" || key == "rcon_password" || key == "sv_lan"
		if seen[key] || m[2] != key || gmodSettingKinds()[key] == "" && !opaque {
			unsafe = true
		}
		seen[key] = true
	}
	if unsafe {
		for i := range out.fields {
			out.fields[i].kind = "readonly"
		}
		out.patch = func(changes map[string]string) ([]byte, error) {
			if len(changes) > 0 {
				return nil, bad("GMod configuration contains unsupported commands; review it in Files.")
			}
			return bytes.Clone(data), nil
		}
	}
	return out, nil
}

func gmodSettingPresentation(field M) {
	key := str(field["key"])
	field["group"] = "Sandbox"
	field["label"] = strings.ReplaceAll(strings.TrimPrefix(key, "sbox_"), "_", " ")
	if strings.HasPrefix(key, "sbox_max") {
		field["label"] = "Maximum " + strings.TrimPrefix(key, "sbox_max") + " per player"
		field["min"] = -1
		field["max"] = 2147483647
	}
	field["description"] = "Sandbox gamemode only. Addons can override this behavior. Applies on the next map load or restart."
}
