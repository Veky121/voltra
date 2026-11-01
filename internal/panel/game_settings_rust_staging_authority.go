package panel

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"regexp"
)

const rustStagingAuthorityStartup = "exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/rust_runtime.py"

// Exact emitted bytes, including final newline. Source script bytes can differ
// from the canonical installer; only installed observations belong in Files.
var rustStagingAuthorityHelpers = map[string]string{
	".voltra/rust_runtime.py":   "c77761082f7bc964855d715cb7ef17b70800b10819775be92402fbd307b48b4a",
	".voltra/steam_template.py": "7d908cdc739fbb999fdfb13f48f3e8d3a5fdf26fbfa48091dee1442913078897",
	".voltra/rust_install.py":   "60fcd46b570a1739efee038a54b0c7d6de7f0e0719253db0a27b7a7ddd1fcf95",
}

type rustStagingAuthorityInput struct {
	Recipe, Startup, EggStartup, Path string
	ConfigFiles                       json.RawMessage
	Env                               map[string]string
	// Caller supplies regular files read through supported Wings confinement.
	// This pure resolver does not observe filesystem types or serialize SFTP.
	Files map[string][]byte
}

type rustStagingAuthority struct{ Path, Revision string }

var rustStagingIdentity = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)

// resolveRustStagingAuthority admits existing server.tags only. It grants no
// permission, stopped-state, revision, or native-consumption guarantee.
func resolveRustStagingAuthority(in rustStagingAuthorityInput) (rustStagingAuthority, error) {
	refuse := errors.New("Rust staging settings authority is unsupported or ambiguous")
	no := func() (rustStagingAuthority, error) { return rustStagingAuthority{}, refuse }
	if in.Recipe != rustStagingSettingsRecipe || in.Startup != rustStagingAuthorityStartup || in.EggStartup != rustStagingAuthorityStartup {
		return no()
	}
	var mappings map[string]json.RawMessage
	if json.Unmarshal(in.ConfigFiles, &mappings) != nil || mappings == nil || len(mappings) != 0 {
		return no()
	}
	identity, exists := in.Env["SERVER_ID"]
	if !exists {
		identity = "rust"
	} // Python env.get default, not a blank-value fallback.
	if !rustStagingIdentity.MatchString(identity) {
		return no()
	}
	file := "/server/" + identity + "/cfg/server.cfg"
	if in.Path != file {
		return no()
	}
	for _, key := range []string{"ADDITIONAL_ARGS", "PYTHONPATH", "LD_PRELOAD"} {
		if in.Env[key] != "" {
			return no()
		}
	}
	// Frameworks can execute plugin code that changes tags independently.
	if v, ok := in.Env["FRAMEWORK"]; ok && v != "vanilla" {
		return no()
	}
	for name, expected := range rustStagingAuthorityHelpers {
		data, ok := in.Files[name]
		if !ok {
			return no()
		}
		hash := sha256.Sum256(data)
		if hex.EncodeToString(hash[:]) != expected {
			return no()
		}
	}
	if _, exists := in.Files[file]; !exists {
		return no()
	}
	return rustStagingAuthority{Path: file, Revision: "rust-staging-tags-authority-v1:" + identity}, nil
}
