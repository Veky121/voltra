// Settings-file formats and field specs shared by panel's quick setup and
// game settings. They moved here from panel's game_quick_setup.go,
// game_valheim.go and game_sevendays.go.

package gamesettings

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"path"
	"sort"
	"strconv"
	"strings"
	"unicode/utf16"
)

type QuickField struct {
	Key, Label, Type string
	Min, Max         float64
	Options          []string
	Secret           bool
}

func QuickSingleLine(value string) bool {
	return strings.IndexFunc(value, func(r rune) bool { return r < 32 || r == 127 }) < 0
}

func QuickFields(game string) []QuickField {
	switch game {
	case "7days":
		return []QuickField{{Key: "ServerName", Label: "Server name", Type: "text", Max: 100}, {Key: "ServerDescription", Label: "Description", Type: "text", Max: 512}, {Key: "ServerPassword", Label: "Join password", Type: "text", Max: 128, Secret: true}, {Key: "ServerMaxPlayerCount", Label: "Player limit", Type: "number", Min: 1, Max: 32}, {Key: "GameDifficulty", Label: "Difficulty", Type: "select", Options: []string{"0", "1", "2", "3", "4", "5"}}, {Key: "DayNightLength", Label: "Minutes per game day", Type: "number", Min: 10, Max: 240}, {Key: "DayLightLength", Label: "Daylight hours", Type: "number", Min: 0, Max: 24}, {Key: "BloodMoonFrequency", Label: "Days between blood moons", Type: "number", Min: 0, Max: 365}, {Key: "LootAbundance", Label: "Loot abundance (%)", Type: "number", Min: 25, Max: 300}}
	case "valheim":
		return []QuickField{{Key: "name", Label: "Server name", Type: "text", Max: 100}, {Key: "password", Label: "Join password", Type: "text", Max: 20, Secret: true}, {Key: "world", Label: "World name", Type: "text", Max: 20}, {Key: "public", Label: "Show in server browser", Type: "boolean"}}
	case "minecraft":
		return []QuickField{
			{Key: "motd", Label: "Server message", Type: "text", Max: 512},
			{Key: "max-players", Label: "Player limit", Type: "number", Min: 1, Max: 200},
			{Key: "gamemode", Label: "Game mode", Type: "select", Options: []string{"survival", "creative", "adventure", "spectator"}},
			{Key: "difficulty", Label: "Difficulty", Type: "select", Options: []string{"peaceful", "easy", "normal", "hard"}},
			{Key: "pvp", Label: "Player combat", Type: "boolean"},
			{Key: "white-list", Label: "Require allowlist", Type: "boolean"},
			{Key: "view-distance", Label: "View distance", Type: "number", Min: 2, Max: 32},
			{Key: "simulation-distance", Label: "Simulation distance", Type: "number", Min: 2, Max: 32},
			{Key: "spawn-protection", Label: "Spawn protection radius", Type: "number", Min: 0, Max: 1000},
			{Key: "allow-flight", Label: "Allow flight", Type: "boolean"},
		}
	case "palworld", "palworld-native", "palworld-proton":
		return []QuickField{
			{Key: "ServerName", Label: "Server name", Type: "text", Max: 100},
			{Key: "ServerDescription", Label: "Description", Type: "text", Max: 512},
			{Key: "ServerPassword", Label: "Join password", Type: "text", Max: 128, Secret: true},
			{Key: "AdminPassword", Label: "Admin password", Type: "text", Max: 128, Secret: true},
			{Key: "ServerPlayerMaxNum", Label: "Player limit", Type: "number", Min: 1, Max: 32},
			{Key: "ExpRate", Label: "Experience multiplier", Type: "number", Min: 0.1, Max: 20},
			{Key: "CollectionDropRate", Label: "Gathering multiplier", Type: "number", Min: 0.1, Max: 20},
			{Key: "DeathPenalty", Label: "Death penalty", Type: "select", Options: []string{"None", "Item", "ItemAndEquipment", "All"}},
			{Key: "bIsUseBackupSaveData", Label: "Built-in world backups", Type: "boolean"},
		}
	}
	return []QuickField{}
}

func QuickRevision(game, file string, content []byte, exists bool) string {
	h := sha256.New()
	fmt.Fprintf(h, "%s\x00%s\x00%t\x00", game, file, exists)
	h.Write(content)
	return hex.EncodeToString(h.Sum(nil))
}

// Only list a directory whose existence was established by its parent's
// successful listing. Stock Wings may return 500 for an absent intermediate
// parent through openat2. No HTTP error, including 404/500, proves absence.
type QuickListingContextKey struct{}

func QuickPathParts(name string) ([]string, error) {
	if !strings.HasPrefix(name, "/") || path.Clean(name) != name || len(name) > 4096 {
		return nil, bad("Invalid Quick setup file path.")
	}
	if name == "/" {
		return []string{}, nil
	}
	parts := strings.Split(strings.TrimPrefix(name, "/"), "/")
	for _, part := range parts {
		if !QuickSafeDirectory(part) {
			return nil, bad("Invalid Quick setup file path.")
		}
	}
	return parts, nil
}

func QuickFindEntry(entries []M, name string) (M, bool, error) {
	var found M
	for _, entry := range entries {
		if str(entry["name"]) == name {
			if found != nil {
				return nil, false, bad("The node returned ambiguous file entries.")
			}
			found = entry
		}
	}
	return found, found != nil, nil
}

func QuickSafeDirectory(name string) bool {
	return name != "" && name != "." && name != ".." && len(name) <= 255 && !strings.ContainsAny(name, "/\\\x00\r\n")
}

func QuickDirectoryEntry(entry M) bool {
	if boolean(entry["symlink"]) || boolean(entry["is_symlink"]) {
		return false
	}
	// Wings returns directory/file/symlink; the client file API transforms
	// those names to is_file/is_symlink. Prefer the real daemon shape.
	if directory, ok := entry["directory"].(bool); ok {
		return directory
	}
	if isFile, ok := entry["is_file"].(bool); ok {
		return !isFile
	}
	return false
}

func QuickFileEntry(entry M) bool {
	if boolean(entry["symlink"]) || boolean(entry["is_symlink"]) || boolean(entry["directory"]) {
		return false
	}
	if file, ok := entry["file"].(bool); ok {
		return file
	}
	if file, ok := entry["is_file"].(bool); ok {
		return file
	}
	return false
}

// Java properties are edited by logical record, retaining unknown physical
// lines, comments, whitespace and line endings exactly, including continuations.
type quickPropertyRecord struct{ Raw, Key, Value string }

func QuickPropertyRecords(data []byte) ([]quickPropertyRecord, error) {
	lines := strings.SplitAfter(string(data), "\n")
	out := []quickPropertyRecord{}
	for i := 0; i < len(lines); i++ {
		raw := lines[i]
		logical := strings.TrimSuffix(strings.TrimSuffix(lines[i], "\n"), "\r")
		comment := strings.TrimLeft(logical, " \t\f")
		// Java comments end at the physical newline even when the last byte is
		// a backslash; they cannot consume the following property's record.
		if comment == "" || comment[0] == '#' || comment[0] == '!' {
			out = append(out, quickPropertyRecord{Raw: raw})
			continue
		}
		for quickContinued(logical) {
			logical = logical[:len(logical)-1]
			i++
			if i >= len(lines) {
				return nil, bad("The properties file ends in an incomplete continuation.")
			}
			raw += lines[i]
			logical += strings.TrimLeft(strings.TrimSuffix(strings.TrimSuffix(lines[i], "\n"), "\r"), " \t\f")
		}
		trimmed := strings.TrimLeft(logical, " \t\f")
		record := quickPropertyRecord{Raw: raw}
		if trimmed != "" && trimmed[0] != '#' && trimmed[0] != '!' {
			end := 0
			escaped := false
			for end < len(trimmed) {
				c := trimmed[end]
				if !escaped && (c == '=' || c == ':' || c == ' ' || c == '\t' || c == '\f') {
					break
				}
				if c == '\\' && !escaped {
					escaped = true
				} else {
					escaped = false
				}
				end++
			}
			rest := strings.TrimLeft(trimmed[end:], " \t\f")
			if len(rest) > 0 && (rest[0] == '=' || rest[0] == ':') {
				rest = strings.TrimLeft(rest[1:], " \t\f")
			}
			var err error
			record.Key, err = quickPropertyUnescape(trimmed[:end])
			if err != nil {
				return nil, err
			}
			record.Value, err = quickPropertyUnescape(rest)
			if err != nil {
				return nil, err
			}
		}
		out = append(out, record)
	}
	return out, nil
}

func quickContinued(s string) bool {
	count := 0
	for i := len(s) - 1; i >= 0 && s[i] == '\\'; i-- {
		count++
	}
	return count%2 == 1
}

func quickPropertyUnescape(s string) (string, error) {
	var out strings.Builder
	for i := 0; i < len(s); i++ {
		if s[i] != '\\' {
			out.WriteByte(s[i])
			continue
		}
		i++
		if i >= len(s) {
			return "", bad("Invalid properties escape.")
		}
		switch s[i] {
		case 't':
			out.WriteByte('\t')
		case 'r':
			out.WriteByte('\r')
		case 'n':
			out.WriteByte('\n')
		case 'f':
			out.WriteByte('\f')
		case 'u':
			if i+4 >= len(s) {
				return "", bad("Invalid properties Unicode escape.")
			}
			n, e := strconv.ParseUint(s[i+1:i+5], 16, 16)
			if e != nil {
				return "", bad("Invalid properties Unicode escape.")
			}
			i += 4
			r := rune(n)
			if utf16.IsSurrogate(r) && i+6 < len(s) && s[i+1:i+3] == "\\u" {
				next, e := strconv.ParseUint(s[i+3:i+7], 16, 16)
				if e == nil {
					decoded := utf16.DecodeRune(r, rune(next))
					if decoded != '\uFFFD' {
						r = decoded
						i += 6
					}
				}
			}
			out.WriteRune(r)
		default:
			out.WriteByte(s[i])
		}
	}
	return out.String(), nil
}

func QuickPropertyEscape(s string) string {
	var out strings.Builder
	for i, r := range s {
		switch r {
		case '\\':
			out.WriteString("\\\\")
		case '\t':
			out.WriteString("\\t")
		case '\n':
			out.WriteString("\\n")
		case '\r':
			out.WriteString("\\r")
		case '\f':
			out.WriteString("\\f")
		case ' ':
			if i == 0 {
				out.WriteByte('\\')
			}
			out.WriteRune(r)
		default:
			if r < 32 || r > 126 {
				for _, unit := range utf16.Encode([]rune{r}) {
					fmt.Fprintf(&out, "\\u%04x", unit)
				}
			} else {
				out.WriteRune(r)
			}
		}
	}
	return out.String()
}

func QuickPatchProperties(data []byte, patch map[string]string) ([]byte, error) {
	records, err := QuickPropertyRecords(data)
	if err != nil {
		return nil, err
	}
	newline := "\n"
	if bytes.Contains(data, []byte("\r\n")) {
		newline = "\r\n"
	}
	seen := map[string]bool{}
	var out strings.Builder
	for _, record := range records {
		if value, ok := patch[record.Key]; ok {
			if !seen[record.Key] {
				out.WriteString(record.Key + "=" + value + newline)
				seen[record.Key] = true
			}
		} else {
			out.WriteString(record.Raw)
		}
	}
	keys := []string{}
	for key := range patch {
		if !seen[key] {
			keys = append(keys, key)
		}
	}
	sort.Strings(keys)
	for _, key := range keys {
		if out.Len() > 0 && !strings.HasSuffix(out.String(), "\n") {
			out.WriteString(newline)
		}
		out.WriteString(key + "=" + patch[key] + newline)
	}
	return []byte(out.String()), nil
}

func QuickUnrealQuote(s string) string {
	return `"` + strings.ReplaceAll(strings.ReplaceAll(s, `\`, `\\`), `"`, `\"`) + `"`
}

type quickPalTuple struct {
	Start, End int
	Segments   []string
}

func quickSplitTuple(value string) ([]string, error) {
	segments := []string{}
	start, depth := 0, 0
	quoted, escaped := false, false
	for i, c := range value {
		if quoted {
			if escaped {
				escaped = false
			} else if c == '\\' {
				escaped = true
			} else if c == '"' {
				quoted = false
			}
			continue
		}
		switch c {
		case '"':
			quoted = true
		case '(':
			depth++
		case ')':
			depth--
			if depth < 0 {
				return nil, bad("The Palworld settings tuple is malformed.")
			}
		case ',':
			if depth == 0 {
				segments = append(segments, value[start:i])
				start = i + 1
			}
		}
	}
	if quoted || depth != 0 {
		return nil, bad("The Palworld settings tuple is malformed.")
	}
	if strings.TrimSpace(value[start:]) != "" {
		segments = append(segments, value[start:])
	}
	return segments, nil
}

func QuickPalworldOptions(data []byte) (quickPalTuple, map[string]string, error) {
	content := string(data)
	section := ""
	offset := 0
	tuple := quickPalTuple{Start: -1}
	values := map[string]string{}
	for _, line := range strings.SplitAfter(content, "\n") {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "[") && strings.HasSuffix(trimmed, "]") {
			section = trimmed
		}
		if section == "[/Script/Pal.PalGameWorldSettings]" && !strings.HasPrefix(trimmed, ";") && !strings.HasPrefix(trimmed, "#") {
			key, value, ok := strings.Cut(trimmed, "=")
			if ok && strings.TrimSpace(key) == "OptionSettings" {
				if tuple.Start != -1 {
					return tuple, nil, bad("The Palworld configuration has multiple OptionSettings entries. Resolve them in Files before using Quick setup.")
				}
				value = strings.TrimSpace(value)
				if len(value) < 2 || value[0] != '(' || value[len(value)-1] != ')' {
					return tuple, nil, bad("The Palworld settings tuple is malformed.")
				}
				start := strings.Index(line, "=") + 1
				for start < len(line) && (line[start] == ' ' || line[start] == '\t') {
					start++
				}
				tuple.Start = offset + start
				tuple.End = tuple.Start + len(value)
				segments, err := quickSplitTuple(value[1 : len(value)-1])
				if err != nil {
					return tuple, nil, err
				}
				tuple.Segments = segments
				for _, segment := range segments {
					key, raw, ok := strings.Cut(segment, "=")
					if !ok {
						return tuple, nil, bad("The Palworld settings tuple is malformed.")
					}
					key = strings.TrimSpace(key)
					raw = strings.TrimSpace(raw)
					if strings.HasPrefix(raw, `"`) {
						unquoted, e := strconv.Unquote(raw)
						if e != nil {
							return tuple, nil, bad("The Palworld settings contain an invalid quoted value.")
						}
						raw = unquoted
					}
					values[key] = raw
				}
			}
		}
		offset += len(line)
	}
	if tuple.Start == -1 {
		return tuple, nil, bad("No Palworld OptionSettings entry was found. Restore the native default configuration or edit it in Files.")
	}
	return tuple, values, nil
}

func QuickPatchPalworld(data []byte, patch map[string]string) ([]byte, error) {
	tuple, _, err := QuickPalworldOptions(data)
	if err != nil {
		return nil, err
	}
	segments := []string{}
	seen := map[string]bool{}
	for _, segment := range tuple.Segments {
		key, _, _ := strings.Cut(segment, "=")
		key = strings.TrimSpace(key)
		if value, ok := patch[key]; ok {
			if !seen[key] {
				prefix := segment[:len(segment)-len(strings.TrimLeft(segment, " \t"))]
				segments = append(segments, prefix+key+"="+value)
				seen[key] = true
			}
		} else {
			segments = append(segments, segment)
		}
	}
	keys := []string{}
	for key := range patch {
		if !seen[key] {
			keys = append(keys, key)
		}
	}
	sort.Strings(keys)
	for _, key := range keys {
		segments = append(segments, key+"="+patch[key])
	}
	out := append([]byte{}, data[:tuple.Start]...)
	out = append(out, []byte("("+strings.Join(segments, ",")+")")...)
	out = append(out, data[tuple.End:]...)
	return out, nil
}

const ValheimSettingsPath = "/.voltra/valheim.properties"

func ValheimValues(content []byte) (map[string]string, error) {
	values := map[string]string{}
	for _, line := range strings.Split(string(content), "\n") {
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, ok := strings.Cut(line, "=")
		if !ok || !QuickSingleLine(value) {
			return nil, bad("Valheim settings are invalid. Restore the settings file before editing.")
		}
		if _, duplicate := values[key]; duplicate {
			return nil, bad("Valheim settings contain duplicate keys.")
		}
		values[key] = value
	}
	return values, nil
}

func ValheimPatch(content []byte, patch map[string]string) ([]byte, error) {
	values, err := ValheimValues(content)
	if err != nil {
		return nil, err
	}
	for key, value := range patch {
		values[key] = value
	}
	keys := []string{}
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	var out strings.Builder
	for _, key := range keys {
		fmt.Fprintf(&out, "%s=%s\n", key, values[key])
	}
	return []byte(out.String()), nil
}

const SevenDaysSettingsPath = "/serverconfig.xml"
