package panel

import (
	"bytes"
	"encoding/xml"
	"io"
	"sort"
	"strings"
)

type quickXMLProperty struct {
	Value      string
	Start, End int
}

// Decode XML for validation and decoded values, but edit only attribute spans.
// This retains comments, formatting, unknown settings and attribute order.
func quickXMLProperties(data []byte, root string) (map[string]quickXMLProperty, int, error) {
	input, offsetBase := data, 0
	if bytes.HasPrefix(input, []byte{0xef, 0xbb, 0xbf}) {
		input = input[3:]
		offsetBase = 3
	}
	decoder := xml.NewDecoder(bytes.NewReader(input))
	properties := map[string]quickXMLProperty{}
	depth, roots, closeOffset := 0, 0, -1
	for {
		before := offsetBase + int(decoder.InputOffset())
		token, err := decoder.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, 0, bad("The game XML configuration is invalid.")
		}
		switch value := token.(type) {
		case xml.Directive:
			return nil, 0, bad("XML directives are not supported in game settings.")
		case xml.StartElement:
			depth++
			if depth == 1 {
				roots++
				if value.Name.Local != root || value.Name.Space != "" {
					return nil, 0, bad("The game XML configuration has an unexpected root.")
				}
			}
			if depth != 2 || value.Name.Local != "property" || value.Name.Space != "" {
				continue
			}
			name, text := "", ""
			attributes := map[string]bool{}
			for _, attr := range value.Attr {
				if attributes[attr.Name.Local] {
					return nil, 0, bad("The game XML configuration has duplicate attributes.")
				}
				attributes[attr.Name.Local] = true
				if attr.Name.Space != "" {
					continue
				}
				if attr.Name.Local == "name" {
					name = attr.Value
				}
				if attr.Name.Local == "value" {
					text = attr.Value
				}
			}
			if name == "" || !attributes["value"] {
				return nil, 0, bad("A game XML property is missing its name or value.")
			}
			if _, duplicate := properties[name]; duplicate {
				return nil, 0, bad("The game XML configuration has duplicate properties.")
			}
			start, end, ok := quickXMLAttributeSpan(data[before:offsetBase+int(decoder.InputOffset())], "value")
			if !ok {
				return nil, 0, bad("The game XML property cannot be edited safely.")
			}
			properties[name] = quickXMLProperty{text, before + start, before + end}
		case xml.EndElement:
			if depth == 1 && offsetBase+int(decoder.InputOffset()) > before && bytes.HasPrefix(data[before:], []byte("</")) {
				closeOffset = before
			}
			depth--
		case xml.CharData:
			if depth == 0 && strings.TrimSpace(string(value)) != "" {
				return nil, 0, bad("Unexpected data outside the game XML configuration.")
			}
		}
	}
	if roots != 1 || depth != 0 || closeOffset < 0 {
		return nil, 0, bad("The game XML configuration is incomplete.")
	}
	return properties, closeOffset, nil
}

func quickXMLAttributeSpan(tag []byte, wanted string) (int, int, bool) {
	// The XML decoder already validated the tag. Scan quoted attributes without
	// matching a word inside another attribute's value.
	index := bytes.IndexAny(tag, " \t\r\n")
	if index < 0 {
		return 0, 0, false
	}
	space := func(b byte) bool { return b == ' ' || b == '\t' || b == '\r' || b == '\n' }
	for index < len(tag) {
		for index < len(tag) && space(tag[index]) {
			index++
		}
		if index >= len(tag) || tag[index] == '/' || tag[index] == '>' {
			break
		}
		start := index
		for index < len(tag) && !space(tag[index]) && tag[index] != '=' {
			index++
		}
		name := string(tag[start:index])
		for index < len(tag) && space(tag[index]) {
			index++
		}
		if index >= len(tag) || tag[index] != '=' {
			return 0, 0, false
		}
		index++
		for index < len(tag) && space(tag[index]) {
			index++
		}
		if index >= len(tag) || (tag[index] != '\'' && tag[index] != '"') {
			return 0, 0, false
		}
		quote := tag[index]
		index++
		start = index
		for index < len(tag) && tag[index] != quote {
			index++
		}
		if index >= len(tag) {
			return 0, 0, false
		}
		if name == wanted {
			return start, index, true
		}
		index++
	}
	return 0, 0, false
}

func quickPatchXMLProperties(data []byte, root string, patch map[string]string) ([]byte, error) {
	properties, closeOffset, err := quickXMLProperties(data, root)
	if err != nil {
		return nil, err
	}
	type edit struct {
		start, end int
		text       []byte
	}
	edits := []edit{}
	missing := []string{}
	escape := func(value string) []byte {
		var out bytes.Buffer
		_ = xml.EscapeText(&out, []byte(value))
		return out.Bytes()
	}
	for key, value := range patch {
		if property, found := properties[key]; found {
			edits = append(edits, edit{property.Start, property.End, escape(value)})
		} else {
			missing = append(missing, key)
		}
	}
	if len(missing) > 0 {
		sort.Strings(missing)
		var extra bytes.Buffer
		for _, key := range missing {
			extra.WriteString("  <property name=\"")
			extra.Write(escape(key))
			extra.WriteString("\" value=\"")
			extra.Write(escape(patch[key]))
			extra.WriteString("\"/>\n")
		}
		edits = append(edits, edit{closeOffset, closeOffset, extra.Bytes()})
	}
	sort.Slice(edits, func(i, j int) bool { return edits[i].start > edits[j].start })
	out := append([]byte{}, data...)
	for _, edit := range edits {
		next := make([]byte, 0, len(out)+len(edit.text))
		next = append(next, out[:edit.start]...)
		next = append(next, edit.text...)
		next = append(next, out[edit.end:]...)
		out = next
	}
	if _, _, err = quickXMLProperties(out, root); err != nil {
		return nil, err
	}
	return out, nil
}
