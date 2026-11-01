package panel

import (
	"bytes"
	"encoding/json"
	"sort"
	"strings"
	"unicode/utf8"
)

type bananaJSONSpan struct {
	start, end int
	object     bool
}

func bananaJSONSpans(data []byte) (map[string]bananaJSONSpan, error) {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	spans := map[string]bananaJSONSpan{}
	nodes := 0
	var walk func(string, int) error
	walk = func(pointer string, depth int) error {
		nodes++
		if depth > 128 || nodes > 20000 || len(pointer) > 4096 {
			return bad("This Banana JSON document is too complex for typed settings.")
		}
		start := int(decoder.InputOffset())
		for start < len(data) && strings.ContainsRune(" \t\r\n:,", rune(data[start])) {
			start++
		}
		token, err := decoder.Token()
		if err != nil {
			return bad("Invalid Banana JSON configuration.")
		}
		span := bananaJSONSpan{start: start}
		if delimiter, ok := token.(json.Delim); ok {
			switch delimiter {
			case '{':
				span.object = true
				seen := map[string]bool{}
				for decoder.More() {
					keyToken, err := decoder.Token()
					key, valid := keyToken.(string)
					if err != nil || !valid || seen[key] {
						return bad("Repeated Banana JSON keys cannot be edited here.")
					}
					seen[key] = true
					key = strings.ReplaceAll(strings.ReplaceAll(key, "~", "~0"), "/", "~1")
					if err = walk(pointer+"/"+key, depth+1); err != nil {
						return err
					}
				}
			case '[':
				for index := 0; decoder.More(); index++ {
					// Array children have no individually editable public fields;
					// still inspect them for duplicate keys and nesting bounds.
					encodedIndex, _ := json.Marshal(index)
					if err = walk(pointer+"/"+string(encodedIndex), depth+1); err != nil {
						return err
					}
				}
			default:
				return bad("Invalid Banana JSON container.")
			}
			if _, err = decoder.Token(); err != nil {
				return bad("Unclosed Banana JSON container.")
			}
		}
		span.end = int(decoder.InputOffset())
		spans[pointer] = span
		return nil
	}
	if err := walk("", 0); err != nil {
		return nil, err
	}
	return spans, nil
}

func bananaSettingsText(value string, maximum int) bool {
	if !utf8.ValidString(value) || utf8.RuneCountInString(value) > maximum {
		return false
	}
	for _, char := range value {
		if char < 32 || char == 127 {
			return false
		}
	}
	return true
}

// Root dispatches only the selected Banana document. Existing aliases are
// synchronized in one byte-span patch; a missing legacy alias stays absent.
func parseBananaAliasSettings(data []byte) (gameSettingsParsed, error) {
	invalid := func() (gameSettingsParsed, error) {
		return gameSettingsParsed{}, bad("Invalid or ambiguous Banana native configuration.")
	}
	if len(data) > 4*1024*1024 || !utf8.Valid(data) {
		return invalid()
	}
	prefix := []byte{}
	body := append([]byte(nil), data...)
	if bytes.HasPrefix(body, []byte{0xef, 0xbb, 0xbf}) {
		prefix, body = body[:3], body[3:]
	}
	if !json.Valid(body) {
		return invalid()
	}
	spans, err := bananaJSONSpans(body)
	if err != nil || !spans[""].object {
		return invalid()
	}
	for key := range spans {
		for _, reserved := range []string{"/Server", "/Browser", "/Server/Login_Token", "/Server/STEAM_GSLT", "/Browser/Server_Name"} {
			if key != reserved && strings.EqualFold(key, reserved) {
				return invalid()
			}
		}
	}
	for _, key := range []string{"/Server", "/Browser"} {
		if span, exists := spans[key]; exists && !span.object {
			return invalid()
		}
	}
	aliases := []string{"/Server/Login_Token", "/Server/STEAM_GSLT"}
	stored := map[string]string{}
	for _, key := range append(append([]string(nil), aliases...), "/Browser/Server_Name") {
		if span, exists := spans[key]; exists {
			var value string
			maximum := 256
			if key == "/Browser/Server_Name" {
				maximum = 25
			}
			if span.start >= span.end || body[span.start] != '"' || json.Unmarshal(body[span.start:span.end], &value) != nil || !bananaSettingsText(value, maximum) {
				return invalid()
			}
			stored[key] = value
		}
	}
	first, firstExists := stored[aliases[0]]
	second, secondExists := stored[aliases[1]]
	if firstExists && secondExists && first != second {
		return invalid()
	}
	parsed, err := parseGameSettings("/banana-native.json", body)
	if err != nil {
		return parsed, err
	}
	fields := map[string]gameSetting{}
	for _, field := range parsed.fields {
		fields[field.key] = field
	}
	basePatch := parsed.patch
	parsed.patch = func(changes map[string]string) ([]byte, error) {
		expanded := map[string]string{}
		for key, value := range changes {
			field, exists := fields[key]
			if !exists || field.kind == "readonly" {
				return nil, bad("This Banana setting cannot be changed here.")
			}
			if key == "/Browser/Server_Name" && !bananaSettingsText(value, 25) {
				return nil, bad("Banana server name must be bounded single-line text.")
			}
			expanded[key] = value
		}
		value, left := changes[aliases[0]]
		other, right := changes[aliases[1]]
		if left || right {
			if left && right && value != other {
				return nil, bad("Both Banana login-token aliases must use the same value.")
			}
			if !left {
				value = other
			}
			if !bananaSettingsText(value, 256) {
				return nil, bad("Banana login token must be bounded single-line text.")
			}
			for _, key := range aliases {
				if _, exists := stored[key]; exists {
					expanded[key] = value
				}
			}
		}
		validated, err := basePatch(expanded)
		if err != nil {
			return nil, err
		}
		validatedSpans, err := bananaJSONSpans(validated)
		if err != nil {
			return nil, err
		}
		keys := []string{}
		for key, value := range expanded {
			if value != fields[key].value {
				keys = append(keys, key)
			}
		}
		sort.Slice(keys, func(i, j int) bool { return spans[keys[i]].start > spans[keys[j]].start })
		result := append([]byte(nil), body...)
		for _, key := range keys {
			old, current := spans[key], validatedSpans[key]
			next := append([]byte(nil), result[:old.start]...)
			next = append(next, validated[current.start:current.end]...)
			result = append(next, result[old.end:]...)
		}
		return append(append([]byte(nil), prefix...), result...), nil
	}
	return parsed, nil
}
