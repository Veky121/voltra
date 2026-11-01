package panel

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"
)

const rimworldStartupPrefix = "exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/sonic_rimworld.py run "

func rimworldDialect(recipe, file string) string {
	switch {
	case recipe == "rimworld/open_world/egg-rimworld-open-world.json" && file == "/Data/Config.json":
		return "openworld"
	case recipe == "rimworld/together/egg-rimworld-together.json" && file == "/Configs/ServerConfig.json":
		return "together"
	}
	return ""
}

// Pure authority gate. reviewed must come from the canonical emitted installer,
// never from untrusted request data. Root verifies regular confined files and
// allocation/environment authority under lock before and after patching.
func rimworldSettingsAuthority(recipe, file, startup, eggStartup string, mappings int, installed map[string][]byte, reviewed map[string]string) bool {
	game := rimworldDialect(recipe, file)
	if game == "" || startup != rimworldStartupPrefix+game || eggStartup != startup || mappings != 0 {
		return false
	}
	for _, p := range []string{".voltra/sonic_rimworld.py", ".voltra/native_console.py", ".voltra/steam_template.py", ".voltra/additional_survival_install.py"} {
		if len(reviewed[p]) != 64 {
			return false
		}
	}
	for p, digest := range reviewed {
		data, ok := installed[p]
		if !ok || len(digest) != 64 {
			return false
		}
		sum := sha256.Sum256(data)
		if hex.EncodeToString(sum[:]) != digest {
			return false
		}
	}
	return true
}

// These separate dialect maps cover only scalars explicitly consumed by configure.
// Protocol version and allocation/safety controls remain read-only.
func rimworldSettingKind(game, key, value string) string {
	if game == "openworld" {
		switch key {
		case "/EnforceMods", "/UseModBlacklist", "/UseCustomDifficulty", "/UseWhitelist", "/AllowCustomScenarios":
			if value == "true" || value == "false" {
				return "boolean"
			}
		case "/MaxPlayers":
			if rimworldInteger(value, 1, 1000) {
				return "number"
			}
		}
	}
	if game == "together" {
		switch key {
		case "/EnableServerBrowser", "/EnableServerTelemetry":
			if value == "true" || value == "false" {
				return "boolean"
			}
		case "/MaxPlayers":
			if rimworldInteger(value, 1, 150) {
				return "number"
			}
		case "/Verbosity":
			if value == "0" || value == "2" {
				return "number"
			}
		case "/Name":
			if utf8.ValidString(value) && len(value) <= 128 && bananaSettingsText(value, 128) {
				return "text"
			}
		}
	}
	return "readonly"
}
func rimworldInteger(value string, min, max int) bool {
	n, e := strconv.Atoi(value)
	return e == nil && n >= min && n <= max && strconv.Itoa(n) == value
}

// Reuse the existing JSON span scanner, not the generic JSON reserializer.
// No insertion, unknown field expansion, secret edit or numeric normalization.
func parseRimworldSettings(recipe, file string, data []byte) (gameSettingsParsed, error) {
	out := gameSettingsParsed{}
	game := rimworldDialect(recipe, file)
	invalid := func() (gameSettingsParsed, error) { return out, bad("Invalid or ambiguous RimWorld configuration.") }
	if game == "" || len(data) > 4*1024*1024 || !utf8.Valid(data) {
		return invalid()
	}
	prefix := 0
	if bytes.HasPrefix(data, []byte{239, 187, 191}) {
		prefix = 3
	}
	body := data[prefix:]
	if !json.Valid(body) {
		return invalid()
	}
	spans, err := bananaJSONSpans(body)
	if err != nil || !spans[""].object {
		return invalid()
	}
	seen := map[string]bool{}
	for key := range spans {
		folded := strings.ToLower(key)
		if seen[folded] {
			return invalid()
		}
		seen[folded] = true
	}
	fields := map[string]gameSetting{}
	for key, span := range spans {
		if key == "" || strings.Count(key, "/") != 1 {
			continue
		}
		raw := body[span.start:span.end]
		value := string(raw)
		var s string
		isString := json.Unmarshal(raw, &s) == nil
		if isString {
			value = s
		}
		kind := rimworldSettingKind(game, key, value)
		if kind == "text" && !isString || kind != "text" && isString {
			kind = "readonly"
		}
		secret := gameSettingSecret.MatchString(key)
		if secret || span.object || len(raw) > 0 && raw[0] == '[' {
			kind = "readonly"
			value = ""
		}
		f := gameSetting{key: key, value: value, kind: kind, secret: secret, on: "true", off: "false"}
		if secret {
			f.value = ""
		}
		fields[key] = f
		out.fields = append(out.fields, f)
	}
	sort.Slice(out.fields, func(i, j int) bool { return out.fields[i].key < out.fields[j].key })
	out.patch = func(changes map[string]string) ([]byte, error) {
		type edit struct {
			start, end int
			data       []byte
		}
		edits := []edit{}
		for key, value := range changes {
			f, ok := fields[key]
			if !ok || f.secret || f.kind == "readonly" || rimworldSettingKind(game, key, value) != f.kind {
				return nil, bad("Unsupported RimWorld setting or value.")
			}
			if value == f.value {
				continue
			}
			encoded := []byte(value)
			if f.kind == "text" {
				encoded, _ = json.Marshal(value)
			}
			span := spans[key]
			edits = append(edits, edit{prefix + span.start, prefix + span.end, encoded})
		}
		sort.Slice(edits, func(i, j int) bool { return edits[i].start > edits[j].start })
		result := append([]byte(nil), data...)
		for _, e := range edits {
			result = append(result[:e.start], append(e.data, result[e.end:]...)...)
		}
		return result, nil
	}
	return out, nil
}
