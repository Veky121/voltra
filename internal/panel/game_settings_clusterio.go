package panel

import (
	"bytes"
	"encoding/json"
	"errors"
	"strings"
	"unicode/utf8"
)

const clusterioSettingsRecipe = "factorio/clusterio/egg-clusterio.json"
const clusterioSettingsStartup = "exec node .voltra/clusterio-start.mjs"

// Selection proves only the reviewed helper's role/file contract. It does not
// attest node_modules, a running process, or authorize any writable field.
func clusterioSettingsSelection(recipe, eggStartup string, in settingsAuthorityInput) (settingsPathAuthority, error) {
	refuse := errors.New("Clusterio settings selection is unsupported or ambiguous")
	if recipe != clusterioSettingsRecipe || eggStartup != clusterioSettingsStartup || in.Startup != eggStartup {
		return settingsPathAuthority{}, refuse
	}
	for _, key := range []string{"NODE_OPTIONS", "NODE_PATH", "LD_PRELOAD", "LD_LIBRARY_PATH", "BASH_ENV", "ENV", "EXTRA_ARGS", "ADDITIONAL_ARGS"} {
		if in.Env[key] != "" {
			return settingsPathAuthority{}, refuse
		}
	}
	pins := map[string]string{
		".voltra/clusterio-start.mjs":      "6206b2f38d03245b3c12b1f23cab1b9835e4d13335572104410c9b96dfdfa5aa",
		".voltra/clusterio-setup.mjs":      "9fcd1b5054ab890bae86c93091086335689626bdb9f4af6b701d81430b310373",
		".voltra/clusterio-controller.mjs": "2d8fa9a0eacefba4e59aafa9e967dfbc2131f70e97c1e6ccffa431a173b1146e",
	}
	for name, hash := range pins {
		if settingsAuthorityHash(in.Files[name]) != hash {
			return settingsPathAuthority{}, refuse
		}
	}
	role := in.Env["SERVER_MODE"]
	if (role != "controller" && role != "host") || string(in.Files[".voltra/clusterio-mode"]) != role+"\n" {
		return settingsPathAuthority{}, refuse
	}
	file := "config-" + role + ".json"
	if _, err := clusterioManagedSettings(role, in.Files[file]); err != nil {
		return settingsPathAuthority{}, refuse
	}
	return settingsAuthorityResult("/"+file, "clusterio-helper-selection-v1:"+role+":"+in.Startup), nil
}

// Only existing helper-owned scalar controls are projected. Unknown/plugin and
// credential sections stay opaque. No defaults, writable fields or patcher are
// supplied until pinned native schema and CLI precedence are retained as proof.
func clusterioManagedSettings(role string, data []byte) ([]M, error) {
	refuse := errors.New("Invalid or ambiguous Clusterio configuration")
	if len(data) > 4*1024*1024 || !utf8.Valid(data) || !json.Valid(data) {
		return nil, refuse
	}
	spans, err := bananaJSONSpans(data)
	if err != nil || !spans[""].object {
		return nil, refuse
	}
	seen := map[string]bool{}
	for pointer := range spans {
		if pointer == "" {
			continue
		}
		folded := strings.ToLower(pointer)
		if seen[folded] {
			return nil, refuse
		}
		seen[folded] = true
	}
	keys := []string{"controller.name", "controller.http_port", "controller.bind_address"}
	if role == "host" {
		keys = []string{"host.id", "host.name", "host.controller_url", "host.public_address", "host.factorio_directory", "host.factorio_port_range"}
	} else if role != "controller" {
		return nil, refuse
	}
	out := []M{}
	for _, key := range keys {
		span, ok := spans["/"+key]
		if !ok {
			continue
		}
		raw := data[span.start:span.end]
		kind := "string"
		var value any
		if key == "controller.http_port" || key == "host.id" {
			kind = "number"
			var number json.Number
			if len(raw) == 0 || raw[0] == '"' || json.Unmarshal(raw, &number) != nil {
				return nil, refuse
			}
			n, e := number.Int64()
			if e != nil || n < 0 || n > 2147483647 || (key == "controller.http_port" && (n < 1 || n > 65535)) {
				return nil, refuse
			}
			value = number.String()
		} else {
			var text string
			if json.Unmarshal(raw, &text) != nil || !bananaSettingsText(text, 4096) {
				return nil, refuse
			}
			value = text
		}
		out = append(out, M{"key": "/" + key, "value": value, "type": kind, "label": key, "group": "General", "readOnly": true, "managed": true, "restart_required": true})
	}
	return out, nil
}

// Empty edits preserve every byte. All mutations fail closed, including secret
// replacement and creation of absent keys. Root must not register a write API.
func clusterioSettingsPatch(role string, data []byte, changes map[string]string) ([]byte, error) {
	if _, err := clusterioManagedSettings(role, data); err != nil {
		return nil, err
	}
	if len(changes) != 0 {
		return nil, errors.New("Clusterio file settings are managed or lack native schema proof; use Startup")
	}
	return bytes.Clone(data), nil
}
