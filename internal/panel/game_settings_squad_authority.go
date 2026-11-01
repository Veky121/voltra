package panel

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
)

const squadAuthorityRevision = "squad-file-authority-v1"
const squadAuthorityStartup = "exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/squad_owner.py"

// These are exact emitted module bytes, not a caller-supplied approval flag.
var squadAuthorityHelpers = map[string]string{
	".voltra/squad_owner.py":         "b33ea3395ddb536f05a6a9a1620eb6a405c86b88c98b66285b564b78c7c372f7",
	".voltra/tactical_runtime.py":    "d0b95c6ae327dbdb7dc298141eddd9eba288693b91a3369b3dc120b3cd399578",
	".voltra/tactical_install.py":    "bf5b741881a20faf82a0fb53800abac90b9c4b32b4ba19198879579fee6f120e",
	".voltra/steam_template.py":      "dc8ff0a9e462751878aad55da80bea8fd2a2d4ef16dbf8d37b798ea8d4c476dd",
	".voltra/native_console.py":      "e8274872cb9ccbf7c60bca3615aed0d200c66bc28dc54b7fdd3b243070f9f3e5",
	".voltra/source_next_install.py": "ab8c1f51facbb540191bbb9904a8aae7479cf3804d5c71726a96c0819ff0a70e",
	".voltra/source_install.py":      "a1f63dd97984ed20dba5b5af6fddfaff5efdd15f7666231b32728da0c5f54a13",
}

// Caller must read regular, confined installed files. Source/catalog hashes alone
// cannot attest an installed launcher. No filesystem, DB or native actions here.
type squadAuthorityInput struct {
	Recipe, Path, Startup, EggStartup string
	ConfigFiles                       json.RawMessage
	Environment                       map[string]string
	Helpers                           map[string][]byte
}

// validateSquadSettingsAuthority deliberately accepts one reviewed boot path.
// Native consumption remains a separate runtime acceptance check.
func validateSquadSettingsAuthority(in squadAuthorityInput) error {
	refuse := func() error { return fmt.Errorf("Squad settings authority is unproved; use Files") }
	if in.Recipe != squadSettingsRecipe || in.Path != squadSettingsPath || in.Startup != squadAuthorityStartup || in.EggStartup != squadAuthorityStartup {
		return refuse()
	}
	// Refuse every mapping, including aliases and unrelated inherited rewrites.
	var mappings map[string]json.RawMessage
	if json.Unmarshal(in.ConfigFiles, &mappings) != nil || mappings == nil || len(mappings) != 0 {
		return refuse()
	}
	for file, expected := range squadAuthorityHelpers {
		sum := sha256.Sum256(in.Helpers[file])
		if hex.EncodeToString(sum[:]) != expected {
			return refuse()
		}
	}
	if in.Environment["VOLTRA_TACTICAL"] != "squad" {
		return refuse()
	}
	if v, ok := in.Environment["SRCDS_APPID"]; ok && v != "403240" {
		return refuse()
	}
	if v, ok := in.Environment["WINDOWS_INSTALL"]; ok && v != "0" {
		return refuse()
	}
	for key, value := range in.Environment {
		upper := strings.ToUpper(key)
		if strings.TrimSpace(value) != "" && (strings.Contains(upper, "FLAGS") || strings.Contains(upper, "ARGS") || upper == "FIXEDMAXPLAYERS" || upper == "LD_PRELOAD" || upper == "PYTHONPATH") {
			return refuse()
		}
	}
	for _, key := range []string{"servername", "maxplayers", "reservedslots", "allowteamchange", "advertise", "ptciu", "teambal", "recorddemos"} {
		lower, l := in.Environment[key]
		upper, u := in.Environment[strings.ToUpper(key)]
		if l && u && lower != upper {
			return refuse()
		}
	}
	return nil
}
