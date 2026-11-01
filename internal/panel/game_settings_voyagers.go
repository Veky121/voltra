package panel

import (
	"bytes"
	"fmt"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"
)

const voyagersSettingsPath = "/BoatGame/Saved/PersistedData/CustomConfig/CustomHostServerUserSettings.ini"
const voyagersSettingsSection = "/Script/BoatGame.BGCustomHostServerSettings"

// parseVoyagersSettings implements the imported adapter contract only. It does
// not establish native consumption or startup authority. Integration must gate
// exact recipe, launcher, stopped state, permissions and post-lock revision.
// The gameplay INI has no proved schema and is deliberately excluded.
func parseVoyagersSettings(data []byte) (gameSettingsParsed, error) {
	out := gameSettingsParsed{}
	invalid := func() error { return fmt.Errorf("Unsupported or ambiguous Voyagers host settings") }
	if len(data) > 8*1024*1024 || !utf8.Valid(data) || bytes.ContainsAny(data, "\x00") {
		return out, invalid()
	}
	original := bytes.Clone(data)
	body := strings.TrimPrefix(string(original), "\ufeff")
	lines := strings.SplitAfter(body, "\n")
	type span struct {
		line, start, end int
		value            string
	}
	found := map[string]span{}
	order := []string{"HostServerDisplayName", "HostServerPassword", "MaxPlayers", "AutosaveTimerSeconds"}
	active, seenSection := false, false
	for i, raw := range lines {
		line := strings.TrimSuffix(strings.TrimSuffix(raw, "\n"), "\r")
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, ";") || strings.HasPrefix(trimmed, "#") {
			continue
		}
		if strings.HasPrefix(trimmed, "[") {
			if !strings.HasSuffix(trimmed, "]") {
				return out, invalid()
			}
			name := trimmed[1 : len(trimmed)-1]
			active = name == voyagersSettingsSection
			if strings.EqualFold(name, voyagersSettingsSection) {
				if !active || seenSection {
					return out, invalid()
				}
				seenSection = true
			}
			continue
		}
		if !active {
			continue
		}
		eq := strings.IndexByte(line, '=')
		if eq < 0 {
			return out, invalid()
		}
		key := strings.TrimSpace(line[:eq])
		alias := strings.TrimLeft(key, "+-.!")
		if bracket := strings.IndexByte(alias, '['); bracket >= 0 {
			alias = alias[:bracket]
		}
		for _, known := range order {
			if !strings.EqualFold(alias, known) {
				continue
			}
			if key != known {
				return out, invalid()
			}
			if _, exists := found[key]; exists {
				return out, invalid()
			}
			start := eq + 1
			for start < len(line) && (line[start] == ' ' || line[start] == '\t') {
				start++
			}
			end := len(strings.TrimRight(line, " \t"))
			if end < start {
				end = start
			}
			found[key] = span{i, start, end, line[start:end]}
		}
	}
	valid := func(key, value string) bool {
		if strings.ContainsFunc(value, unicode.IsControl) || !utf8.ValidString(value) || strings.ContainsAny(value, "\x00\r\n\";#=[]\\") || strings.TrimSpace(value) != value {
			return false
		}
		switch key {
		case "HostServerDisplayName":
			return value != "" && utf8.RuneCountInString(value) <= 50
		case "HostServerPassword":
			return len(value) <= 4096
		default:
			n, e := strconv.Atoi(value)
			if e != nil || strconv.Itoa(n) != value {
				return false
			}
			if key == "MaxPlayers" {
				return n >= 1 && n <= 10
			}
			return n >= 10 && n <= 900
		}
	}
	for _, key := range order {
		s, ok := found[key]
		if !ok {
			continue
		}
		kind := "text"
		if key == "HostServerPassword" {
			kind = "readonly"
		}
		if key == "MaxPlayers" || key == "AutosaveTimerSeconds" {
			kind = "number"
		}
		// Opaque existing secrets remain untouched; no value leaves this parser.
		value := s.value
		if key == "HostServerPassword" {
			value = ""
		} else if !valid(key, value) {
			return gameSettingsParsed{}, invalid()
		}
		out.fields = append(out.fields, gameSetting{key: voyagersSettingsSection + "/" + key, value: value, kind: kind, secret: key == "HostServerPassword"})
	}
	out.patch = func(changes map[string]string) ([]byte, error) {
		next := append([]string(nil), lines...)
		for full, value := range changes {
			key := strings.TrimPrefix(full, voyagersSettingsSection+"/")
			s, ok := found[key]
			if !ok || full != voyagersSettingsSection+"/"+key {
				return nil, invalid()
			}
			// Password replacement/clearing requires a separate explicit secret action.
			if key == "HostServerPassword" || !valid(key, value) {
				return nil, invalid()
			}
			next[s.line] = next[s.line][:s.start] + value + next[s.line][s.end:]
		}
		result := []byte(strings.Join(next, ""))
		if bytes.HasPrefix(original, []byte{0xef, 0xbb, 0xbf}) {
			result = append([]byte{0xef, 0xbb, 0xbf}, result...)
		}
		return result, nil
	}
	return out, nil
}
