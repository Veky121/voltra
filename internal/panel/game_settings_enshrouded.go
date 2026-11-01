package panel

import (
	"bytes"
	"encoding/json"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"
)

const enshroudedSettingsRecipe = "enshrouded/egg-enshrouded.json"
const enshroudedSettingsPath = "/enshrouded_server.json"
const enshroudedSettingsStartup = "exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/enshrouded_runtime.py"

// Deliberately excludes userGroups and gameSettings containers. Their unknown
// schema and nested credentials must never enter generic struct expansion.
var enshroudedSettingKinds = map[string]string{
	"/name": "text", "/slotCount": "number", "/queryPort": "readonly", "/ip": "readonly",
	"/saveDirectory": "readonly", "/logDirectory": "readonly", "/gameSettingsPreset": "text",
	"/enableVoiceChat": "boolean", "/enableTextChat": "boolean", "/voiceChatMode": "text",
}

func enshroudedSettingValue(key, value string) bool {
	if !utf8.ValidString(value) || len(value) > 128 {
		return false
	}
	for _, c := range value {
		if c < 32 || c == 127 {
			return false
		}
	}
	switch key {
	case "/slotCount":
		n, e := strconv.Atoi(value)
		return e == nil && n >= 1 && n <= 16 && strconv.Itoa(n) == value
	case "/enableVoiceChat", "/enableTextChat":
		return value == "true" || value == "false"
	case "/gameSettingsPreset":
		return value == "Default" || value == "Relaxed" || value == "Hard" || value == "Survival" || value == "Custom"
	}
	return true
}

func parseEnshroudedSettings(data []byte) (gameSettingsParsed, error) {
	out := gameSettingsParsed{}
	prefix := []byte{}
	body := append([]byte(nil), data...)
	if bytes.HasPrefix(body, []byte{239, 187, 191}) {
		prefix, body = body[:3], body[3:]
	}
	if len(body) > 8*1024*1024 || !utf8.Valid(body) || !json.Valid(body) {
		return out, bad("Invalid Enshrouded JSON.")
	}
	spans, err := bananaJSONSpans(body)
	if err != nil {
		return out, err
	}
	if !spans[""].object {
		return out, bad("Expected Enshrouded object.")
	}
	fields := map[string]gameSetting{}
	for key, span := range spans {
		for known := range enshroudedSettingKinds {
			if key != known && strings.EqualFold(key, known) {
				return out, bad("Ambiguous Enshrouded key.")
			}
		}
		kind, known := enshroudedSettingKinds[key]
		if !known {
			continue
		}
		raw := body[span.start:span.end]
		value := string(raw)
		if kind == "text" || kind == "readonly" {
			if err := json.Unmarshal(raw, &value); err != nil {
				if key != "/queryPort" {
					return out, bad("Invalid Enshrouded scalar.")
				}
				value = string(raw)
			}
		}
		if kind == "boolean" && value != "true" && value != "false" {
			return out, bad("Invalid Enshrouded boolean.")
		}
		if kind == "number" && !enshroudedSettingValue(key, value) {
			return out, bad("Invalid Enshrouded slots.")
		}
		f := gameSetting{key: key, value: value, kind: kind, on: "true", off: "false"}
		fields[key] = f
		out.fields = append(out.fields, f)
	}
	sort.Slice(out.fields, func(i, j int) bool { return out.fields[i].key < out.fields[j].key })
	out.patch = func(changes map[string]string) ([]byte, error) {
		keys := []string{}
		encoded := map[string][]byte{}
		for key, value := range changes {
			f, ok := fields[key]
			if !ok || f.kind == "readonly" || !enshroudedSettingValue(key, value) {
				return nil, bad("Invalid Enshrouded change.")
			}
			if f.kind == "text" {
				encoded[key], _ = json.Marshal(value)
			} else {
				encoded[key] = []byte(value)
			}
			keys = append(keys, key)
		}
		sort.Slice(keys, func(i, j int) bool { return spans[keys[i]].start > spans[keys[j]].start })
		result := append([]byte(nil), body...)
		for _, key := range keys {
			s := spans[key]
			next := append([]byte(nil), result[:s.start]...)
			next = append(next, encoded[key]...)
			result = append(next, result[s.end:]...)
		}
		return append(append([]byte(nil), prefix...), result...), nil
	}
	return out, nil
}

func enshroudedSettingPresentation(field M) {
	labels := map[string]string{"/name": "Server name", "/slotCount": "Player slots", "/gameSettingsPreset": "Difficulty preset", "/enableVoiceChat": "Voice chat", "/enableTextChat": "Text chat", "/voiceChatMode": "Voice chat mode"}
	if label := labels[str(field["key"])]; label != "" {
		field["label"] = label
	}
	field["group"], field["restart_required"] = "General", true
	if str(field["key"]) == "/slotCount" {
		field["min"], field["max"] = 1, 16
	}
}

// Root supplies confined regular snapshots; no filesystem/process/network work.
func enshroudedSettingsAuthority(recipe, eggStartup string, in settingsAuthorityInput) (settingsPathAuthority, error) {
	refuse := func() (settingsPathAuthority, error) {
		return settingsPathAuthority{}, bad("Unsupported Enshrouded authority.")
	}
	if recipe != enshroudedSettingsRecipe || eggStartup != enshroudedSettingsStartup || in.Startup != eggStartup {
		return refuse()
	}
	for name, digest := range enshroudedSettingsSources {
		if settingsAuthorityHash(in.Files[name]) != digest {
			return refuse()
		}
	}
	data, ok := in.Files["enshrouded_server.json"]
	if !ok {
		return refuse()
	}
	if _, err := parseEnshroudedSettings(data); err != nil {
		return refuse()
	}
	var native struct {
		QueryPort int    `json:"queryPort"`
		Save      string `json:"saveDirectory"`
		Log       string `json:"logDirectory"`
	}
	if json.Unmarshal(bytes.TrimPrefix(data, []byte{239, 187, 191}), &native) != nil {
		return refuse()
	}
	if strconv.Itoa(native.QueryPort) != in.Env["SERVER_PORT"] || native.QueryPort < 1 || native.QueryPort > 65535 {
		return refuse()
	}
	allocated := false
	for _, p := range strings.Split(in.Env["VOLTRA_ALLOCATED_PORTS"], ",") {
		if p == strconv.Itoa(native.QueryPort) {
			allocated = true
		}
	}
	if !allocated {
		return refuse()
	}
	for _, p := range []string{native.Save, native.Log} {
		if p == "" || strings.HasPrefix(p, "/") || strings.ContainsAny(p, "\\:\x00\r\n") {
			return refuse()
		}
		for _, part := range strings.Split(p, "/") {
			if part == ".." {
				return refuse()
			}
		}
	}
	return settingsAuthorityResult(enshroudedSettingsPath, "enshrouded-existing-v1:"+recipe+":"+in.Startup+":"+strconv.Itoa(native.QueryPort)), nil
}

var enshroudedSettingsSources = map[string]string{
	".voltra/steam_template.py":              "7d908cdc739fbb999fdfb13f48f3e8d3a5fdf26fbfa48091dee1442913078897",
	".voltra/native_config.py":               "8c125bb526b38896eeba57143ec2fc70bfb94f1c9783e4c6d652d8f57e3b52a2",
	".voltra/additional_survival_install.py": "a2c9dca09dc86279e0f154a5d1574f6e6e68d4c4260687cf6fffe7003ea55b29",
	".voltra/enshrouded_runtime.py":          "805d5345d9f41fbe4de916b963c7fbd8ac84cf4d60df7e1cf40925b54e1526cb",
	".voltra/enshrouded_proton.py":           "ea0b902e21aea8449b57eaf9f3cfefb8d3334617733a0b1cd48fa30bfb20946e",
	".voltra/bundle_debian_python.py":        "16b2ebdcfa2656b591624c9d627defa4c3940be4c8a69d8842778ff25ea0cdc0",
}
