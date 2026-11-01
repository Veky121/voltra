package panel

import (
	"bytes"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"
)

// Publisher schema: https://wiki.holdfastgame.com/Server_Configuration
// No absent defaults are invented. Rotation settings are independent of globals.
var holdfastWave28Bool = map[string]bool{"friendly_fire": true, "friendly_fire_melee_bounce": true, "allow_spectating": true, "allow_faction_switching": true, "allow_midround_spawning": true, "faction_balancing": true, "start_bayonet_attached": true, "melee_weapons_only": true, "show_enemy_player_name_tags": true, "admin_console_allowed": true}
var holdfastWave28Line = regexp.MustCompile(`^([ \t]*)([a-z_]+)([ \t]+)(.*?)([ \t]*)$`)

func parseHoldfastSettings(data []byte) (gameSettingsParsed, error) {
	out := gameSettingsParsed{}
	if len(data) > 8*1024*1024 || !utf8.Valid(data) || bytes.ContainsRune(data, 0) {
		return out, bad("Invalid Holdfast configuration.")
	}
	lines := strings.SplitAfter(string(data), "\n")
	type span struct {
		line, start, end int
		native, kind     string
	}
	spans := map[string]span{}
	scope := 0
	rotation := false
	unsafe := false
	for i, raw := range lines {
		line := strings.TrimSuffix(strings.TrimSuffix(raw, "\n"), "\r")
		trim := strings.TrimSpace(line)
		if trim == "" || strings.HasPrefix(trim, "#") {
			continue
		}
		if trim == "!map_rotation start" {
			if rotation {
				return out, bad("Nested Holdfast rotation.")
			}
			scope++
			rotation = true
			continue
		}
		if trim == "!map_rotation end" {
			if !rotation {
				return out, bad("Unmatched Holdfast rotation.")
			}
			rotation = false
			continue
		}
		if strings.HasPrefix(trim, "!") {
			unsafe = true
			continue
		}
		m := holdfastWave28Line.FindStringSubmatchIndex(line)
		if m == nil {
			unsafe = true
			continue
		}
		native := line[m[4]:m[5]]
		value := line[m[8]:m[9]]
		if native == "import" || native == "rc" {
			unsafe = true
		}
		kind := ""
		if holdfastWave28Bool[native] {
			kind = "boolean"
		}
		switch native {
		case "server_name", "server_welcome_message", "server_intro_title", "server_intro_body", "server_region", "server_password", "server_admin_password":
			if !rotation {
				kind = "text"
			}
		case "spawn_immunity_timer":
			kind = "number"
		}
		if kind == "" {
			continue
		}
		key := "general/" + native
		if rotation {
			key = fmt.Sprintf("rotation_%d/%s", scope, native)
		}
		if _, ok := spans[key]; ok {
			return out, bad("Duplicate Holdfast setting.")
		}
		f := gameSetting{key: key, value: value, kind: kind, secret: gameSettingSecret.MatchString(native)}
		if kind == "boolean" {
			f.on = "true"
			f.off = "false"
		}
		if !holdfastWave28Value(native, kind, value) {
			return out, bad("Unsupported Holdfast setting syntax.")
		}
		out.fields = append(out.fields, f)
		spans[key] = span{i, m[8], m[9], native, kind}
	}
	if rotation {
		return out, bad("Unclosed Holdfast rotation.")
	}
	if unsafe {
		for i := range out.fields {
			out.fields[i].kind = "readonly"
		}
	}
	out.patch = func(changes map[string]string) ([]byte, error) {
		copyLines := append([]string(nil), lines...)
		for key, value := range changes {
			s, ok := spans[key]
			if !ok || unsafe || !holdfastWave28Value(s.native, s.kind, value) {
				return nil, bad("Holdfast setting is not safely writable.")
			}
			copyLines[s.line] = lines[s.line][:s.start] + value + lines[s.line][s.end:]
		}
		return []byte(strings.Join(copyLines, "")), nil
	}
	return out, nil
}
func holdfastWave28Value(key, kind, value string) bool {
	if strings.ContainsAny(value, "\r\n\x00#;\\\"") || strings.ContainsAny(value, "\u0085\u2028\u2029") {
		return false
	}
	if kind == "boolean" {
		return value == "true" || value == "false"
	}
	if kind == "number" {
		n, e := strconv.ParseFloat(value, 64)
		return e == nil && n >= 0 && n <= 5
	}
	if key == "server_region" {
		return strings.Contains("|europe|usa|usaeast|usawest|australia|china|japan|russia|southkorea|brazil|", "|"+value+"|") && value != ""
	}
	return len(value) <= 4096
}
