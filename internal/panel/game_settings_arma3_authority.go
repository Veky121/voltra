package panel

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
)

// arma3ActiveSettingsAuthority is pure. Callers supply confined exact installed
// helper snapshots, actual startup, and effective environment. It grants no permissions.
func arma3ActiveSettingsAuthority(startup, file string, env map[string]string, files map[string][]byte) (string, error) {
	refuse := errors.New("Arma3 active settings authority is unsupported")
	if startup != "exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/arma3-controls.py run arma3" || (file != "/server.cfg" && file != "/basic.cfg") {
		return "", refuse
	}
	for _, k := range []string{"PYTHONPATH", "PYTHONHOME", "LD_PRELOAD", "VOLTRA_SERVER_ROOT"} {
		if env[k] != "" && !(k == "VOLTRA_SERVER_ROOT" && env[k] == "/home/container") {
			return "", refuse
		}
	}
	pins := map[string]string{".voltra/arma-native.py": "2f4110ae0f8cec20900f18c98f02f3ce3ee2ac939f3e0a2a5972c7154ef3e41f", ".voltra/arma3-controls.py": "26d00fa1ef01d0ed29bb0359ef3b19b76492e46888911526adfe247b09f4bac1", ".voltra/bundle-debian-python.py": "16b2ebdcfa2656b591624c9d627defa4c3940be4c8a69d8842778ff25ea0cdc0", ".voltra/native-config.py": "8c125bb526b38896eeba57143ec2fc70bfb94f1c9783e4c6d652d8f57e3b52a2", ".voltra/steam_template.py": "dc8ff0a9e462751878aad55da80bea8fd2a2d4ef16dbf8d37b798ea8d4c476dd"}
	for name, want := range pins {
		b, ok := files[name]
		h := sha256.Sum256(b)
		if !ok || hex.EncodeToString(h[:]) != want {
			return "", refuse
		}
	}
	// Bind all environment authority without disclosing its values in the revision.
	b, _ := json.Marshal(struct {
		Startup, Path string
		Env           map[string]string
		Pins          map[string]string
	}{startup, file, env, pins})
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:]), nil
}
