package panel

import (
	"bytes"
	"encoding/json"
	"sort"
	"strings"
	"unicode/utf8"
)

const romesteadSettingsRecipe = "romestead/egg-romestead.json"
const romesteadSettingsPath = "/config.json"
const romesteadSettingsStartup = "exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/crafting_runtime.py"

// Deliberately excludes userGroups and gameSettings containers. Their unknown
// schema and nested credentials must never enter generic struct expansion.
var romesteadSettingKinds = map[string]string{
	"/AutoCreateAndLoadWorld": "boolean", "/EnableCheats": "boolean",
	"/AutoStartWorldName": "readonly", "/AutoCreateWorldSize": "readonly",
	"/Password": "readonly", "/Port": "readonly", "/MaxPlayers": "readonly",
}

func romesteadSettingValue(key, value string) bool {
	return (key == "/AutoCreateAndLoadWorld" || key == "/EnableCheats") && (value == "true" || value == "false")
}

func parseRomesteadSettings(data []byte) (gameSettingsParsed, error) {
	out := gameSettingsParsed{}
	prefix := []byte{}
	body := append([]byte(nil), data...)
	if bytes.HasPrefix(body, []byte{239, 187, 191}) {
		prefix, body = body[:3], body[3:]
	}
	if len(body) > 8*1024*1024 || !utf8.Valid(body) || !json.Valid(body) {
		return out, bad("Invalid Romestead JSON.")
	}
	spans, err := bananaJSONSpans(body)
	if err != nil {
		return out, err
	}
	if !spans[""].object {
		return out, bad("Expected Romestead object.")
	}
	fields := map[string]gameSetting{}
	for key, span := range spans {
		for known := range romesteadSettingKinds {
			if key != known && strings.EqualFold(key, known) {
				return out, bad("Ambiguous Romestead key.")
			}
		}
		kind, known := romesteadSettingKinds[key]
		if !known {
			continue
		}
		raw := body[span.start:span.end]
		value := string(raw)
		if kind == "text" || kind == "readonly" {
			if err := json.Unmarshal(raw, &value); err != nil {
				if key == "/Password" || key == "/AutoStartWorldName" {
					return out, bad("Invalid Romestead scalar.")
				}
				value = string(raw)
			}
		}
		if kind == "boolean" && value != "true" && value != "false" {
			return out, bad("Invalid Romestead boolean.")
		}
		if kind == "number" && !romesteadSettingValue(key, value) {
			return out, bad("Invalid Romestead slots.")
		}
		f := gameSetting{key: key, value: value, kind: kind, on: "true", off: "false", secret: key == "/Password"}
		if f.secret {
			f.value = ""
		}
		fields[key] = f
		out.fields = append(out.fields, f)
	}
	sort.Slice(out.fields, func(i, j int) bool { return out.fields[i].key < out.fields[j].key })
	out.patch = func(changes map[string]string) ([]byte, error) {
		keys := []string{}
		encoded := map[string][]byte{}
		for key, value := range changes {
			f, ok := fields[key]
			if !ok || f.kind == "readonly" || !romesteadSettingValue(key, value) {
				return nil, bad("Invalid Romestead change.")
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

func romesteadSettingPresentation(field M) {
	field["group"], field["restart_required"] = "General", true
	labels := map[string]string{"/EnableCheats": "Enable cheats", "/AutoCreateAndLoadWorld": "Automatically create and load world"}
	if label := labels[str(field["key"])]; label != "" {
		field["label"] = label
	}
}

// Pure snapshot validation only. Root must bound and confine reads, reject
// mappings, and repeat RBAC/state/revision checks under the publication lock.
func romesteadSettingsAuthority(recipe, eggStartup string, in settingsAuthorityInput) (settingsPathAuthority, error) {
	refuse := func() (settingsPathAuthority, error) {
		return settingsPathAuthority{}, bad("Unsupported Romestead authority.")
	}
	if recipe != romesteadSettingsRecipe || eggStartup != romesteadSettingsStartup || in.Startup != eggStartup {
		return refuse()
	}
	for _, key := range []string{"PYTHONPATH", "LD_PRELOAD", "EXTRA_ARGS", "ADDITIONAL_ARGS"} {
		if in.Env[key] != "" {
			return refuse()
		}
	}
	if in.Env["VOLTRA_CRAFTING"] != "romestead" || in.Env["SRCDS_APPID"] != "4763510" || (in.Env["WINDOWS_INSTALL"] != "" && in.Env["WINDOWS_INSTALL"] != "0") {
		return refuse()
	}
	for name, digest := range romesteadSettingsSources {
		if settingsAuthorityHash(in.Files[name]) != digest {
			return refuse()
		}
	}
	data, ok := in.Files["config.json"]
	if !ok {
		return refuse()
	}
	if _, err := parseRomesteadSettings(data); err != nil {
		return refuse()
	}
	return settingsPathAuthority{Path: romesteadSettingsPath, Revision: settingsAuthorityHash(data)}, nil
}

var romesteadSettingsSources = map[string]string{
	".voltra/steam_template.py":       "dc8ff0a9e462751878aad55da80bea8fd2a2d4ef16dbf8d37b798ea8d4c476dd",
	".voltra/native_config.py":        "8c125bb526b38896eeba57143ec2fc70bfb94f1c9783e4c6d652d8f57e3b52a2",
	".voltra/native_console.py":       "e8274872cb9ccbf7c60bca3615aed0d200c66bc28dc54b7fdd3b243070f9f3e5",
	".voltra/bundle_debian_python.py": "16b2ebdcfa2656b591624c9d627defa4c3940be4c8a69d8842778ff25ea0cdc0",
	".voltra/source_install.py":       "a1f63dd97984ed20dba5b5af6fddfaff5efdd15f7666231b32728da0c5f54a13",
	".voltra/source_next_install.py":  "ab8c1f51facbb540191bbb9904a8aae7479cf3804d5c71726a96c0819ff0a70e",
	".voltra/tactical_install.py":     "bf5b741881a20faf82a0fb53800abac90b9c4b32b4ba19198879579fee6f120e",
	".voltra/tactical_runtime.py":     "d0b95c6ae327dbdb7dc298141eddd9eba288693b91a3369b3dc120b3cd399578",
	".voltra/crafting_install.py":     "c5f860893e48c85e03f8a210c5a356af580898000e09541bb8647e09b2326024",
	".voltra/crafting_runtime.py":     "a3067120ca3edf5c4d28935c43fa05f083608a118efa3c23a6be6e1cb58582b8",
}
