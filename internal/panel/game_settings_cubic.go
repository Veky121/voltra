package panel

import (
	"bytes"
	"math"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"
)

const cubicSettingsPath = "/config/server_config.txt"
const cubicSettingsRecipe = "cubic_odyssey/egg-cubic-odyssey.json"

func cubicSettingsDocument(egg M, file string) bool {
	return file == cubicSettingsPath && nativeSettingsIsRecipe(egg, cubicSettingsRecipe)
}

var cubicKeyPrefix = regexp.MustCompile(`^([ \t]*)([A-Za-z][A-Za-z0-9]*)(.*)$`)
var cubicRow = regexp.MustCompile(`^([ \t]*)([A-Za-z][A-Za-z0-9]*)([ \t]+)(.*)$`)
var cubicName = regexp.MustCompile(`^"([^"\\]*)"([ \t]*(?://.*|#.*)?)$`)
var cubicPrivacy = regexp.MustCompile(`^(TRUE|FALSE)([ \t]*(?://.*|#.*)?)$`)
var cubicSeed = regexp.MustCompile(`^([0-9]{1,11})([ \t]*(?://.*|#.*)?)$`)
var cubicSeedValue = regexp.MustCompile(`^[0-9]{1,11}$`)
var cubicNumberValue = regexp.MustCompile(`^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$`)
var cubicNumberRow = regexp.MustCompile(`^(-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)([ \t]*)$`)
var cubicDifficultyBool = regexp.MustCompile(`^(true|false)([ \t]*)$`)
var cubicDifficultyNumbers = map[string]bool{"damagePlayerScale": true, "damagePirateScale": true, "damageCreatureScale": true, "damageDarknessScale": true, "damagePlayerShipScale": true, "damagePirateShipScale": true, "craftingCostScale": true, "tradingCostScale": true}

func cubicSettingValue(key, value string) bool {
	if !utf8.ValidString(value) || strings.IndexFunc(value, func(r rune) bool {
		return unicode.IsControl(r) || r == '\u2028' || r == '\u2029'
	}) >= 0 {
		return false
	}
	switch key {
	case "serverName":
		return len(value) <= 4096 && !strings.ContainsAny(value, "\"\\")
	case "privateServer", "allowRelaying", "enableCrashDumps", "enableLogging":
		return value == "TRUE" || value == "FALSE"
	case "difficulty/damageGearOnDeath", "difficulty/loseQbitsOnDeath":
		return value == "true" || value == "false"
	case "galaxySeed":
		return cubicSeedValue.MatchString(value)
	}
	if strings.HasPrefix(key, "difficulty/") && cubicDifficultyNumbers[strings.TrimPrefix(key, "difficulty/")] && cubicNumberValue.MatchString(value) {
		parsed, err := strconv.ParseFloat(value, 64)
		return err == nil && !math.IsInf(parsed, 0) && !math.IsNaN(parsed)
	}
	return false
}

// Only actual publisher GameParams/m_server ServerParams rows are editable.
// Unknown DifficultySettings and nested addon blocks stay byte-preserved.
func cubicRootWords(text string) (map[int]string, string, bool) {
	words, stack := map[int]string{}, []byte{}
	masked := []byte(text)
	labels, header := []string{}, []string{}
	headerLine, outer, servers, difficulties := -1, 0, 0, 0
	leading, closed := false, false
	for i := 0; i < len(text); {
		c := text[i]
		if strings.ContainsRune(" \t\r\n", rune(c)) {
			i++
			continue
		}
		if strings.HasPrefix(text[i:], "//") || c == '#' {
			end := strings.IndexByte(text[i:], '\n')
			if end < 0 {
				end = len(text) - i
			}
			for at := i; at < i+end; at++ {
				if text[at] != '\r' && text[at] != '\n' {
					masked[at] = ' '
				}
			}
			i += end
			continue
		}
		if strings.HasPrefix(text[i:], "/*") {
			end := strings.Index(text[i+2:], "*/")
			if end < 0 {
				return nil, string(masked), false
			}
			for at := i; at < i+end+4; at++ {
				if text[at] != '\r' && text[at] != '\n' {
					masked[at] = ' '
				}
			}
			i += end + 4
			continue
		}
		if closed {
			return nil, string(masked), false
		}
		if c == '"' {
			header = nil
			i++
			ended := false
			for i < len(text) {
				if text[i] < 32 || text[i] == 127 {
					return nil, string(masked), false
				}
				if text[i] == '\\' {
					i += 2
					continue
				}
				if text[i] == '"' {
					i++
					ended = true
					break
				}
				i++
			}
			if !ended {
				return nil, string(masked), false
			}
			continue
		}
		if c == '{' || c == '[' {
			names := header
			if !leading {
				names = nil
			}
			label := "?"
			if len(stack) == 0 {
				if c != '{' || len(names) != 1 || names[0] != "GameParams" || outer != 0 {
					return nil, string(masked), false
				}
				outer++
				label = "GameParams"
			} else if len(labels) == 1 && labels[0] == "GameParams" && len(names) > 0 && strings.EqualFold(names[0], "m_server") {
				if c != '{' || len(names) != 2 || names[0] != "m_server" || names[1] != "ServerParams" || servers != 0 {
					return nil, string(masked), false
				}
				servers++
				label = "m_server"
			} else if len(labels) == 1 && labels[0] == "GameParams" && len(names) > 0 && strings.EqualFold(names[0], "m_difficulty") {
				if c != '{' || len(names) != 2 || names[0] != "m_difficulty" || names[1] != "DifficultySettings" || difficulties != 0 {
					return nil, string(masked), false
				}
				difficulties++
				label = "m_difficulty"
			}
			stack = append(stack, c)
			labels = append(labels, label)
			header, headerLine = nil, -1
			if len(stack) > 128 {
				return nil, string(masked), false
			}
			i++
			continue
		}
		if c == '}' || c == ']' {
			if len(stack) == 0 || c == '}' && stack[len(stack)-1] != '{' || c == ']' && stack[len(stack)-1] != '[' {
				return nil, string(masked), false
			}
			stack = stack[:len(stack)-1]
			labels = labels[:len(labels)-1]
			if len(stack) == 0 {
				closed = true
			}
			header, headerLine = nil, -1
			i++
			continue
		}
		start := i
		for i < len(text) && !strings.ContainsRune(" \t\r\n{}[]\"#", rune(text[i])) && !strings.HasPrefix(text[i:], "//") && !strings.HasPrefix(text[i:], "/*") {
			i++
		}
		if i == start {
			return nil, string(masked), false
		}
		line := strings.LastIndexByte(text[:start], '\n') + 1
		if line != headerLine {
			header, headerLine = nil, line
			leading = strings.TrimSpace(string(masked[line:start])) == ""
		}
		header = append(header, text[start:i])
		if len(header) > 32 {
			return nil, string(masked), false
		}
		if len(labels) == 2 && labels[0] == "GameParams" && (labels[1] == "m_server" || labels[1] == "m_difficulty") && strings.TrimSpace(string(masked[line:start])) == "" {
			words[start] = labels[1]
			if len(words) > 8000 {
				return nil, string(masked), false
			}
		}
	}
	return words, string(masked), len(stack) == 0 && outer == 1 && servers == 1
}

// Only publisher serverName/privateServer/galaxySeed are editable. Mode,
// password, player count and allocated ports remain original CLI controls.
// Unknown rows, nested data, comments, BOM and newline bytes are preserved.
func parseCubicSettings(data []byte) (gameSettingsParsed, error) {
	invalid := func() (gameSettingsParsed, error) {
		return gameSettingsParsed{}, bad("Invalid or unsupported Cubic Odyssey configuration.")
	}
	if len(data) > 8*1024*1024 || !utf8.Valid(data) {
		return invalid()
	}
	base := 0
	if bytes.HasPrefix(data, []byte{0xef, 0xbb, 0xbf}) {
		base = 3
	}
	text := string(data[base:])
	if strings.IndexFunc(text, func(r rune) bool {
		return unicode.IsControl(r) && r != '\t' && r != '\r' && r != '\n' || r == '\u2028' || r == '\u2029'
	}) >= 0 {
		return invalid()
	}
	eligible, masked, ok := cubicRootWords(text)
	if !ok {
		return invalid()
	}
	type span struct {
		start, end int
		value      string
	}
	spans := map[string]span{}
	out := gameSettingsParsed{fields: []gameSetting{}}
	offset := 0
	serverNames := []string{"serverName", "privateServer", "galaxySeed", "allowRelaying", "enableCrashDumps", "enableLogging"}
	canonical := map[string]map[string]string{"m_server": {}, "m_difficulty": {}}
	for _, key := range serverNames {
		canonical["m_server"][strings.ToLower(key)] = key
	}
	for key := range cubicDifficultyNumbers {
		canonical["m_difficulty"][strings.ToLower(key)] = "difficulty/" + key
	}
	for _, key := range []string{"damageGearOnDeath", "loseQbitsOnDeath"} {
		canonical["m_difficulty"][strings.ToLower(key)] = "difficulty/" + key
	}
	for _, raw := range strings.SplitAfter(masked, "\n") {
		line := strings.TrimRight(raw, "\r\n")
		prefix := cubicKeyPrefix.FindStringSubmatchIndex(line)
		if prefix == nil || eligible[offset+prefix[4]] == "" {
			offset += len(raw)
			continue
		}
		name := line[prefix[4]:prefix[5]]
		key, known := canonical[eligible[offset+prefix[4]]][strings.ToLower(name)]
		if !known {
			offset += len(raw)
			continue
		}
		if name != strings.TrimPrefix(key, "difficulty/") {
			return invalid()
		}
		if _, exists := spans[key]; exists {
			return invalid()
		}
		row := cubicRow.FindStringSubmatchIndex(line)
		if row == nil {
			return invalid()
		}
		valueText := line[row[8]:row[9]]
		matcher := cubicName
		if key == "privateServer" || key == "allowRelaying" || key == "enableCrashDumps" || key == "enableLogging" {
			matcher = cubicPrivacy
		}
		if key == "difficulty/damageGearOnDeath" || key == "difficulty/loseQbitsOnDeath" {
			matcher = cubicDifficultyBool
		} else if strings.HasPrefix(key, "difficulty/") {
			matcher = cubicNumberRow
		}
		if key == "galaxySeed" {
			matcher = cubicSeed
		}
		valueMatch := matcher.FindStringSubmatchIndex(valueText)
		if valueMatch == nil {
			return invalid()
		}
		value := valueText[valueMatch[2]:valueMatch[3]]
		if !cubicSettingValue(key, value) {
			return invalid()
		}
		start, end := base+offset+row[8], base+offset+row[8]+valueMatch[3]
		if key == "serverName" {
			end++
		}
		spans[key] = span{start, end, value}
		field := gameSetting{key: key, value: value, kind: "text"}
		if key == "privateServer" || key == "allowRelaying" || key == "enableCrashDumps" || key == "enableLogging" {
			field.kind, field.on, field.off = "boolean", "TRUE", "FALSE"
		}
		if key == "difficulty/damageGearOnDeath" || key == "difficulty/loseQbitsOnDeath" {
			field.kind, field.on, field.off = "boolean", "true", "false"
		} else if strings.HasPrefix(key, "difficulty/") {
			field.kind = "number"
		}
		if key == "galaxySeed" {
			field.kind = "number"
		}
		out.fields = append(out.fields, field)
		offset += len(raw)
	}
	for _, key := range []string{"serverName", "privateServer", "galaxySeed"} {
		if _, ok := spans[key]; !ok {
			return invalid()
		}
	}
	source := append([]byte(nil), data...)
	out.patch = func(changes map[string]string) ([]byte, error) {
		keys := make([]string, 0, len(changes))
		for key, value := range changes {
			if _, ok := spans[key]; !ok || !cubicSettingValue(key, value) {
				return nil, bad("Invalid Cubic Odyssey setting.")
			}
			keys = append(keys, key)
		}
		sort.Slice(keys, func(i, j int) bool { return spans[keys[i]].start > spans[keys[j]].start })
		result := append([]byte(nil), source...)
		for _, key := range keys {
			s := spans[key]
			value := changes[key]
			if value == s.value {
				continue
			}
			if key == "serverName" {
				value = "\"" + value + "\""
			}
			next := append([]byte(nil), result[:s.start]...)
			next = append(next, []byte(value)...)
			result = append(next, result[s.end:]...)
		}
		return result, nil
	}
	return out, nil
}
