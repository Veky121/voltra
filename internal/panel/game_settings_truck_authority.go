package panel

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"path"
	"strings"
)

var truckReviewedContracts = map[string]truckBootContract{
	"truck-simulator/american-truck-simulator/egg-american-truck-simulator-dedicated-server.json": {Revision: "ats-native-file-authority-v2", Startup: "exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/ats-native.py run", Folder: "American Truck Simulator", Binary: "amtrucks_server", Helpers: map[string]string{
		".voltra/ats-native.py":              "a3e69c9c90b60d5d27615bbd60221fe692dab204eea7d1cf7e969588a9244aa5",
		".voltra/truck-trackmania-native.py": "e5055cf1e53bb1230c84cb0fca3cc18cabbdd9e8676d8f09f7c73e6211e68881",
		".voltra/native-config.py":           "8c125bb526b38896eeba57143ec2fc70bfb94f1c9783e4c6d652d8f57e3b52a2",
		".voltra/native-release.py":          "31f274542a9d0b85a7a2cf86ad48b62d9ce8a8549b3e0f631de7b8043e88f193",
		".voltra/native-console.py":          "e8274872cb9ccbf7c60bca3615aed0d200c66bc28dc54b7fdd3b243070f9f3e5",
		".voltra/steam_template.py":          "dc8ff0a9e462751878aad55da80bea8fd2a2d4ef16dbf8d37b798ea8d4c476dd",
		".voltra/source-install.py":          "a1f63dd97984ed20dba5b5af6fddfaff5efdd15f7666231b32728da0c5f54a13",
		".voltra/bundle-debian-python.py":    "16b2ebdcfa2656b591624c9d627defa4c3940be4c8a69d8842778ff25ea0cdc0",
	}},
	"truck-simulator/euro-truck-simulator2/egg-euro-truck-simulator2-dedicated-server.json": {Revision: "ets2-owner-preserve-v2-pending", Startup: "exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/ets2-native.py run", Folder: "Euro Truck Simulator 2", Binary: "eurotrucks2_server", Helpers: map[string]string{
		".voltra/truck-trackmania-native.py": "e5055cf1e53bb1230c84cb0fca3cc18cabbdd9e8676d8f09f7c73e6211e68881",
		".voltra/native-config.py":           "8c125bb526b38896eeba57143ec2fc70bfb94f1c9783e4c6d652d8f57e3b52a2",
		".voltra/native-release.py":          "31f274542a9d0b85a7a2cf86ad48b62d9ce8a8549b3e0f631de7b8043e88f193",
		".voltra/native-console.py":          "e8274872cb9ccbf7c60bca3615aed0d200c66bc28dc54b7fdd3b243070f9f3e5",
		".voltra/steam_template.py":          "7d908cdc739fbb999fdfb13f48f3e8d3a5fdf26fbfa48091dee1442913078897",
		".voltra/source-install.py":          "a1f63dd97984ed20dba5b5af6fddfaff5efdd15f7666231b32728da0c5f54a13",
		".voltra/bundle-debian-python.py":    "16b2ebdcfa2656b591624c9d627defa4c3940be4c8a69d8842778ff25ea0cdc0",
		".voltra/ets2-native.py":             "fc1b7ff6c40dd2b12888f309b62ecae9399dbd73fefacd44d3533472dadcd977",
	}},
}

// TruckBootEvidence describes effective native boot inputs, not catalog guesses.
// The caller must obtain these from the reviewed launcher and regular-file reads.
type TruckBootEvidence struct {
	Recipe, ProfileRevision, Startup, Platform, Root, CWD, Home, XDGDataHome string
	Argv                                                                     []string
	Helpers                                                                  map[string][]byte
}
type truckBootContract struct {
	Revision, Startup, Folder, Binary string
	Helpers                           map[string]string
}

// TruckRegularRead must reject symlinks in EVERY path component, directories,
// devices and escapes, and return bounded bytes from an opened regular file.
// A pathname-only existence check is not an implementation of this contract.
type TruckRegularRead func(relative string, limit int64) ([]byte, error)
type TruckSettingsAuthority struct{ Path, Revision string }

// ResolveTruckSettingsAuthority is pure apart from the caller-supplied read.
// Integration must call it again AFTER acquiring the settings lock, with fresh
// permissions, stopped state, actual startup, profile, effective boot evidence,
// and installed helper bytes. Bind its Revision into the shared document revision
// alongside original SII bytes; reject stale PUT before patching. Re-read with
// identical confinement before write. This function grants no API permission.
func ResolveTruckSettingsAuthority(b TruckBootEvidence, read TruckRegularRead) (TruckSettingsAuthority, error) {
	refuse := func() (TruckSettingsAuthority, error) {
		return TruckSettingsAuthority{}, errors.New("unproved truck settings authority")
	}
	c, ok := truckReviewedContracts[b.Recipe]
	if !ok || b.ProfileRevision != c.Revision || b.Startup != c.Startup || b.Platform != "linux/amd64" || b.Root != "/home/container" || b.CWD != b.Root || b.Home != b.Root || b.XDGDataHome != b.Root+"/.local/share" || len(b.Argv) != 1 || b.Argv[0] != b.Root+"/bin/linux_x64/"+c.Binary || read == nil {
		return refuse()
	}
	for name, want := range c.Helpers {
		data, ok := b.Helpers[name]
		if !ok || fmt.Sprintf("%x", sha256.Sum256(data)) != want {
			return refuse()
		}
	}
	target := ".local/share/" + c.Folder + "/server_config.sii"
	// The allowlisted POSIX relative path cannot accept host-platform normalization.
	if path.Clean(target) != target || path.IsAbs(target) || strings.Contains(target, "\\") {
		return refuse()
	}
	data, err := read(target, 4<<20)
	if err != nil {
		return TruckSettingsAuthority{}, err
	}
	if len(data) == 0 || len(data) > 4<<20 {
		return refuse()
	}
	if _, err = ParseTruckSII(data); err != nil {
		return TruckSettingsAuthority{}, err
	}
	binding, err := json.Marshal(struct {
		Boot TruckBootEvidence
		Path string
		Data []byte
	}{b, target, data})
	if err != nil {
		return refuse()
	}
	return TruckSettingsAuthority{Path: "/" + target, Revision: fmt.Sprintf("%x", sha256.Sum256(binding))}, nil
}
