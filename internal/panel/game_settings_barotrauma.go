package panel

import (
	"bytes"
	"encoding/xml"
	"io"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"
)

const barotraumaSettingsPath = "/serversettings.xml"

var barotraumaRootAttribute = regexp.MustCompile(`\s+([A-Za-z_:][A-Za-z0-9_.:-]*)\s*=\s*("([^"]*)"|'([^']*)')`)

func validBarotraumaSetting(key, value string) bool {
	if !utf8.ValidString(value) || strings.IndexFunc(value, func(r rune) bool { return r < 32 || r == 127 }) >= 0 {
		return false
	}
	switch key {
	case "servername":
		return len(value) <= 60
	case "password":
		return len(value) <= 128
	case "ispublic":
		return value == "true" || value == "false"
	case "maxplayers":
		n, err := strconv.Atoi(value)
		return err == nil && n >= 1 && n <= 16 && strconv.Itoa(n) == value
	}
	return false
}

// Barotrauma stores settings as root XML attributes, unlike the property-child
// serverconfig.xml schema. Root must dispatch only the exact recipe and path.
// Unknown attributes and all children are retained as opaque original bytes.
func parseBarotraumaSettings(data []byte) (gameSettingsParsed, error) {
	invalid := func() (gameSettingsParsed, error) {
		return gameSettingsParsed{}, bad("Invalid or unsupported Barotrauma settings XML.")
	}
	if len(data) > 8*1024*1024 || !utf8.Valid(data) {
		return invalid()
	}
	type span struct {
		start, end int
		value      string
	}
	source := append([]byte(nil), data...)
	base := 0
	if bytes.HasPrefix(source, []byte{0xef, 0xbb, 0xbf}) {
		base = 3
	}
	decoder := xml.NewDecoder(bytes.NewReader(source[base:]))
	spans := map[string]span{}
	out := gameSettingsParsed{fields: []gameSetting{}}
	depth, roots, declarations := 0, 0, 0
	for {
		start := base + int(decoder.InputOffset())
		token, err := decoder.Token()
		end := base + int(decoder.InputOffset())
		if err == io.EOF {
			break
		}
		if err != nil {
			return invalid()
		}
		switch element := token.(type) {
		case xml.Directive:
			return invalid()
		case xml.ProcInst:
			declarations++
			if element.Target != "xml" || roots != 0 || declarations != 1 || start != base {
				return invalid()
			}
		case xml.StartElement:
			depth++
			if depth > 128 {
				return invalid()
			}
			seen := map[xml.Name]bool{}
			for _, attribute := range element.Attr {
				if seen[attribute.Name] {
					return invalid()
				}
				seen[attribute.Name] = true
			}
			if depth != 1 {
				continue
			}
			roots++
			if roots != 1 || element.Name.Space != "" || !strings.EqualFold(element.Name.Local, "serversettings") {
				return invalid()
			}
			raw := source[start:end]
			matches := barotraumaRootAttribute.FindAllSubmatchIndex(raw, -1)
			if len(matches) != len(element.Attr) {
				return invalid()
			}
			identities := map[string]bool{}
			for index, attribute := range element.Attr {
				key := strings.ToLower(attribute.Name.Local)
				managed := key == "servername" || key == "password" || key == "maxplayers" || key == "ispublic"
				runtime := key == "port" || key == "queryport" || key == "enableupnp"
				if !managed && !runtime {
					continue
				}
				if attribute.Name.Space != "" || identities[key] {
					return invalid()
				}
				identities[key] = true
				if !managed {
					continue
				}
				value := attribute.Value
				if key == "ispublic" {
					value = strings.ToLower(value)
				}
				if !validBarotraumaSetting(key, value) {
					return invalid()
				}
				match := matches[index]
				lo, hi := match[6], match[7]
				if lo < 0 {
					lo, hi = match[8], match[9]
				}
				spans[key] = span{start + lo, start + hi, value}
				field := gameSetting{key: key, value: value, kind: "text", secret: key == "password"}
				if key == "ispublic" {
					field.kind, field.on, field.off = "boolean", "true", "false"
				} else if key == "maxplayers" {
					field.kind = "number"
				}
				out.fields = append(out.fields, field)
			}
		case xml.EndElement:
			depth--
		case xml.CharData:
			if depth == 0 && strings.TrimSpace(string(element)) != "" {
				return invalid()
			}
		}
	}
	if roots != 1 || depth != 0 {
		return invalid()
	}
	out.patch = func(changes map[string]string) ([]byte, error) {
		keys := make([]string, 0, len(changes))
		for key, value := range changes {
			if _, ok := spans[key]; !ok || !validBarotraumaSetting(key, value) {
				return nil, bad("Invalid or unsupported Barotrauma setting.")
			}
			keys = append(keys, key)
		}
		sort.Slice(keys, func(i, j int) bool { return spans[keys[i]].start > spans[keys[j]].start })
		result := append([]byte(nil), source...)
		for _, key := range keys {
			s := spans[key]
			if changes[key] == s.value {
				continue
			}
			var escaped bytes.Buffer
			if err := xml.EscapeText(&escaped, []byte(changes[key])); err != nil {
				return nil, bad("Invalid Barotrauma setting.")
			}
			next := append([]byte(nil), result[:s.start]...)
			next = append(next, escaped.Bytes()...)
			result = append(next, result[s.end:]...)
		}
		return result, nil
	}
	return out, nil
}
