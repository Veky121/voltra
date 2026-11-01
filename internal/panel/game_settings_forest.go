package panel

import (
	"bytes"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"
)

const forestSettingsPath = "/TheForestDedicatedServer_Data/forest/config/config.cfg"

// Existing-only historical format adapter. Root must gate dispatch on the actual
// launcher and active path. No current native schema or consumption is implied.
func parseForestSettings(data []byte) (gameSettingsParsed, error) {
	out := gameSettingsParsed{fields: []gameSetting{}}
	invalid := func() (gameSettingsParsed, error) {
		return gameSettingsParsed{}, bad("Invalid or ambiguous Forest settings.")
	}
	if len(data) > 4*1024*1024 || bytes.IndexByte(data, 0) >= 0 {
		return invalid()
	}
	raw := append([]byte(nil), data...)
	type span struct{ start, end int }
	spans := map[string]span{}
	known := strings.Fields("serverName serverPlayers enableVAC difficulty serverIP serverSteamPort serverGamePort serverQueryPort serverPassword serverPasswordAdmin serverSteamAccount initType saveFolderPath serverAutoSaveInterval slot showLogs serverContact veganMode vegetarianMode resetHolesMode treeRegrowMode allowBuildingDestruction allowEnemiesCreativeMode allowCheat allowCheats targetFpsIdle targetFpsActive")
	seen := map[string]bool{}
	for offset := 0; offset < len(raw); {
		end := offset
		for end < len(raw) && raw[end] != '\n' {
			end++
		}
		stop := end
		if stop > offset && raw[stop-1] == '\r' {
			stop--
		}
		start := offset
		if offset == 0 && bytes.HasPrefix(raw, []byte{239, 187, 191}) {
			start += 3
		}
		for start < stop && (raw[start] == ' ' || raw[start] == '\t') {
			start++
		}
		keyEnd := start
		for keyEnd < stop && raw[keyEnd] != ' ' && raw[keyEnd] != '\t' {
			keyEnd++
		}
		key := string(raw[start:keyEnd])
		if !strings.HasPrefix(key, "//") {
			for _, canonical := range known {
				if strings.EqualFold(key, canonical) {
					if key != canonical || seen[key] {
						return invalid()
					}
					seen[key] = true
					valueStart := keyEnd
					for valueStart < stop && (raw[valueStart] == ' ' || raw[valueStart] == '\t') {
						valueStart++
					}
					valueEnd := stop
					// Inline comments are preserved; whitespace before them is outside the edit.
					if i := bytes.Index(raw[valueStart:stop], []byte("//")); i >= 0 {
						valueEnd = valueStart + i
					}
					for valueEnd > valueStart && (raw[valueEnd-1] == ' ' || raw[valueEnd-1] == '\t') {
						valueEnd--
					}
					if forestSettingKind(key) != "" {
						value := string(raw[valueStart:valueEnd])
						if !forestSettingValue(key, value) {
							return invalid()
						}
						spans[key] = span{valueStart, valueEnd}
						out.fields = append(out.fields, gameSetting{key: key, value: value, kind: forestSettingKind(key), on: "on", off: "off"})
					}
				}
			}
		}
		offset = end + 1
	}
	out.patch = func(changes map[string]string) ([]byte, error) {
		type edit struct {
			span
			value string
		}
		edits := []edit{}
		for key, value := range changes {
			s, ok := spans[key]
			if !ok || !forestSettingValue(key, value) {
				return nil, bad("Invalid Forest setting change.")
			}
			edits = append(edits, edit{s, value})
		}
		sort.Slice(edits, func(i, j int) bool { return edits[i].start > edits[j].start })
		result := append([]byte(nil), raw...)
		for _, e := range edits {
			next := append([]byte(nil), result[:e.start]...)
			next = append(next, e.value...)
			result = append(next, result[e.end:]...)
		}
		return result, nil
	}
	return out, nil
}

func forestSettingKind(key string) string {
	switch key {
	case "serverName":
		return "text"
	case "serverPlayers":
		return "integer"
	case "enableVAC":
		return "boolean"
	case "difficulty":
		return "text"
	}
	return ""
}
func forestSettingValue(key, value string) bool {
	if !utf8.ValidString(value) || strings.TrimSpace(value) != value || strings.ContainsAny(value, "\r\n\x00\";\\") || strings.Contains(value, "//") {
		return false
	}
	for _, r := range value {
		if r < 32 || r == 127 {
			return false
		}
	}
	switch key {
	case "serverName":
		return value != ""
	case "serverPlayers":
		n, err := strconv.ParseInt(value, 10, 32)
		return err == nil && n > 0 && strconv.FormatInt(n, 10) == value
	case "enableVAC":
		return value == "on" || value == "off"
	case "difficulty":
		return value == "Peaceful" || value == "Normal" || value == "Hard"
	}
	return false
}
