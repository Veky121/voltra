package gamesettings

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"regexp"
	"strings"
)

// settingsAuthorityInput contains snapshots, not paths to be opened by this helper.
// Caller MUST obtain Files using confined, bounded regular-file reads, refusing
// symlinks in every component. Missing optional files require a confirmed ENOENT,
// never permission/I/O failure. Re-read all authority inputs after the mutation
// lock and compare Revision before using the existing native document revision.
// No helper here grants permissions, proves native consumption, or reads disk.
type SettingsAuthorityInput struct {
	Startup string
	Env     map[string]string
	Files   map[string][]byte
}

type SettingsPathAuthority struct{ Path, Revision string }

func SettingsAuthorityHash(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func settingsAuthoritySources(in SettingsAuthorityInput, expected map[string]string) bool {
	for name, digest := range expected {
		data, ok := in.Files[name]
		if !ok || SettingsAuthorityHash([]byte(strings.TrimRight(strings.ReplaceAll(string(data), "\r\n", "\n"), "\n")+"\n")) != digest {
			return false
		}
	}
	return true
}

// Revision covers only nonsecret path authority, never passwords or whole env/config.
func settingsAuthorityResult(path, identity string) SettingsPathAuthority {
	return SettingsPathAuthority{path, SettingsAuthorityHash([]byte(identity + "\x00" + path))}
}

const NitroxAuthorityStartup = "exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/nitrox-update.py run nitrox"

var nitroxAuthoritySave = regexp.MustCompile(`^[A-Za-z0-9_-]{1,100}$`)

func NitroxSettingsAuthority(in SettingsAuthorityInput) (SettingsPathAuthority, error) {
	refuse := errors.New("Nitrox settings authority is unsupported or ambiguous")
	if in.Startup != NitroxAuthorityStartup || !settingsAuthoritySources(in, map[string]string{
		".voltra/nitrox-update.py":       "ced6973eeedd6a69e51aad5a58bbf8774be7898cc42796074210429cbb7e5bba",
		".voltra/engineering-servers.py": "49a5982125da84b57706c71bf71b685544c03d1cd4fbc40d7ef6b07f4addbcee",
	}) {
		return SettingsPathAuthority{}, refuse
	}
	if in.Env["INSTALL_MODE"] != "operator_files" {
		return SettingsPathAuthority{}, refuse
	}
	for _, key := range []string{"SAVE_PATH", "SAVES_FOLDER_DIR", "SavesFolderDir", "DATA_PATH", "NITROX_DATA_PATH", "WINEHOMEDIR"} {
		if in.Env[key] != "" {
			return SettingsPathAuthority{}, refuse
		}
	}
	if v := in.Env["NITROX_VERSION"]; v != "" && v != "latest" && v != "1.8.1.0" {
		return SettingsPathAuthority{}, refuse
	}
	save, ok := in.Env["SAVE_NAME"]
	if !ok {
		save = "nitrox_world"
	}
	if !nitroxAuthoritySave.MatchString(save) {
		return SettingsPathAuthority{}, refuse
	}
	// Pinned ConfigFileKeyValueStore uses AppDataPath/nitrox.cfg, not XDG_CONFIG_HOME.
	// Refuse duplicate keys, malformed objects, null and custom save roots.
	if raw, exists := in.Files["NitroxData/nitrox.cfg"]; exists {
		if len(raw) > 1024*1024 {
			return SettingsPathAuthority{}, refuse
		}
		d := json.NewDecoder(strings.NewReader(strings.TrimPrefix(string(raw), "\ufeff")))
		token, err := d.Token()
		if err != nil || token != json.Delim('{') {
			return SettingsPathAuthority{}, refuse
		}
		seen := map[string]bool{}
		for d.More() {
			token, err = d.Token()
			if err != nil {
				return SettingsPathAuthority{}, refuse
			}
			key, ok := token.(string)
			if !ok || seen[key] {
				return SettingsPathAuthority{}, refuse
			}
			seen[key] = true
			var value json.RawMessage
			if d.Decode(&value) != nil {
				return SettingsPathAuthority{}, refuse
			}
			if strings.EqualFold(key, "SavesFolderDir") {
				var folder string
				if key != "SavesFolderDir" || json.Unmarshal(value, &folder) != nil || folder != "/home/container/NitroxData/saves" {
					return SettingsPathAuthority{}, refuse
				}
			}
		}
		if _, err = d.Token(); err != nil {
			return SettingsPathAuthority{}, refuse
		}
		if _, err = d.Token(); err != io.EOF {
			return SettingsPathAuthority{}, refuse
		}
	}
	path := "/NitroxData/saves/" + save + "/server.cfg"
	return settingsAuthorityResult(path, "nitrox-authority-v1:"+in.Startup), nil
}
