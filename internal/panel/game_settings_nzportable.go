package panel

import (
	"crypto/sha256"
	"fmt"
	"unicode/utf8"
)

const nzPortableSettingsRecipe = "Nazi Zombies Portable/egg-nazi-zombies--portable.json"
const nzPortableSettingsStartup = "exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/id_family_runtime.py nzportable"

// Pins the exact canonical emitted helper, now containing the wave60 candidate.
const nzPortableRuntimeSHA256 = "0629ed72ed805ad8288380a22e19bbaf0923e6712fdd031394cd0b96b268d22a"
const nzPortableInstallerSHA256 = "959548ce226bae8c2f160a59b50b25c67899ec750d1148c2bc2843abbfd2754e"

// Caller must read helper bytes and resolve regular-file/no-symlink authority
// under the server volume again after locking and before publication. No IO here.
func nzPortableSettingsAuthority(recipe, startup, mode, document string, runtime, installer []byte) bool {
	if recipe != nzPortableSettingsRecipe || startup != nzPortableSettingsStartup {
		return false
	}
	if mode != "vril" && mode != "fte_legacy" {
		return false
	}
	if document != "/nzportable/"+mode+"/nzp/voltra-server.cfg" {
		return false
	}
	return fmt.Sprintf("%x", sha256.Sum256(runtime)) == nzPortableRuntimeSHA256 && fmt.Sprintf("%x", sha256.Sum256(installer)) == nzPortableInstallerSHA256
}

// Existing direct scalar occurrences only. This is a lexical projection, never
// effective-value or precedence evidence. The engine executes CFG chains and
// packed defaults; the helper then overrides these controls. No writable schema
// is justified by the retained proof. Do not register a second CFG parser.
func parseNZPortableSettings(data []byte) (gameSettingsParsed, error) {
	if len(data) > 8*1024*1024 || !utf8.Valid(data) {
		return gameSettingsParsed{}, bad("Invalid NZP settings document.")
	}
	schema := map[string]string{"hostname": "readonly", "sys_ticrate": "readonly", "sv_mintic": "readonly", "sv_port": "readonly", "sv_port_tcp": "readonly", "com_protocolname": "readonly", "sv_public": "readonly", "net_enable_websockets": "readonly", "maxplayers": "readonly", "maxclients": "readonly"}
	parsed, err := parseSourceSettingsWithSchema(data, schema, func(string, string) bool { return false })
	if err != nil {
		return parsed, err
	}
	// Unknown keys, including secrets, are opaque and never projected. Copy now
	// so caller mutations cannot change the no-op result captured by the closure.
	original := append([]byte(nil), data...)
	parsed.patch = func(changes map[string]string) ([]byte, error) {
		if len(changes) != 0 {
			return nil, bad("NZP executable configuration precedence is unproved; startup-owned scalars are read-only.")
		}
		return append([]byte(nil), original...), nil
	}
	return parsed, nil
}
