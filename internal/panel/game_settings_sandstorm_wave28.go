package panel

import (
	"bytes"
	"strings"
	"unicode/utf8"
)

const sandstormSettingsRecipe = "insurgency_sandstorm/egg-insurgency--sandstorm.json"
const sandstormSettingsPath = "/Insurgency/Saved/Config/LinuxServer/Game.ini"

// Publisher Server Admin Guide, General Configuration. Missing keys retain engine
// defaults. No synthetic defaults, numeric limits, credentials or allocation ports.
var sandstormBooleanDefaults = map[string]string{
	"/Script/Insurgency.INSGameMode/bKillFeed":                 "False",
	"/Script/Insurgency.INSGameMode/bKillFeedSpectator":        "True",
	"/Script/Insurgency.INSGameMode/bKillerInfo":               "True",
	"/Script/Insurgency.INSGameMode/bKillerInfoRevealDistance": "False",
	"/Script/Insurgency.INSGameMode/bDeadSay":                  "False",
	"/Script/Insurgency.INSGameMode/bDeadSayTeam":              "True",
	"/Script/Insurgency.INSGameMode/bVoiceAllowDeadChat":       "False",
	"/Script/Insurgency.INSGameMode/bVoiceEnemyHearsLocal":     "True",
}

// Wrap the shared lossless INI scalar editor. Unknown data never becomes editable.
func parseSandstormSettings(data []byte) (gameSettingsParsed, error) {
	out := gameSettingsParsed{fields: []gameSetting{}}
	if len(data) > 8*1024*1024 || !utf8.Valid(data) || bytes.ContainsRune(data, 0) {
		return out, bad("Invalid Sandstorm INI")
	}
	// Strip only the BOM for parsing, then restore it byte-for-byte after patching.
	bom := bytes.HasPrefix(data, []byte{239, 187, 191})
	body := data
	if bom {
		body = data[3:]
	}
	// Case aliases, duplicate sections and Unreal array operators on managed keys
	// can change effective values; refuse rather than select an arbitrary row.
	section := ""
	seen := map[string]bool{}
	sections := map[string]bool{}
	for _, line := range strings.Split(string(body), "\n") {
		t := strings.TrimSpace(line)
		if t == "" || strings.HasPrefix(t, ";") || strings.HasPrefix(t, "#") {
			continue
		}
		if strings.HasPrefix(t, "[") {
			if !strings.HasSuffix(t, "]") {
				return out, bad("Ambiguous Sandstorm section")
			}
			section = t[1 : len(t)-1]
			if strings.EqualFold(section, "/Script/Insurgency.INSGameMode") {
				if section != "/Script/Insurgency.INSGameMode" || sections[section] {
					return out, bad("Ambiguous Sandstorm section")
				}
				sections[section] = true
			}
			continue
		}
		name, _, ok := strings.Cut(t, "=")
		if !ok {
			continue
		}
		name = strings.TrimSpace(name)
		for key := range sandstormBooleanDefaults {
			candidate := section + "/" + strings.TrimLeft(name, "+-!.")
			if strings.EqualFold(candidate, key) {
				if candidate != key || strings.ContainsAny(name, "+-!.") || seen[key] {
					return out, bad("Ambiguous Sandstorm boolean")
				}
				seen[key] = true
			}
		}
	}
	base, err := parseGameSettingsLines(sandstormSettingsPath, body)
	if err != nil {
		return out, err
	}
	allowed := map[string]bool{}
	for _, f := range base.fields {
		if _, ok := sandstormBooleanDefaults[f.key]; !ok {
			continue
		}
		if f.kind == "readonly" || (f.value != "True" && f.value != "False" && f.value != "true" && f.value != "false") {
			return out, bad("Invalid Sandstorm boolean")
		}
		f.kind = "boolean"
		f.on = "True"
		f.off = "False"
		allowed[f.key] = true
		out.fields = append(out.fields, f)
	}
	out.patch = func(changes map[string]string) ([]byte, error) {
		for k, v := range changes {
			if !allowed[k] || (v != "True" && v != "False" && v != "true" && v != "false") {
				return nil, bad("Unsupported Sandstorm change")
			}
		}
		b, e := base.patch(changes)
		if e != nil {
			return nil, e
		}
		if bom {
			b = append([]byte{239, 187, 191}, b...)
		}
		return b, nil
	}
	return out, nil
}

// Root must call before discovery/read/write, using the effective launch and
// actual Wings config mappings. Plugin switches alone do not revoke authority.
func validateSandstormSettingsAuthority(recipe, file, startup, extra string, mappings M) error {
	if recipe != sandstormSettingsRecipe || file != sandstormSettingsPath || startup != "exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/tactical_runtime.py" {
		return bad("Unreviewed Sandstorm launch or path")
	}
	for path := range mappings {
		if strings.EqualFold(strings.TrimPrefix(path, "/"), strings.TrimPrefix(file, "/")) {
			return bad("Game.ini is managed by Wings")
		}
	}
	for _, token := range strings.Fields(strings.ToLower(extra)) {
		if strings.ContainsAny(token, "?\\\"'\n\r") || strings.HasPrefix(token, "-ini") || strings.HasPrefix(token, "-gameini") || strings.HasPrefix(token, "-userdir") || strings.HasPrefix(token, "-savedir") || strings.HasPrefix(token, "-execcmds") || strings.HasPrefix(token, "-basedir") {
			return bad("Sandstorm config override needs Files")
		}
	}
	return nil
}

func sandstormSettingPresentation(field M) {
	key := str(field["key"])
	if _, ok := sandstormBooleanDefaults[key]; ok {
		name := key[strings.LastIndex(key, "/")+1:]
		field["label"] = strings.TrimPrefix(name, "b")
		field["group"] = "General"
		field["restart_required"] = true
	}
}
