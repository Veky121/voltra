package panel

import "bytes"

const l4dSettingsPath = "/left4dead/cfg/server.cfg"
const l4dManagedFooter = "\n// BEGIN VOLTRA L4D MANAGED\nexec voltra-managed.cfg\nexec voltra-variant.cfg\n// END VOLTRA L4D MANAGED\n"

// sv_alltalk is retained only as an existing read-only observation. Source SDK
// evidence is cross-branch; it does not prove this CVar's L4D type or semantics.
// Exact publisher evidence must be reviewed before enabling any typed control.
func parseL4DSettings(data []byte) (gameSettingsParsed, error) {
	out, err := parseSourceSettingsWithSchema(data, map[string]string{"sv_alltalk": "readonly"}, func(string, string) bool { return false })
	if err != nil {
		return out, err
	}
	original := bytes.Clone(data)
	out.patch = func(changes map[string]string) ([]byte, error) {
		if len(changes) != 0 {
			return nil, bad("L4D scalar controls await exact publisher verification. Use Files.")
		}
		return bytes.Clone(original), nil
	}
	return out, nil
}
