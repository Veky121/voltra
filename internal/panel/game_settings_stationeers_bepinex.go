package panel

import (
	"bytes"
	"encoding/xml"
	"io"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"
)

const stationeersBepinexRecipe = "stationeers/stationeers_bepinex/egg-stationeers--bep-in-ex.json"
const stationeersBepinexSettingsPath = "/setting.xml"

// No defaults are seeded. This adapter requires an existing native SettingData.
// Dispatch and launcher eligibility remain integration-owned.
func stationeersBepinexSettingKind(key string) string {
	switch key {
	case "ServerName":
		return "text"
	case "ServerMaxPlayers", "SaveInterval":
		return "number"
	case "AutoSave", "ServerVisible", "AutoPauseServer", "UPNPEnabled":
		return "boolean"
	}
	return ""
}

func validStationeersBepinexSetting(key, value string) bool {
	if !utf8.ValidString(value) || strings.IndexFunc(value, func(r rune) bool { return r < 32 || r == 127 }) >= 0 {
		return false
	}
	switch stationeersBepinexSettingKind(key) {
	case "text":
		return len([]rune(value)) <= 100
	case "boolean":
		return value == "true" || value == "false"
	case "number":
		if value == "" || strings.IndexFunc(value, func(r rune) bool { return r < '0' || r > '9' }) >= 0 {
			return false
		}
		n, err := strconv.ParseInt(value, 10, 64)
		max := int64(2147483647)
		if key == "ServerMaxPlayers" {
			max = 30
		}
		return err == nil && n >= 1 && n <= max
	}
	return false
}

// Patches only plain scalar content spans. Unknown subtrees, identities and
// credentials never become fields. All bytes outside changed spans survive.
func parseStationeersBepinexGameSettings(data []byte) (gameSettingsParsed, error) {
	invalid := func() (gameSettingsParsed, error) {
		return gameSettingsParsed{}, bad("Invalid or unsupported Stationeers settings XML.")
	}
	if len(data) > 8*1024*1024 || !utf8.Valid(data) {
		return invalid()
	}
	source := bytes.Clone(data)
	base := 0
	if bytes.HasPrefix(source, []byte{239, 187, 191}) {
		base = 3
	}
	d := xml.NewDecoder(bytes.NewReader(source[base:]))
	type span struct {
		start, end int
		value      string
	}
	spans := map[string]span{}
	seen := map[string]bool{}
	out := gameSettingsParsed{fields: []gameSetting{}}
	depth, roots, declarations := 0, 0, 0
	key, value, contentStart, plain := "", "", 0, false
	for {
		start := base + int(d.InputOffset())
		token, err := d.Token()
		end := base + int(d.InputOffset())
		if err == io.EOF {
			break
		}
		if err != nil {
			return invalid()
		}
		switch x := token.(type) {
		case xml.Directive:
			return invalid()
		case xml.ProcInst:
			declarations++
			if x.Target != "xml" || start != base || declarations != 1 || roots != 0 {
				return invalid()
			}
		case xml.StartElement:
			depth++
			if depth > 128 {
				return invalid()
			}
			attrs := map[xml.Name]bool{}
			for _, a := range x.Attr {
				if attrs[a.Name] {
					return invalid()
				}
				attrs[a.Name] = true
			}
			if depth == 1 {
				roots++
				if roots != 1 || x.Name.Local != "SettingData" || x.Name.Space != "" {
					return invalid()
				}
			}
			if depth == 2 {
				folded := strings.ToLower(x.Name.Local)
				if seen[folded] {
					return invalid()
				}
				seen[folded] = true
				key, value, contentStart, plain = x.Name.Local, "", end, true
				if x.Name.Space != "" || len(x.Attr) != 0 || bytes.HasSuffix(source[start:end], []byte("/>")) {
					plain = false
				}
			} else if depth > 2 {
				plain = false
			}
		case xml.CharData:
			if depth == 0 && strings.TrimSpace(string(x)) != "" {
				return invalid()
			}
			if depth == 2 {
				value += string(x)
			}
		case xml.Comment:
			if depth == 2 {
				plain = false
			}
		case xml.EndElement:
			if depth == 2 && plain && stationeersBepinexSettingKind(key) != "" {
				// CDATA, comments and nested forms stay opaque rather than normalized.
				if bytes.Contains(source[contentStart:start], []byte("<")) || !validStationeersBepinexSetting(key, value) {
					return invalid()
				}
				spans[key] = span{contentStart, start, value}
				f := gameSetting{key: key, value: value, kind: stationeersBepinexSettingKind(key)}
				if f.kind == "boolean" {
					f.on, f.off = "true", "false"
				}
				out.fields = append(out.fields, f)
			}
			depth--
		}
	}
	if roots != 1 || depth != 0 {
		return invalid()
	}
	out.patch = func(changes map[string]string) ([]byte, error) {
		keys := []string{}
		for k, v := range changes {
			if _, ok := spans[k]; !ok || !validStationeersBepinexSetting(k, v) {
				return nil, bad("Invalid or unsupported Stationeers setting.")
			}
			keys = append(keys, k)
		}
		sort.Slice(keys, func(i, j int) bool { return spans[keys[i]].start > spans[keys[j]].start })
		result := bytes.Clone(source)
		for _, k := range keys {
			s := spans[k]
			if changes[k] == s.value {
				continue
			}
			var escaped bytes.Buffer
			if err := xml.EscapeText(&escaped, []byte(changes[k])); err != nil {
				return nil, bad("Invalid Stationeers setting.")
			}
			result = append(append(append([]byte{}, result[:s.start]...), escaped.Bytes()...), result[s.end:]...)
		}
		return result, nil
	}
	return out, nil
}
