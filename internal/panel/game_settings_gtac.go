package panel

import (
	"bytes"
	"encoding/xml"
	"io"
	"strings"
)

const gtacSettingsRecipe = "gta/gtac/egg-grand-theft-auto-connected.json"
const gtacSettingsPath = "/gtac/server.xml"
const gtacSettingsStartup = "exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/gtac-runtime.py"

// These are helper-owned values, not writable native-file controls. No defaults
// are inferred. Root must keep the existing startup controls as their editor.
var gtacSettingsTypes = map[string]string{
	"servername": "text", "game": "select", "maxplayers": "number",
	"serverbrowser": "boolean", "password": "password", "port": "number",
	"httpport": "number", "bindip": "text",
}

// Pure path selection over caller-supplied bounded snapshots. This does not
// attest a process. Root must re-read after lock, enforce RBAC/state/revisions,
// refuse symlinks and config-file overrides, and publish through its own layer.
func gtacSettingsAuthority(recipe string, in settingsAuthorityInput) (settingsPathAuthority, error) {
	refuse := bad("GTAC startup/helper/path authority is unsupported.")
	if recipe != gtacSettingsRecipe || in.Startup != gtacSettingsStartup {
		return settingsPathAuthority{}, refuse
	}
	if root := in.Env["VOLTRA_SERVER_ROOT"]; root != "" && root != "/home/container" {
		return settingsPathAuthority{}, refuse
	}
	if !settingsAuthoritySources(in, map[string]string{
		".voltra/gtac-runtime.py":   "42ae3920b4818a6f77535d03e21404df89a9c23846f70dd61248ed2bd2c728c7",
		".voltra/gta-runtime.py":    "77861a5830154ed6b27e3ae25640b28b22a19071b03944f08be0c0481470d5c2",
		".voltra/native-config.py":  "8c125bb526b38896eeba57143ec2fc70bfb94f1c9783e4c6d652d8f57e3b52a2",
		".voltra/native-console.py": "7f0c2a6e4050d12fc3bb2af9dcd723df6b80109fed91a26ccd1ae52d2bb1b3a4",
	}) {
		return settingsPathAuthority{}, refuse
	}
	raw, ok := in.Files["gtac/server.xml"]
	if !ok {
		return settingsPathAuthority{}, refuse
	}
	if _, err := parseGTACGameSettings(raw); err != nil {
		return settingsPathAuthority{}, err
	}
	return settingsAuthorityResult(gtacSettingsPath, "gtac-readonly-v1:"+in.Startup), nil
}

func parseGTACGameSettings(data []byte) (gameSettingsParsed, error) {
	invalid := bad("Invalid or ambiguous GTAC XML.")
	if len(data) > 1<<20 {
		return gameSettingsParsed{}, invalid
	}
	// Reuse shared XML validation. Its property-attribute patcher is deliberately
	// not used for GTAC text nodes. Unknown nodes never become writable controls.
	if _, _, err := quickXMLProperties(data, "server"); err != nil {
		return gameSettingsParsed{}, err
	}
	source := bytes.Clone(data)
	decoder := xml.NewDecoder(bytes.NewReader(bytes.TrimPrefix(source, []byte{239, 187, 191})))
	out := gameSettingsParsed{}
	depth := 0
	seen := map[string]bool{}
	active := ""
	value := ""
	for {
		token, err := decoder.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return gameSettingsParsed{}, invalid
		}
		switch n := token.(type) {
		case xml.ProcInst:
			if n.Target != "xml" || depth != 0 {
				return gameSettingsParsed{}, invalid
			}
		case xml.StartElement:
			depth++
			if depth > 128 || active != "" {
				return gameSettingsParsed{}, invalid
			}
			if depth == 2 {
				key := strings.ToLower(n.Name.Local)
				if _, known := gtacSettingsTypes[key]; known {
					if n.Name.Space != "" || n.Name.Local != key || len(n.Attr) != 0 || seen[key] {
						return gameSettingsParsed{}, invalid
					}
					seen[key] = true
					active = key
					value = ""
				}
			}
		case xml.CharData:
			if active != "" {
				value += string(n)
			}
		case xml.Comment:
			if active != "" {
				return gameSettingsParsed{}, invalid
			}
		case xml.EndElement:
			if depth == 2 && active != "" {
				f := gameSetting{key: active, value: value, kind: "readonly", secret: active == "password"}
				if f.secret {
					f.value = ""
				}
				out.fields = append(out.fields, f)
				active = ""
			}
			depth--
		}
	}
	out.patch = func(changes map[string]string) ([]byte, error) {
		if len(changes) != 0 {
			return nil, bad("GTAC scalar settings are managed by startup/allocation controls; XML editing is unsupported.")
		}
		return bytes.Clone(source), nil
	}
	return out, nil
}
