package panel

import (
	"bytes"
	"regexp"
	"strings"
	"unicode/utf8"
)

const redMSettingsRecipe = "rdr/redm/egg-red-m.json"
const redMSettingsPath = "/server.cfg"

// Deliberately narrower than the FXServer command language. No escaping,
// includes, command chaining or inferred resource convars are editable here.
var redMScalarLine = regexp.MustCompile(`^([ \t]*)(?:(set|setr|sets)[ \t]+)?([A-Za-z_][A-Za-z0-9_]*)([ \t]+)("[^"\\]*"|[^ \t"\\;#]+)([ \t]*(?://.*|#.*)?)$`)

func redMScalarValid(key, value string) bool {
	if !utf8.ValidString(value) {
		return false
	}
	for _, c := range value {
		if c < 32 || c == 127 || c == '\u0085' || c == '\u2028' || c == '\u2029' || strings.ContainsRune(`;"\`, c) {
			return false
		}
	}
	switch key {
	case "sv_hostname":
		return len(value) <= 128
	case "sv_lan":
		return value == "true" || value == "false" || value == "0" || value == "1"
	}
	return false
}

// parseRedMSettings returns only existing, reviewed nonsecret fields. Slots,
// credentials, allocations and the fixed game remain outside this editor.
func parseRedMSettings(data []byte) (gameSettingsParsed, error) {
	refuse := func() (gameSettingsParsed, error) {
		return gameSettingsParsed{}, bad("Use Files for executable, invalid or ambiguous RedM configuration.")
	}
	if len(data) > 1024*1024 || !utf8.Valid(data) || bytes.HasPrefix(data, []byte{239, 187, 191}) {
		return refuse()
	}
	lines := strings.SplitAfter(string(data), "\n")
	type span struct{ line, start, end int }
	spans := map[string]span{}
	seen := map[string]bool{}
	out := gameSettingsParsed{}
	for i, raw := range lines {
		line := strings.TrimSuffix(strings.TrimSuffix(raw, "\n"), "\r")
		if len(line) > 65536 {
			return refuse()
		}
		for _, c := range line {
			if c < 32 && c != '\t' || c == 127 || c == '\u0085' || c == '\u2028' || c == '\u2029' {
				return refuse()
			}
		}
		t := strings.TrimSpace(line)
		if t == "" || strings.HasPrefix(t, "#") || strings.HasPrefix(t, "//") {
			continue
		}
		// Check the entire executable portion, including unknown commands. Preserve
		// simple resource/ACL commands but never assume executable syntax is inert.
		quoted := false
		for j, c := range line {
			if !quoted && (c == '#' || c == '/' && j+1 < len(line) && line[j+1] == '/') {
				break
			}
			if c == '"' {
				quoted = !quoted
			}
			if c == '\\' || strings.ContainsRune(";{}", c) {
				return refuse()
			}
		}
		if quoted {
			return refuse()
		}
		words := strings.Fields(t)
		cmd := strings.ToLower(words[0])
		switch cmd {
		case "exec", "execifexists", "vstr", "alias", "cmd", "script", "script_execute":
			return refuse()
		}
		if strings.HasPrefix(cmd, "+") || strings.HasPrefix(cmd, `"`) {
			return refuse()
		}
		m := redMScalarLine.FindStringSubmatchIndex(line)
		key := cmd
		if cmd == "set" || cmd == "setr" || cmd == "sets" {
			if len(words) < 2 {
				return refuse()
			}
			key = strings.ToLower(words[1])
			if strings.ContainsAny(key, `"'=\`) {
				return refuse()
			}
		}
		// Duplicate credentials and runtime-owned scalars also make authority unclear.
		managed := key == "sv_hostname" || key == "sv_lan" || key == "sv_maxclients" || key == "sv_maxplayers" || key == "sv_licensekey" || key == "steam_webapikey" || key == "gamename" || key == "endpoint_add_tcp" || key == "endpoint_add_udp"
		if !managed {
			continue
		}
		if seen[key] || m == nil {
			return refuse()
		}
		seen[key] = true
		if key == "sv_maxplayers" && seen["sv_maxclients"] || key == "sv_maxclients" && seen["sv_maxplayers"] {
			return refuse()
		}
		start, end := m[10], m[11]
		value := line[start:end]
		if strings.HasPrefix(value, `"`) {
			value = value[1 : len(value)-1]
		}
		if key == "gamename" && value != "rdr3" {
			return refuse()
		}
		if key != "sv_hostname" && key != "sv_lan" {
			continue
		}
		// Prefix/case variants are refused rather than guessed to be equivalent.
		if line[m[6]:m[7]] != key || m[4] >= 0 && line[m[4]:m[5]] != "set" || !redMScalarValid(key, value) {
			return refuse()
		}
		kind, on, off := "text", "", ""
		if key == "sv_lan" {
			kind, on, off = "boolean", "true", "false"
			if value == "0" || value == "1" {
				on, off = "1", "0"
			}
		}
		out.fields = append(out.fields, gameSetting{key: key, value: value, kind: kind, on: on, off: off})
		spans[key] = span{i, start, end}
	}
	out.patch = func(changes map[string]string) ([]byte, error) {
		next := append([]string(nil), lines...)
		for key, value := range changes {
			s, ok := spans[key]
			if !ok || !redMScalarValid(key, value) {
				return nil, bad("Invalid RedM scalar change.")
			}
			if key == "sv_hostname" {
				value = `"` + value + `"`
			}
			next[s.line] = lines[s.line][:s.start] + value + lines[s.line][s.end:]
		}
		return []byte(strings.Join(next, "")), nil
	}
	return out, nil
}
