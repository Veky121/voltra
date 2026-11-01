package panel

import (
	"strconv"
	"strings"
	"unicode/utf8"
)

const kf2SettingsRecipe = "killing_floor_2/egg-killing-floor2.json"
const kf2SettingsGamePath = "/KFGame/Config/LinuxServer-KFGame.ini"
const kf2SettingsWebPath = "/KFGame/Config/KFWeb.ini"
const kf2SettingsStartup = "exec python3 .voltra/session_servers_runtime.py kf2"

// kf2SettingsDocument selects only the two files read by kf2_plan. Authority
// over startup and installed emitted modules must be established by the caller.
func kf2SettingsDocument(file string) bool {
	return file == kf2SettingsGamePath || file == kf2SettingsWebPath
}

func kf2SettingsKeys(file string) map[string]string {
	if file == kf2SettingsGamePath {
		return map[string]string{"Engine.AccessControl/AdminPassword": "text", "Engine.GameReplicationInfo/ServerName": "text"}
	}
	if file == kf2SettingsWebPath {
		return map[string]string{"IpDrv.WebServer/bEnabled": "boolean", "IpDrv.WebServer/ListenPort": "readonly"}
	}
	return nil
}

func kf2SettingsValue(key, value string) bool {
	if !utf8.ValidString(value) || strings.TrimSpace(value) != value || strings.ContainsAny(value, "\x00\r\n\"';#()") || strings.IndexFunc(value, func(r rune) bool { return r < 32 || r == 127 }) >= 0 {
		return false
	}
	switch key {
	case "Engine.AccessControl/AdminPassword", "Engine.GameReplicationInfo/ServerName":
		return true
	case "IpDrv.WebServer/bEnabled":
		return strings.EqualFold(value, "true") || strings.EqualFold(value, "false")
	case "IpDrv.WebServer/ListenPort":
		n, e := strconv.Atoi(value)
		return e == nil && n >= 1025 && n <= 65535 && strconv.Itoa(n) == value
	}
	return false
}

// parseKF2Settings reuses the INI span editor without expanding unreviewed
// structs. Only existing launcher-reviewed scalar identities are editable.
// Unknown tuples and values remain opaque and hidden, including nested secrets.
func parseKF2Settings(file string, data []byte) (gameSettingsParsed, error) {
	allowed := kf2SettingsKeys(file)
	if allowed == nil || !utf8.Valid(data) {
		return gameSettingsParsed{}, bad("Unsupported KF2 document.")
	}
	// The generic line editor does not interpret a BOM as section syntax.
	// Refuse rather than grant authority over a misidentified first section.
	if strings.HasPrefix(string(data), "\ufeff") {
		return gameSettingsParsed{}, bad("KF2 BOM document requires review in Files.")
	}
	p, err := parseGameSettingsLines(file, data)
	if err != nil {
		return p, err
	}
	sections := map[string]bool{}
	for _, line := range strings.Split(string(data), "\n") {
		trim := strings.TrimSpace(line)
		if strings.HasPrefix(trim, "[") {
			end := strings.IndexByte(trim, ']')
			if end < 0 {
				continue
			}
			section := trim[1:end]
			for key := range allowed {
				expected, _, _ := strings.Cut(key, "/")
				if strings.EqualFold(section, expected) {
					if section != expected || sections[expected] {
						return gameSettingsParsed{}, bad("Ambiguous KF2 section.")
					}
					sections[expected] = true
					break
				}
			}
		}
	}
	seen := map[string]bool{}
	for i := range p.fields {
		f := &p.fields[i]
		section, name, _ := strings.Cut(f.key, "/")
		for key, kind := range allowed {
			expectedSection, expectedName, _ := strings.Cut(key, "/")
			if strings.EqualFold(section, expectedSection) && strings.EqualFold(strings.TrimLeft(name, "+.!-"), expectedName) {
				if f.key != key || seen[key] || f.kind == "readonly" || f.structured || !kf2SettingsValue(key, f.value) {
					return gameSettingsParsed{}, bad("Ambiguous or unsupported KF2 scalar.")
				}
				seen[key] = true
				f.secret = gameSettingSecret.MatchString(key)
				f.kind = kind
				f.on = "true"
				f.off = "false"
			}
		}
		if _, ok := allowed[f.key]; !ok {
			f.kind = "readonly"
			f.structured = false
			f.secret = true
			f.value = "Unreviewed KF2 setting; edit in Files."
		}
	}
	// Quoted/comment-bearing native values have different runtime semantics from
	// the generic decoded scalar. Refuse reviewed rows before presenting them.
	for _, line := range strings.Split(string(data), "\n") {
		name, value, ok := strings.Cut(strings.TrimSpace(line), "=")
		if !ok {
			continue
		}
		for key := range allowed {
			_, leaf, _ := strings.Cut(key, "/")
			if strings.EqualFold(strings.TrimSpace(name), leaf) && strings.ContainsAny(value, "\"';#") {
				return gameSettingsParsed{}, bad("KF2 quoted or commented scalar requires Files.")
			}
		}
	}
	patch := p.patch
	p.patch = func(changes map[string]string) ([]byte, error) {
		for k, v := range changes {
			if !seen[k] || allowed[k] == "readonly" || !kf2SettingsValue(k, v) {
				return nil, bad("Unsupported or managed KF2 setting.")
			}
		}
		return patch(changes)
	}
	return p, nil
}

// validateKF2SettingsTuple must see the proposed bytes of BOTH files before
// either publication. Ports are effective allocation-backed runtime roles.
// No seeding or defaults occur here; missing reviewed rows fail closed.
func validateKF2SettingsTuple(game, web []byte, primary, query, webPort int, allocated map[int]bool) error {
	ports := []int{primary, primary + 12783, query}
	seen := map[int]bool{}
	for _, port := range ports {
		if port < 1025 || port > 65535 || seen[port] || !allocated[port] {
			return bad("Invalid KF2 allocated port group.")
		}
		seen[port] = true
	}
	if webPort < 1025 || webPort > 65535 {
		return bad("Invalid KF2 WebAdmin port.")
	}
	values := map[string]string{}
	for file, data := range map[string][]byte{kf2SettingsGamePath: game, kf2SettingsWebPath: web} {
		p, e := parseKF2Settings(file, data)
		if e != nil {
			return e
		}
		for _, f := range p.fields {
			if _, ok := kf2SettingsKeys(file)[f.key]; ok {
				values[f.key] = f.value
			}
		}
		for key := range kf2SettingsKeys(file) {
			if _, ok := values[key]; !ok {
				return bad("KF2 native settings have not been seeded.")
			}
		}
	}
	if values["IpDrv.WebServer/ListenPort"] != strconv.Itoa(webPort) {
		return bad("KF2 WebAdmin listener is managed by Runtime.")
	}
	if strings.EqualFold(values["IpDrv.WebServer/bEnabled"], "true") && (values["Engine.AccessControl/AdminPassword"] == "" || seen[webPort] || !allocated[webPort]) {
		return bad("KF2 WebAdmin requires a password and distinct allocated listener.")
	}
	return nil
}

// kf2SettingsAuthority is the pure admission portion. Root must additionally pin
// every emitted module against the current canonical installer and reject
// config_files overrides before calling it. Nonempty flags are conservatively
// refused here rather than duplicating the runtime shlex/override parser.
func kf2SettingsAuthority(recipe, eggStartup, serverStartup string, env map[string]string) error {
	if recipe != kf2SettingsRecipe || eggStartup != kf2SettingsStartup || serverStartup != kf2SettingsStartup || env["SRCDS_APPID"] != "232130" {
		return bad("Unsupported KF2 runtime authority.")
	}
	for _, key := range []string{"EXTRA_FLAGS", "PYTHONPATH", "LD_PRELOAD", "EXTRA_ARGS", "ADDITIONAL_ARGS"} {
		if env[key] != "" {
			return bad("KF2 runtime overrides require review.")
		}
	}
	return nil
}
