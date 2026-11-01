package panel

import (
	"math"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"
)

const urbanTerrorSettingsRecipe = "urbanterror/egg-urban-terror.json"
const urbanTerrorSettingsPath = "/urbanterror/q3ut4/server.cfg"

// FrozenSand 4.3.4 server_example.cfg, shipped in the pinned publisher archive.
// Existing numeric gameplay assignments only. The launcher overwrites managed cvars.
var urbanTerrorSettingKinds = map[string]string{
	"fraglimit": "number", "capturelimit": "number", "g_warmup": "number", "g_inactivity": "number",
	"sv_hostname": "readonly", "sv_joinmessage": "readonly", "sv_maxclients": "readonly", "g_gametype": "readonly", "bot_enable": "readonly", "bot_minplayers": "readonly", "timelimit": "readonly", "g_friendlyfire": "readonly", "g_password": "readonly", "rconpassword": "readonly", "g_refpass": "readonly", "sv_privatepassword": "readonly", "net_port": "readonly", "net_ip": "readonly", "dedicated": "readonly",
}

var urbanTerrorSetPrefix = regexp.MustCompile(`(?i)^([ \t]*set[asu]?[ \t]+)`)
var urbanTerrorInteger = regexp.MustCompile(`^[0-9]+$`)

func urbanTerrorSettingValue(key, value string) bool {
	kind, exists := urbanTerrorSettingKinds[key]
	if !exists || len(value) > 32 {
		return false
	}
	if kind == "boolean" {
		return value == "0" || value == "1"
	}
	if key != "timelimit" {
		n, err := strconv.ParseUint(value, 10, 31)
		return urbanTerrorInteger.MatchString(value) && err == nil && n <= math.MaxInt32
	}
	n, err := strconv.ParseFloat(value, 64)
	return sourceNumber.MatchString(value) && err == nil && !math.IsInf(n, 0) && !math.IsNaN(n) && n >= 0
}

// Retain exact set/seta prefixes by padding with equal byte-width whitespace
// only during the shared scalar parser's analysis. Restore every original
// prefix after its value-span patch, including unknown commands/settings.
func parseUrbanTerrorSettings(data []byte) (gameSettingsParsed, error) {
	if len(data) > 8*1024*1024 || !utf8.Valid(data) {
		return gameSettingsParsed{}, bad("Invalid Urban Terror settings document.")
	}
	bom := ""
	body := string(data)
	if strings.HasPrefix(body, "\ufeff") {
		bom = "\ufeff"
		body = strings.TrimPrefix(body, bom)
	}
	lines := strings.SplitAfter(body, "\n")
	if len(lines) > 100000 {
		return gameSettingsParsed{}, bad("Oversized Urban Terror settings document.")
	}
	prefixes := make(map[int]string)
	unsafeControl := false
	for i, line := range lines {
		if len(line) > 65536 || strings.ContainsAny(strings.TrimSuffix(strings.TrimSuffix(line, "\n"), "\r"), "\r\u0085\u2028\u2029") {
			return gameSettingsParsed{}, bad("Unsupported Urban Terror settings line.")
		}
		words := strings.Fields(strings.TrimSpace(line))
		if len(words) > 0 {
			head := words[0]
			if end := strings.IndexAny(head, ";=\""); end >= 0 {
				head = head[:end]
			}
			switch strings.ToLower(head) {
			case "exec", "vstr", "toggle", "reset", "unset", "cvar_restart", "devmap", "map_restart", "wait":
				unsafeControl = true
			}
		}
		prefix := urbanTerrorSetPrefix.FindString(line)
		if len(words) > 0 && prefix == "" {
			head := strings.ToLower(words[0])
			if end := strings.IndexAny(head, ";=\""); end >= 0 {
				head = head[:end]
			}
			if head == "set" || head == "seta" || head == "sets" || head == "setu" {
				unsafeControl = true
			}
		}
		if prefix != "" {
			prefixes[i] = prefix
			lines[i] = strings.Repeat(" ", len(prefix)) + line[len(prefix):]
		}

		trimmed := strings.TrimSpace(lines[i])
		if strings.HasPrefix(trimmed, "\"") && !strings.HasPrefix(trimmed, "\" Admin\" ") && !strings.HasPrefix(trimmed, "\" Email\" ") {
			unsafeControl = true
		}
	}
	parsed, err := parseSourceSettingsWithSchema([]byte(strings.Join(lines, "")), urbanTerrorSettingKinds, urbanTerrorSettingValue)
	if err != nil {
		return parsed, err
	}
	for i := range parsed.fields {
		switch parsed.fields[i].key {
		case "g_password", "rconpassword", "g_refpass", "sv_privatepassword":
			parsed.fields[i].secret = true
		}
	}
	if unsafeControl {
		for i := range parsed.fields {
			parsed.fields[i].kind = "readonly"
		}
		parsed.patch = func(changes map[string]string) ([]byte, error) {
			if len(changes) > 0 {
				return nil, bad("Urban Terror script control requires the native file editor.")
			}
			return append([]byte(nil), data...), nil
		}
		return parsed, nil
	}
	patch := parsed.patch
	parsed.patch = func(changes map[string]string) ([]byte, error) {
		updated, err := patch(changes)
		if err != nil {
			return nil, err
		}
		rows := strings.SplitAfter(string(updated), "\n")
		if len(rows) != len(lines) {
			return nil, bad("Invalid Urban Terror patch layout.")
		}
		for i, prefix := range prefixes {
			if len(rows[i]) < len(prefix) {
				return nil, bad("Invalid Urban Terror patch prefix.")
			}
			rows[i] = prefix + rows[i][len(prefix):]
		}
		return []byte(bom + strings.Join(rows, "")), nil
	}
	return parsed, nil
}
