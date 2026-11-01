package panel

import (
	"bytes"
	"encoding/json"
	"io"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"
)

const terraTechSettingsPath = "/dedicated_server_config.json"

// parseTerraTechSettings edits only the existing gameplay scalars proved by
// terratech-native.py. Allocation-owned Port and unknown publisher fields stay
// opaque. This adapter does not establish native consumption or startup authority.
func parseTerraTechSettings(data []byte) (gameSettingsParsed, error) {
	out := gameSettingsParsed{fields: []gameSetting{}}
	invalid := func() (gameSettingsParsed, error) {
		return gameSettingsParsed{}, bad("Invalid or ambiguous TerraTech settings.")
	}
	if len(data) > 8*1024*1024 || !utf8.Valid(data) {
		return invalid()
	}
	// Own the backing bytes, including BOM, so a caller cannot change patch input.
	raw := append([]byte(nil), data...)
	bom := 0
	if bytes.HasPrefix(raw, []byte{0xef, 0xbb, 0xbf}) {
		bom = 3
	}
	body := raw[bom:]
	if !json.Valid(body) || len(bytes.TrimSpace(body)) == 0 || bytes.TrimSpace(body)[0] != '{' {
		return invalid()
	}
	d := json.NewDecoder(bytes.NewReader(body))
	d.UseNumber()
	type span struct{ start, end int }
	spans := map[string]span{}
	var walk func(int) error
	walk = func(depth int) error {
		if depth > 128 {
			return bad("TerraTech JSON nesting is too deep.")
		}
		t, err := d.Token()
		if err != nil {
			return err
		}
		switch t {
		case json.Delim('{'):
			seen := []string{}
			for d.More() {
				keyToken, err := d.Token()
				if err != nil {
					return err
				}
				key, ok := keyToken.(string)
				if !ok {
					return io.ErrUnexpectedEOF
				}
				for _, prior := range seen {
					if strings.EqualFold(prior, key) {
						return bad("Ambiguous TerraTech JSON key.")
					}
				}
				seen = append(seen, key)
				if depth == 0 {
					for _, canonical := range []string{"Port", "Password", "SlotCount"} {
						if strings.EqualFold(key, canonical) && key != canonical {
							return bad("Ambiguous TerraTech field.")
						}
					}
				}
				start := int(d.InputOffset())
				for start < len(body) && (body[start] == ':' || body[start] == ' ' || body[start] == '\t' || body[start] == '\r' || body[start] == '\n') {
					start++
				}
				if err := walk(depth + 1); err != nil {
					return err
				}
				if depth == 0 {
					spans[key] = span{start + bom, int(d.InputOffset()) + bom}
				}
			}
			_, err = d.Token()
			return err
		case json.Delim('['):
			for d.More() {
				if err := walk(depth + 1); err != nil {
					return err
				}
			}
			_, err = d.Token()
			return err
		}
		if depth == 0 {
			return bad("TerraTech config must be an object.")
		}
		return nil
	}
	if err := walk(0); err != nil {
		return invalid()
	}
	for _, key := range []string{"Password", "SlotCount"} {
		s, exists := spans[key]
		if !exists {
			continue
		}
		value := string(raw[s.start:s.end])
		kind := "integer"
		if key == "Password" {
			kind = "text"
			if raw[s.start] != '"' || json.Unmarshal(raw[s.start:s.end], &value) != nil {
				return invalid()
			}
		}
		if !terraTechSettingValue(key, value) {
			return invalid()
		}
		out.fields = append(out.fields, gameSetting{key: key, value: value, kind: kind, secret: key == "Password"})
	}
	out.patch = func(changes map[string]string) ([]byte, error) {
		type edit struct {
			span
			value string
		}
		edits := []edit{}
		for key, value := range changes {
			s, exists := spans[key]
			if !exists || !terraTechSettingValue(key, value) {
				return nil, bad("Invalid TerraTech setting change.")
			}
			current := string(raw[s.start:s.end])
			if key == "Password" {
				_ = json.Unmarshal(raw[s.start:s.end], &current)
			}
			if current == value {
				continue
			}
			if key == "Password" {
				encoded, _ := json.Marshal(value)
				value = string(encoded)
			}
			edits = append(edits, edit{s, value})
		}
		sort.Slice(edits, func(i, j int) bool { return edits[i].start > edits[j].start })
		updated := append([]byte(nil), raw...)
		for _, e := range edits {
			next := append([]byte(nil), updated[:e.start]...)
			next = append(next, e.value...)
			updated = append(next, updated[e.end:]...)
		}
		return updated, nil
	}
	return out, nil
}

func terraTechSettingValue(key, value string) bool {
	if key == "SlotCount" {
		n, err := strconv.Atoi(value)
		return err == nil && n >= 1 && n <= 6 && strconv.Itoa(n) == value
	}
	if key != "Password" || !utf8.ValidString(value) || utf8.RuneCountInString(value) > 128 {
		return false
	}
	for _, r := range value {
		if r < 32 || r == 127 {
			return false
		}
	}
	return true
}
