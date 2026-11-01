package panel

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"path"
	"strings"
)

const carrierAuthorityRecipe = "carrier_command_2/egg-carrier-command2.json"
const carrierAuthorityStartup = "exec /usr/bin/python3 .voltra/carrier-file-authority.py run carrier"
const carrierAuthorityProfile = "carrier-typed-vehicle-v1-native-authority-wave4"

// Hashes are the emitted installer bytes, including its final heredoc newline.
var carrierAuthorityHelpers = map[string]string{
	".voltra/vehicle-sims.py":           "683065b0a9b37e318d580cd8710335c5de0b2591ae7a1e77b1332f9460f4a9af",
	".voltra/steam-native-next.py":      "aa9ed8ab140daa4949bd81e6af72f75199e111a5611c24415bde85d6ae5e7319",
	".voltra/native-config.py":          "8c125bb526b38896eeba57143ec2fc70bfb94f1c9783e4c6d652d8f57e3b52a2",
	".voltra/native-release.py":         "31f274542a9d0b85a7a2cf86ad48b62d9ce8a8549b3e0f631de7b8043e88f193",
	".voltra/native-console.py":         "e8274872cb9ccbf7c60bca3615aed0d200c66bc28dc54b7fdd3b243070f9f3e5",
	".voltra/steam_template.py":         "dc8ff0a9e462751878aad55da80bea8fd2a2d4ef16dbf8d37b798ea8d4c476dd",
	".voltra/source-install.py":         "a1f63dd97984ed20dba5b5af6fddfaff5efdd15f7666231b32728da0c5f54a13",
	".voltra/carrier-file-authority.py": "a04c6c0fe7108ea9e8aeaa49fec7309a1320396d466d73e4297ffea91fcca795",
}

// CarrierBootEvidence must describe effective server inputs and regular-file
// helper reads, never merely the catalog profile. Argv is the native child argv.
type CarrierBootEvidence struct {
	Recipe, ProfileRevision, Startup, Root, CWD, Platform string
	Argv                                                  []string
	Helpers                                               map[string][]byte
	ConfigFiles                                           []byte
}
type CarrierSettingsAuthority struct{ Path, Revision string }

// CarrierRegularRead rejects symlinks in every component, special files and
// escapes, and reads bounded bytes from the opened regular file.
type CarrierRegularRead func(relative string, limit int64) ([]byte, error)

// ResolveCarrierSettingsAuthority grants no permission. Shared GET and PUT must
// resolve again after locking with fresh server/egg/startup/config_files and
// installed bytes, bind Revision into the document revision, and recheck stopped
// state and file.update permission before writing. Independent SFTP is not locked.
func ResolveCarrierSettingsAuthority(b CarrierBootEvidence, read CarrierRegularRead) (CarrierSettingsAuthority, error) {
	refuse := func() (CarrierSettingsAuthority, error) {
		return CarrierSettingsAuthority{}, bad("Unproved Carrier settings authority.")
	}
	if b.Recipe != carrierAuthorityRecipe || b.ProfileRevision != carrierAuthorityProfile || b.Startup != carrierAuthorityStartup || b.Root != "/home/container" || b.CWD != b.Root || b.Platform != "linux/amd64" || len(b.Argv) != 2 || b.Argv[0] != "wine" || b.Argv[1] != b.Root+"/dedicated_server.exe" || read == nil {
		return refuse()
	}
	for name, want := range carrierAuthorityHelpers {
		data, ok := b.Helpers[name]
		if !ok || fmt.Sprintf("%x", sha256.Sum256(data)) != want {
			return refuse()
		}
	}
	// Wings config replacement is a concrete competing writer. Unknown mappings
	// must not be accepted as proof that this native file is unmanaged.
	var mappings map[string]json.RawMessage
	if len(b.ConfigFiles) == 0 || json.Unmarshal(b.ConfigFiles, &mappings) != nil || mappings == nil {
		return refuse()
	}
	for file := range mappings {
		if strings.Contains(file, "\\") || strings.Contains(file, "{{") || path.Clean("/"+strings.TrimPrefix(file, "/")) == carrierSettingsPath {
			return refuse()
		}
	}
	data, err := read("server_config.xml", 8<<20)
	if err != nil {
		return CarrierSettingsAuthority{}, err
	}
	if _, err = parseCarrierGameSettings(data); err != nil {
		return CarrierSettingsAuthority{}, err
	}
	binding, err := json.Marshal(struct {
		Boot CarrierBootEvidence
		Data []byte
	}{b, data})
	if err != nil {
		return refuse()
	}
	return CarrierSettingsAuthority{carrierSettingsPath, fmt.Sprintf("%x", sha256.Sum256(binding))}, nil
}
