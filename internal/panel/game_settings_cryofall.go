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

const cryofallSettingsPath = "/Data/SettingsServer.xml"

// CryoFall uses nested element text, not property-child/value-attribute XML.
// Root must dispatch only the reviewed recipe and exact document. Identity,
// operators, credentials and runtime listeners never enter this field model.
func parseCryoFallSettings(data []byte) (gameSettingsParsed, error) {
	invalid := func() (gameSettingsParsed, error) {
		return gameSettingsParsed{}, bad("Invalid or unsupported CryoFall settings XML.")
	}
	if len(data) > 16*1024*1024 || !utf8.Valid(data) || bytes.IndexByte(data, 0) >= 0 {
		return invalid()
	}
	type span struct {
		start, end  int
		value, name string
		selfClosing bool
	}
	type frame struct {
		name                 xml.Name
		contentStart         int
		key                  string
		text                 strings.Builder
		complex, selfClosing bool
	}
	source := append([]byte(nil), data...)
	base := 0
	if bytes.HasPrefix(source, []byte{0xef, 0xbb, 0xbf}) {
		base = 3
	}
	decoder := xml.NewDecoder(bytes.NewReader(source[base:]))
	stack := []*frame{}
	roots, declarations := 0, 0
	sections, identities := map[string]bool{}, map[string]bool{}
	spans := map[string]span{}
	out := gameSettingsParsed{fields: []gameSetting{}}
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
			if len(stack) >= 128 {
				return invalid()
			}
			seen := map[xml.Name]bool{}
			for _, attr := range element.Attr {
				if seen[attr.Name] {
					return invalid()
				}
				seen[attr.Name] = true
			}
			if len(stack) > 0 && stack[len(stack)-1].key != "" {
				stack[len(stack)-1].complex = true
			}
			f := &frame{name: element.Name, contentStart: end, selfClosing: bytes.HasSuffix(source[start:end], []byte("/>"))}
			switch len(stack) {
			case 0:
				roots++
				if roots != 1 || element.Name.Space != "" || element.Name.Local != "settings" {
					return invalid()
				}
			case 1:
				group := strings.ToLower(element.Name.Local)
				if group == "network" || group == "server" {
					if group != element.Name.Local || element.Name.Space != "" || sections[group] {
						return invalid()
					}
					sections[group] = true
				}
			case 2:
				group := stack[1].name
				name := strings.ToLower(element.Name.Local)
				key := group.Local + "/" + name
				if group.Space == "" && cryofallTrackedKey(key) {
					if element.Name.Space != "" || name != element.Name.Local || identities[key] {
						return invalid()
					}
					identities[key] = true
					if cryofallEditableKey(key) {
						f.key = key
					}
				}
			}
			stack = append(stack, f)
		case xml.EndElement:
			if len(stack) == 0 {
				return invalid()
			}
			f := stack[len(stack)-1]
			stack = stack[:len(stack)-1]
			if f.key != "" {
				if f.complex {
					out.fields = append(out.fields, gameSetting{key: f.key, kind: "readonly", value: "Complex XML; edit this value in Files."})
					continue
				}
				value := f.text.String()
				if !cryofallSettingValid(f.key, value) {
					return invalid()
				}
				kind := "text"
				if f.key == "server/players_max_count" {
					kind = "number"
				}
				if f.key == "network/is_public_server" || f.key == "server/no_client_mods" {
					kind = "boolean"
				}
				out.fields = append(out.fields, gameSetting{key: f.key, value: value, kind: kind, on: "1", off: "0"})
				lo := f.contentStart
				if f.selfClosing {
					lo -= 2
				}
				spans[f.key] = span{start: lo, end: start, value: value, name: f.name.Local, selfClosing: f.selfClosing}
			}
		case xml.CharData:
			if len(stack) == 0 {
				if strings.TrimSpace(string(element)) != "" {
					return invalid()
				}
			} else if f := stack[len(stack)-1]; f.key != "" {
				f.text.Write([]byte(element))
				if f.text.Len() > 8192 {
					return invalid()
				}
			}
		case xml.Comment:
			if len(stack) > 0 && stack[len(stack)-1].key != "" {
				stack[len(stack)-1].complex = true
			}
		}
	}
	if roots != 1 || len(stack) != 0 {
		return invalid()
	}
	out.patch = func(changes map[string]string) ([]byte, error) {
		keys := []string{}
		for key, value := range changes {
			if _, ok := spans[key]; !ok || !cryofallSettingValid(key, value) {
				return nil, bad("Invalid or unsupported CryoFall setting.")
			}
			keys = append(keys, key)
		}
		sort.Slice(keys, func(i, j int) bool { return spans[keys[i]].start > spans[keys[j]].start })
		updated := append([]byte(nil), source...)
		for _, key := range keys {
			s := spans[key]
			if changes[key] == s.value {
				continue
			}
			var escaped bytes.Buffer
			if err := xml.EscapeText(&escaped, []byte(changes[key])); err != nil {
				return nil, bad("Invalid CryoFall setting.")
			}
			replacement := escaped.Bytes()
			if s.selfClosing {
				replacement = []byte(">" + escaped.String() + "</" + s.name + ">")
			}
			next := append([]byte(nil), updated[:s.start]...)
			next = append(next, replacement...)
			updated = append(next, updated[s.end:]...)
		}
		return updated, nil
	}
	return out, nil
}

func cryofallEditableKey(key string) bool {
	switch key {
	case "network/is_public_server", "server/name", "server/players_max_count", "server/no_client_mods":
		return true
	}
	return false
}

func cryofallTrackedKey(key string) bool {
	return cryofallEditableKey(key) || key == "network/port" || key == "network/ip" || key == "server/server_operators_list"
}

func cryofallSettingValid(key, value string) bool {
	if !utf8.ValidString(value) || strings.IndexFunc(value, func(r rune) bool { return r < 32 || r == 127 || r == 0xfffe || r == 0xffff }) >= 0 {
		return false
	}
	switch key {
	case "server/name":
		return len(value) <= 64
	case "server/players_max_count":
		n, err := strconv.Atoi(value)
		return err == nil && n >= 1 && n <= 300 && strconv.Itoa(n) == value
	case "network/is_public_server", "server/no_client_mods":
		return value == "0" || value == "1"
	}
	return false
}
