package panel

import (
	"bytes"
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"
)

const windroseSettingsPath = "/R5/ServerDescription.json"
const windroseSettingsPrefix = "ServerDescription_Persistent/"

type windroseValueSpan struct {
	start, end int
	value      any
}

// parseWindroseSettings is a pure parser, not an authority gate. Callers must
// prove the exact recipe, emitted helper, stopped state, permissions and revision.
// Only existing scalar values are editable; this never seeds keys or identities.
func parseWindroseSettings(data []byte) (gameSettingsParsed, error) {
	out := gameSettingsParsed{}
	original := bytes.Clone(data)
	body := bytes.TrimPrefix(original, []byte{0xef, 0xbb, 0xbf})
	invalid := func() error { return fmt.Errorf("Invalid or ambiguous Windrose native settings") }
	if len(data) > 8*1024*1024 || !utf8.Valid(body) || !json.Valid(body) {
		return out, invalid()
	}
	dec := json.NewDecoder(bytes.NewReader(body))
	dec.UseNumber()
	spans := map[string]windroseValueSpan{}
	var walk func(string, int) error
	walk = func(path string, depth int) error {
		if depth > 128 {
			return invalid()
		}
		start := int(dec.InputOffset())
		for start < len(body) && strings.ContainsRune(" \t\r\n:,", rune(body[start])) {
			start++
		}
		token, err := dec.Token()
		if err != nil {
			return invalid()
		}
		if d, ok := token.(json.Delim); ok {
			switch d {
			case '{':
				seen := map[string]bool{}
				for dec.More() {
					t, e := dec.Token()
					if e != nil {
						return invalid()
					}
					key, ok := t.(string)
					if !ok {
						return invalid()
					}
					folded := strings.ToLower(key)
					if seen[folded] {
						return invalid()
					}
					seen[folded] = true
					// JSON pointer escaping prevents unknown names from aliasing known paths.
					key = strings.ReplaceAll(strings.ReplaceAll(key, "~", "~0"), "/", "~1")
					if e = walk(path+"/"+key, depth+1); e != nil {
						return e
					}
				}
			case '[':
				for i := 0; dec.More(); i++ {
					if err := walk(path+"/"+strconv.Itoa(i), depth+1); err != nil {
						return err
					}
				}
			default:
				return invalid()
			}
			if _, err = dec.Token(); err != nil {
				return invalid()
			}
		}
		spans[path] = windroseValueSpan{start, int(dec.InputOffset()), token}
		return nil
	}
	if err := walk("", 0); err != nil {
		return out, err
	}
	section := "/ServerDescription_Persistent"
	if spans[""].value != json.Delim('{') || spans[section].value != json.Delim('{') {
		return out, invalid()
	}
	// Case variants of known names are refused even when the canonical key is absent.
	known := []string{"ServerName", "UseDirectConnection", "Password", "MaxPlayerCount", "InviteCode", "IsPasswordProtected", "P2pProxyAddress", "PersistentServerId", "WorldIslandId", "DirectConnectionServerAddress", "DirectConnectionServerPort"}
	for path := range spans {
		for _, key := range known {
			want := section + "/" + key
			if strings.EqualFold(path, want) && path != want {
				return out, invalid()
			}
		}
		if strings.EqualFold(path, section) && path != section {
			return out, invalid()
		}
	}
	for _, key := range []string{"PersistentServerId", "WorldIslandId"} {
		v, ok := spans[section+"/"+key].value.(string)
		if !ok || v == "" {
			return out, invalid()
		}
	}
	order := []struct {
		key, kind string
		max       int
	}{{"ServerName", "text", 40}, {"UseDirectConnection", "boolean", 0}, {"Password", "password", 30}, {"MaxPlayerCount", "number", 0}, {"InviteCode", "readonly", 32}, {"IsPasswordProtected", "boolean", 0}}
	for _, spec := range order {
		span, exists := spans[section+"/"+spec.key]
		if !exists {
			continue
		}
		f := gameSetting{key: windroseSettingsPrefix + spec.key, kind: spec.kind, on: "true", off: "false", secret: spec.key == "Password" || spec.key == "InviteCode"}
		switch spec.kind {
		case "boolean":
			v, ok := span.value.(bool)
			if !ok {
				return out, invalid()
			}
			f.value = strconv.FormatBool(v)
		case "number":
			v, ok := span.value.(json.Number)
			if !ok || strings.ContainsAny(string(v), ".eE-") || string(v) == "0" {
				return out, invalid()
			}
			if n, err := strconv.ParseInt(string(v), 10, 32); err != nil || n < 1 {
				return out, invalid()
			}
			f.value = string(v)
		default:
			v, ok := span.value.(string)
			if !ok || utf8.RuneCountInString(v) > spec.max || strings.ContainsAny(v, "\x00\r\n") || spec.key == "ServerName" && v == "" {
				return out, invalid()
			}
			f.value = v
			if spec.key == "InviteCode" && v != "" {
				if len(v) < 6 {
					return out, invalid()
				}
				for _, c := range v {
					if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9') {
						return out, invalid()
					}
				}
			}
		}
		out.fields = append(out.fields, f)
	}
	password, pok := spans[section+"/Password"]
	protection, bok := spans[section+"/IsPasswordProtected"]
	if pok && bok && (password.value != "") != protection.value {
		return out, invalid()
	}
	out.patch = func(changes map[string]string) ([]byte, error) {
		type edit struct {
			start, end int
			raw        []byte
		}
		edits := []edit{}
		for key, value := range changes {
			var field *gameSetting
			for i := range out.fields {
				if out.fields[i].key == key {
					field = &out.fields[i]
					break
				}
			}
			if field == nil || field.kind == "readonly" {
				return nil, fmt.Errorf("Windrose setting is not editable")
			}
			if field.value == value {
				continue
			}
			var native any = value
			switch field.kind {
			case "boolean":
				if value != "true" && value != "false" {
					return nil, invalid()
				}
				native = value == "true"
			case "number":
				if value == "" || strings.Trim(value, "0123456789") != "" || value[0] == '0' {
					return nil, invalid()
				}
				native = json.Number(value)
			}
			raw, err := json.Marshal(native)
			if err != nil {
				return nil, invalid()
			}
			span := spans["/"+key]
			edits = append(edits, edit{span.start, span.end, raw})
		}
		sort.Slice(edits, func(i, j int) bool { return edits[i].start > edits[j].start })
		next := bytes.Clone(body)
		for _, e := range edits {
			next = append(append(append([]byte{}, next[:e.start]...), e.raw...), next[e.end:]...)
		}
		// Reparse before returning any bytes; pair changes must be consistent together.
		if _, err := parseWindroseSettings(next); err != nil {
			return nil, err
		}
		if len(edits) > 0 && (!pok || !bok) {
			for key := range changes {
				if key == windroseSettingsPrefix+"Password" || key == windroseSettingsPrefix+"IsPasswordProtected" {
					return nil, invalid()
				}
			}
		}
		if len(original) != len(body) {
			next = append([]byte{0xef, 0xbb, 0xbf}, next...)
		}
		return next, nil
	}
	return out, nil
}
