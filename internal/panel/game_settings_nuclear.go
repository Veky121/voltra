package panel

import (
	"bytes"
	"encoding/json"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"
)

const nuclearSettingsPath = "/DedicatedServerConfig.json"
const nuclearAuthorityStartup = "exec python3 .voltra/light_games_next_runtime.py nuclear"
const nuclearRecipe = "nuclear_option/egg-nuclear-option.json"

// Explicit wave63 pending proposal. Pins omit the emitted terminal newline;
// installed snapshots are separately checked against exact canonical/proposal bytes.
var nuclearAuthoritySources = map[string]string{
	".voltra/light_games_next_runtime.py": "81a19e974f503c2945a16faeea9e15e126fceed7867a3760cc23a198e82a8c94",
	".voltra/light_games_next_install.py": "467505671b11e12f601ef26a69522b2385e0883c3c3b7c94c67f399856930e47",
	".voltra/native_config.py":            "468a2e9b6cff276687fa9464a30927c4be77c1624a564958ee5d40298ff58051",
	".voltra/native_console.py":           "7f0c2a6e4050d12fc3bb2af9dcd723df6b80109fed91a26ccd1ae52d2bb1b3a4",
	".voltra/steam_template.py":           "7d908cdc739fbb999fdfb13f48f3e8d3a5fdf26fbfa48091dee1442913078897",
}

// Caller provides complete confined regular-file snapshots and authoritative
// environment/startup, re-reading after the write lock and before publication.
// This pure check neither grants permission nor attests native consumption.
func nuclearSettingsAuthority(recipe, eggStartup string, in settingsAuthorityInput) (settingsPathAuthority, error) {
	refuse := bad("Nuclear settings authority changed or is unsupported.")
	if recipe != nuclearRecipe || eggStartup != nuclearAuthorityStartup || in.Startup != eggStartup {
		return settingsPathAuthority{}, refuse
	}
	for name, hash := range nuclearAuthoritySources {
		data, ok := in.Files[name]
		if !ok || settingsAuthorityHash(data) != hash {
			return settingsPathAuthority{}, refuse
		}
	}
	for key, value := range in.Env {
		if value != "" && (strings.HasPrefix(key, "PYTHON") || strings.HasPrefix(key, "LD_") || key == "BASH_ENV" || key == "ENV") {
			return settingsPathAuthority{}, refuse
		}
	}
	data, ok := in.Files[strings.TrimPrefix(nuclearSettingsPath, "/")]
	if !ok {
		return settingsPathAuthority{}, refuse
	}
	if _, err := parseNuclearSettings(data); err != nil {
		return settingsPathAuthority{}, err
	}
	return settingsAuthorityResult(nuclearSettingsPath, "wave63-nuclear:"+in.Startup), nil
}

// Only publisher-documented existing scalars are typed. No defaults are added.
// JSON comments are invalid and refused without writes. Unknown spans, numbers,
// whitespace and line endings are copied verbatim; secrets never leave fields.
func parseNuclearSettings(data []byte) (gameSettingsParsed, error) {
	refuse := bad("Invalid, ambiguous or unsupported Nuclear native settings.")
	out := gameSettingsParsed{}
	if len(data) > 4*1024*1024 || !utf8.Valid(data) || !json.Valid(data) {
		return out, refuse
	}
	spans, err := bananaJSONSpans(data)
	if err != nil || !spans[""].object {
		return out, refuse
	}
	seen := map[string]bool{}
	kinds := map[string]string{"/ServerName": "text", "/Password": "text", "/MaxPlayers": "number", "/ModdedServer": "boolean", "/Port": "readonly", "/QueryPort": "readonly", "/MissionDirectory": "readonly", "/BanListPaths": "readonly", "/MissionRotation": "readonly", "/NoPlayerStopTime": "readonly", "/RotationType": "readonly"}
	for pointer := range spans {
		lower := strings.ToLower(pointer)
		if seen[lower] {
			return out, refuse
		}
		seen[lower] = true
		for key := range kinds {
			if strings.EqualFold(key, pointer) && key != pointer {
				return out, refuse
			}
		}
	}
	valid := func(key, value string) bool {
		switch key {
		case "/ServerName":
			return bananaSettingsText(value, 30)
		case "/Password":
			return bananaSettingsText(value, 200)
		case "/ModdedServer":
			return value == "true" || value == "false"
		case "/MaxPlayers":
			n, e := strconv.Atoi(value)
			return e == nil && n >= 1 && n <= 1024 && strconv.Itoa(n) == value
		}
		return false
	}
	keys := []string{}
	for key := range kinds {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		span, ok := spans[key]
		if !ok {
			continue
		}
		kind := kinds[key]
		value := string(data[span.start:span.end])
		if kind == "text" {
			var s string
			if json.Unmarshal([]byte(value), &s) != nil {
				return gameSettingsParsed{}, refuse
			}
			value = s
		}
		if kind != "readonly" && !valid(key, value) {
			return gameSettingsParsed{}, refuse
		}
		f := gameSetting{key: key, kind: kind, value: value, on: "true", off: "false", secret: key == "/Password"}
		if f.secret || kind == "readonly" {
			f.value = ""
		}
		out.fields = append(out.fields, f)
	}
	original := bytes.Clone(data)
	out.patch = func(changes map[string]string) ([]byte, error) {
		type edit struct {
			start, end int
			value      string
		}
		edits := []edit{}
		for key, value := range changes {
			span, ok := spans[key]
			if !ok || !valid(key, value) {
				return nil, refuse
			}
			if kinds[key] == "text" {
				var previous string
				if json.Unmarshal(original[span.start:span.end], &previous) == nil && previous == value {
					continue
				}
				encoded, _ := json.Marshal(value)
				value = string(encoded)
			}
			if value == string(original[span.start:span.end]) {
				continue
			}
			edits = append(edits, edit{span.start, span.end, value})
		}
		sort.Slice(edits, func(i, j int) bool { return edits[i].start > edits[j].start })
		next := bytes.Clone(original)
		for _, e := range edits {
			next = append(append(append([]byte{}, next[:e.start]...), []byte(e.value)...), next[e.end:]...)
		}
		if _, err := parseNuclearSettings(next); err != nil {
			return nil, err
		}
		return next, nil
	}
	return out, nil
}
