package panel

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"
)

const vrisingSettingsRecipe = "v_rising/v_rising_vanilla/egg-v-rising.json"
const vrisingHostSettingsPath = "/save-data/Settings/ServerHostSettings.json"
const vrisingSettingsStartup = "exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/vrising_runtime.py"

// Pure source validation, never process attestation. Root must read regular,
// confined files again under the save lock and enforce RBAC/state/revision.
func vrisingSettingsAuthority(recipe, startup, file, variant string, helpers map[string][]byte) error {
	if recipe != vrisingSettingsRecipe || startup != vrisingSettingsStartup || file != vrisingHostSettingsPath || variant != "vanilla" {
		return bad("Unsupported V Rising launcher or document.")
	}
	for name, pin := range vrisingSettingsPins {
		data, ok := helpers[name]
		if !ok || fmt.Sprintf("%x", sha256.Sum256(data)) != pin {
			return bad("V Rising helper source differs from reviewed bytes.")
		}
	}
	return nil
}

// The current vanilla launcher seeds these host fields but existing JSON wins.
// Password, Rcon and unknown nested objects/arrays remain completely opaque.
func vrisingSettingKind(key string) string {
	switch key {
	case "/Name", "/Description":
		return "text"
	case "/MaxConnectedUsers", "/MaxConnectedAdmins", "/ServerFps", "/AutoSaveCount", "/AutoSaveInterval", "/LowerFpsWhenEmptyValue":
		return "number"
	case "/Secure", "/ListOnSteam", "/ListOnEOS", "/HideIPAddress", "/LowerFpsWhenEmpty":
		return "boolean"
	case "/Port", "/QueryPort", "/Address", "/SaveName", "/GameSettingsPreset", "/GameDifficultyPreset":
		return "readonly"
	}
	return ""
}
func vrisingSettingValid(key, value string) bool {
	switch vrisingSettingKind(key) {
	case "text":
		maximum := 4096
		if key == "/Name" {
			maximum = 128
		}
		return utf8.ValidString(value) && len(value) <= maximum && !strings.ContainsFunc(value, func(r rune) bool { return r < 32 || r == 127 })
	case "boolean":
		return value == "true" || value == "false"
	case "number":
		n, e := strconv.ParseInt(value, 10, 32)
		if e != nil || !json.Valid([]byte(value)) {
			return false
		}
		minimum, maximum := int64(0), int64(2147483647)
		switch key {
		case "/MaxConnectedUsers":
			minimum, maximum = 1, 128
		case "/MaxConnectedAdmins":
			maximum = 128
		case "/ServerFps", "/LowerFpsWhenEmptyValue":
			minimum, maximum = 1, 1000
		case "/AutoSaveInterval":
			minimum = 1
		}
		return n >= minimum && n <= maximum
	}
	return false
}
func parseVrisingSettings(file string, data []byte) (gameSettingsParsed, error) {
	invalid := func() (gameSettingsParsed, error) {
		return gameSettingsParsed{}, bad("Invalid or ambiguous V Rising host JSON.")
	}
	if file != vrisingHostSettingsPath || len(data) > 4*1024*1024 || !utf8.Valid(data) {
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
	out := gameSettingsParsed{}
	allowed := map[string]bananaJSONSpan{}
	keys := []string{}
	for key := range spans {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		// Reject case aliases even for unknown fields; never select an ambiguous key.
		for _, other := range keys {
			if key != other && strings.EqualFold(key, other) {
				return invalid()
			}
		}
		kind := vrisingSettingKind(key)
		if kind == "" {
			continue
		}
		span := spans[key]
		value := string(body[span.start:span.end])
		if kind == "text" {
			if body[span.start] != '"' || json.Unmarshal(body[span.start:span.end], &value) != nil {
				continue
			}
		}
		if kind != "readonly" && !vrisingSettingValid(key, value) {
			continue
		}
		out.fields = append(out.fields, gameSetting{key: key, value: value, kind: kind, on: "true", off: "false"})
		if kind != "readonly" {
			allowed[key] = span
		}
	}
	original := bytes.Clone(data)
	out.patch = func(changes map[string]string) ([]byte, error) {
		edits := []string{}
		for key, value := range changes {
			if _, ok := allowed[key]; !ok || !vrisingSettingValid(key, value) {
				return nil, bad("Unsupported V Rising host change.")
			}
			edits = append(edits, key)
		}
		sort.Slice(edits, func(i, j int) bool { return allowed[edits[i]].start > allowed[edits[j]].start })
		result := bytes.Clone(original)
		for _, key := range edits {
			value := []byte(changes[key])
			if vrisingSettingKind(key) == "text" {
				value, _ = json.Marshal(changes[key])
			}
			span := allowed[key]
			next := append([]byte(nil), result[:prefix+span.start]...)
			next = append(next, value...)
			result = append(next, result[prefix+span.end:]...)
		}
		return result, nil
	}
	return out, nil
}
func vrisingSettingPresentation(field M) {
	key := str(field["key"])
	if vrisingSettingKind(key) == "" {
		return
	}
	field["label"] = strings.TrimPrefix(key, "/")
	field["group"] = "General"
	field["help"] = "Existing native host value; restart required."
	if vrisingSettingKind(key) == "readonly" {
		field["readOnly"] = true
		field["group"] = "Runtime"
	}
}

var vrisingSettingsPins = map[string]string{
	".voltra/steam_template.py":          "7d908cdc739fbb999fdfb13f48f3e8d3a5fdf26fbfa48091dee1442913078897",
	".voltra/bundle_debian_python.py":    "16b2ebdcfa2656b591624c9d627defa4c3940be4c8a69d8842778ff25ea0cdc0",
	".voltra/native_config.py":           "8c125bb526b38896eeba57143ec2fc70bfb94f1c9783e4c6d652d8f57e3b52a2",
	".voltra/valheim_vrising_install.py": "76ab12fd1c94920a2bf2b5893dcf122645eb0a3563152978cfb1a2a0e300fe26",
	".voltra/enshrouded_proton.py":       "b204044a0cb0dc250c46450410a49fcecabfb2c5581ba2f7dd9c99d86e961a26",
	".voltra/vrising_runtime.py":         "965bfb3f3ca491d282444254001ffd2d3978fa5e675d0631905e22b6313c88a0",
}
