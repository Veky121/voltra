package panel

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"
)

const solaceSettingsRecipe = "solace_crafting/egg-solace-crafting.json"
const solaceSettingsDocument = "/.config/unity3d/Big Kitty Games/Solace Crafting/servercfg.dat"
const solaceSettingsStartup = "exec python3 .voltra/fantasy_worlds_runtime.py solace"

// Pure authority check. Callers supply freshly read regular, confined helper
// bytes, never a client assertion or a cached authority flag. No I/O here.
func solaceSettingsAuthority(recipe, startup, document string, helpers map[string][]byte) error {
	if recipe != solaceSettingsRecipe || startup != solaceSettingsStartup || document != solaceSettingsDocument {
		return bad("Solace settings authority changed; inspect Runtime and Files.")
	}
	expected := map[string]string{
		"fantasy_worlds_defaults.json":  "30fb27c937ec17abcc60625ddce675b00ca3211a6946e7b59928c9192f3a10ba",
		"fantasy_worlds_install.py":     "e95744b8393f19688ee962d51a2bd082118b829ccbff70934e1dc4acbdfe8069",
		"fantasy_worlds_runtime.py":     "976078401de217c91dc4b6ef5fc2583a27858e79fd8c6d67486dabe014125cdb",
		"fantasy_worlds_wine.py":        "58cf66e18ae38a771627a7ee172127d737f81edd1d2f71f6183d67c9d3fafe04",
		"fantasy_worlds_wine_build.py":  "1442886493052f6f727dead6d8ff4af97fb9960c6e5eca3a53f34e44938fd22b",
		"fantasy_worlds_wine_console.c": "f34023710f0e86b76ea18b5109aeeed199c3cc07ca4580036004fb8225e232b6",
		"native_config.py":              "468a2e9b6cff276687fa9464a30927c4be77c1624a564958ee5d40298ff58051",
		"native_console.py":             "7f0c2a6e4050d12fc3bb2af9dcd723df6b80109fed91a26ccd1ae52d2bb1b3a4",
		"steam_template.py":             "7d908cdc739fbb999fdfb13f48f3e8d3a5fdf26fbfa48091dee1442913078897",
	}
	for name, want := range expected {
		data, ok := helpers[name]
		sum := sha256.Sum256(data)
		if !ok || hex.EncodeToString(sum[:]) != want {
			return bad("Solace installed helper authority changed.")
		}
	}
	return nil
}

// Existing native scalars only. Credentials, ports and world paths remain opaque.
// Shared dispatch must enforce solaceSettingsAuthority before calling this parser.
func parseSolaceSettings(data []byte) (gameSettingsParsed, error) {
	invalid := func() (gameSettingsParsed, error) {
		return gameSettingsParsed{}, bad("Invalid or ambiguous Solace native JSON; inspect Files.")
	}
	if len(data) > 4*1024*1024 || !utf8.Valid(data) || !json.Valid(data) {
		return invalid()
	}
	spans, err := bananaJSONSpans(data)
	if err != nil || !spans[""].object {
		return invalid()
	}
	// Reject case aliases even in unknown objects, without interpreting their values.
	seen := map[string]bool{}
	for key := range spans {
		folded := strings.ToLower(key)
		if seen[folded] {
			return invalid()
		}
		seen[folded] = true
	}
	kinds := map[string]string{"/name": "text", "/description": "text", "/isPrivate": "boolean", "/requireSteamID": "boolean", "/allowAdmin": "boolean", "/allowModerator": "boolean", "/maxPlayers": "number", "/autoRestart": "number"}
	validate := func(key, value string) bool {
		switch kinds[key] {
		case "text":
			if !utf8.ValidString(value) {
				return false
			}
			for _, c := range value {
				if c < 32 || c == 127 {
					return false
				}
			}
			return true
		case "boolean":
			return value == "true" || value == "false"
		case "number":
			if value == "" || (len(value) > 1 && value[0] == '0') {
				return false
			}
			for _, c := range value {
				if c < '0' || c > '9' {
					return false
				}
			}
			n, e := strconv.ParseInt(value, 10, 64)
			if key == "/maxPlayers" {
				return e == nil && n >= 1 && n <= 1024
			}
			return e == nil && n >= 0 && n <= 2147483647
		}
		return false
	}
	parsed := gameSettingsParsed{}
	values := map[string]string{}
	for _, key := range []string{"/name", "/description", "/isPrivate", "/requireSteamID", "/maxPlayers", "/allowAdmin", "/allowModerator", "/autoRestart"} {
		span, ok := spans[key]
		if !ok {
			continue
		}
		raw := data[span.start:span.end]
		value := string(raw)
		if kinds[key] == "text" {
			if len(raw) == 0 || raw[0] != '"' || json.Unmarshal(raw, &value) != nil {
				return invalid()
			}
		}
		if !validate(key, value) {
			return invalid()
		}
		values[key] = value
		parsed.fields = append(parsed.fields, gameSetting{key: key, value: value, kind: kinds[key], on: "true", off: "false"})
	}
	original := append([]byte(nil), data...)
	parsed.patch = func(changes map[string]string) ([]byte, error) {
		keys := []string{}
		for key, value := range changes {
			old, ok := values[key]
			if !ok || !validate(key, value) {
				return nil, bad("Unsupported Solace setting or value.")
			}
			if old != value {
				keys = append(keys, key)
			}
		}
		sort.Slice(keys, func(i, j int) bool { return spans[keys[i]].start > spans[keys[j]].start })
		out := append([]byte(nil), original...)
		for _, key := range keys {
			value := []byte(changes[key])
			if kinds[key] == "text" {
				value, _ = json.Marshal(changes[key])
			}
			span := spans[key]
			next := append([]byte(nil), out[:span.start]...)
			next = append(next, value...)
			out = append(next, out[span.end:]...)
		}
		if len(out) > 4*1024*1024 {
			return nil, bad("Solace configuration too large.")
		}
		return out, nil
	}
	return parsed, nil
}
