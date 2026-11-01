package panel

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"strconv"
	"strings"
	"unicode/utf8"
)

const starboundAuthorityRecipe = "starbound/egg-starbound.json"
const starboundAuthorityStartup = "exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/starbound_runtime.py"
const starboundAuthorityRuntimeSHA256 = "bb9a15b5a85ca10c6be7ea92095645ee367072a279281bf2d9b1e5337d5709e8"

// Observations bind the reviewed adapter and boot bytes using supported confined
// Wings reads. Interpreter/import attestation is outside this source contract.
type starboundAuthorityInput struct {
	Recipe, Startup, EggStartup, RuntimeSHA256 string
	Environment                                map[string]string // effective environment after server overrides
	BootState                                  string            // absent, regular, unsafe; unsafe includes symlink components
	Boot                                       []byte
	ConfigOverwrites                           bool // any Wings startup rewrite of boot or target document
}

type starboundAuthorityBinding struct {
	Path   string
	Digest string
}

type starboundAuthorityError string

func (e starboundAuthorityError) Error() string { return string(e) }

// starboundActiveConfigAuthority performs no I/O or mutation. It authorizes only
// the reviewed adapter's source contract, not native consumption or write access.
func starboundActiveConfigAuthority(in starboundAuthorityInput) (starboundAuthorityBinding, error) {
	deny := func(reason string) (starboundAuthorityBinding, error) {
		return starboundAuthorityBinding{}, starboundAuthorityError(reason)
	}
	if in.Recipe != starboundAuthorityRecipe || in.Startup != starboundAuthorityStartup || in.EggStartup != starboundAuthorityStartup {
		return deny("launcher")
	}
	if in.RuntimeSHA256 != starboundAuthorityRuntimeSHA256 || in.ConfigOverwrites {
		return deny("launcher_unattested")
	}
	// Mirror preflight defaults only for launch validity, never seed gameplay.
	for _, rule := range []struct {
		key, fallback string
		allowed       []string
	}{
		{"WORKSHOP", "0", []string{"0", "1"}}, {"AUTO_UPDATE", "1", []string{"0", "1"}},
		{"VOLTRA_STEAM_AUTO_UPDATE", "0", []string{"0", "1"}}, {"VALIDATE", "false", []string{"true", "false"}},
		{"SRCDS_APPID", "211820", []string{"211820"}},
	} {
		v, ok := in.Environment[rule.key]
		if !ok {
			v = rule.fallback
		}
		valid := false
		for _, allowed := range rule.allowed {
			if v == allowed {
				valid = true
			}
		}
		if !valid {
			return deny("environment")
		}
	}
	// Automatic installation could replace the attested runtime or boot file.
	if in.Environment["VOLTRA_STEAM_AUTO_UPDATE"] == "1" {
		return deny("update_precedence")
	}
	port := in.Environment["SERVER_PORT"]
	if _, ok := in.Environment["SERVER_PORT"]; !ok {
		port = "21025"
	}
	validPort := func(s string) bool {
		if len(s) < 1 || len(s) > 5 {
			return false
		}
		for _, c := range s {
			if c < '0' || c > '9' {
				return false
			}
		}
		n, err := strconv.Atoi(s)
		return err == nil && n > 0 && n <= 65535
	}
	if !validPort(port) {
		return deny("environment")
	}
	allocated := false
	for _, s := range strings.Split(in.Environment["VOLTRA_ALLOCATED_PORTS"], ",") {
		if !validPort(s) {
			return deny("environment")
		}
		n, _ := strconv.Atoi(s)
		p, _ := strconv.Atoi(port)
		if n == p {
			allocated = true
		}
	}
	if !allocated {
		return deny("environment")
	}
	switch in.BootState {
	case "absent":
		return deny("boot_absent")
	case "regular":
	default:
		return deny("boot_unsafe")
	}
	if len(in.Boot) > 8*1024*1024 || !utf8.Valid(in.Boot) {
		return deny("boot_malformed")
	}
	// Token walk rejects duplicate keys at every depth, matching Python unique().
	d := json.NewDecoder(bytes.NewReader(in.Boot))
	d.UseNumber()
	var walk func(int) (any, error)
	walk = func(depth int) (any, error) {
		if depth > 128 {
			return nil, fmt.Errorf("depth")
		}
		token, err := d.Token()
		if err != nil {
			return nil, err
		}
		switch token {
		case json.Delim('{'):
			values := map[string]any{}
			seen := map[string]bool{}
			for d.More() {
				k, e := d.Token()
				if e != nil {
					return nil, e
				}
				key, ok := k.(string)
				if !ok {
					return nil, fmt.Errorf("key")
				}
				// Conservative Unicode policy avoids differences with Python casefold.
				for _, c := range key {
					if c > 127 {
						return nil, starboundAuthorityError("boot_ambiguous")
					}
				}
				folded := strings.ToLower(key)
				if seen[folded] {
					return nil, starboundAuthorityError("boot_duplicate")
				}
				seen[folded] = true
				v, e := walk(depth + 1)
				if e != nil {
					return nil, e
				}
				values[key] = v
			}
			_, err = d.Token()
			return values, err
		case json.Delim('['):
			for d.More() {
				if _, e := walk(depth + 1); e != nil {
					return nil, e
				}
			}
			_, err = d.Token()
			return nil, err
		}
		return token, nil
	}
	v, err := walk(0)
	if err != nil {
		if code, ok := err.(starboundAuthorityError); ok {
			return deny(string(code))
		}
		return deny("boot_malformed")
	}
	if _, err = d.Token(); err != io.EOF {
		return deny("boot_malformed")
	}
	root, ok := v.(map[string]any)
	if !ok {
		return deny("boot_malformed")
	}
	storage, ok := root["storageDirectory"]
	if !ok {
		return deny("storage_absent")
	}
	s, ok := storage.(string)
	if !ok {
		return deny("storage_type")
	}
	if s != "storage" {
		return deny("storage_custom")
	}
	// Marshal sorts environment keys and includes exact boot bytes. No raw env or
	// boot content is returned or included in diagnostics.
	encoded, _ := json.Marshal(in)
	sum := sha256.Sum256(encoded)
	return starboundAuthorityBinding{Path: "/storage/starbound_server.config", Digest: hex.EncodeToString(sum[:])}, nil
}
