package panel

import (
	"bytes"
	"encoding/json"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"
)

const jc3SettingsRecipe = "just_cause/just_cause_3/egg-j-c3-m-p.json"
const plainsSettingsRecipe = "plains_of_pain/egg-plains-of-pain.json"

// Native scalars own subsequent boots. Unknown values and arrays remain opaque.
func parseWave40Settings(recipe string, data []byte) (gameSettingsParsed, error) {
	out := gameSettingsParsed{}
	body := bytes.TrimPrefix(data, []byte{239, 187, 191})
	prefix := data[:len(data)-len(body)]
	if len(data) > 8*1024*1024 || !utf8.Valid(body) || !json.Valid(body) {
		return out, bad("Invalid native JSON.")
	}
	spans, err := bananaJSONSpans(body)
	if err != nil || !spans[""].object {
		return out, bad("Invalid native object.")
	}
	kinds := map[string]string{"serverName": "text", "password": "text", "worldId": "number", "mapId": "number", "seed": "number", "difficulty": "number", "maxPlayers": "number", "worldSize": "number", "port": "readonly", "queryPort": "readonly"}
	if recipe == jc3SettingsRecipe {
		kinds = map[string]string{"name": "text", "description": "text", "password": "text", "maxPlayers": "number", "maxTickRate": "number", "announce": "boolean", "host": "readonly", "bind": "readonly", "port": "readonly", "queryPort": "readonly", "steamPort": "readonly", "httpPort": "readonly", "requiredDLC": "readonly"}
	}
	valid := func(k, v, kind string) bool {
		if kind == "text" {
			limit := 4096
			if recipe == plainsSettingsRecipe {
				limit = 255
			}
			if k == "password" {
				limit = 30
				if recipe == plainsSettingsRecipe {
					limit = 20
				}
			}
			return bananaSettingsText(v, limit)
		}
		if kind == "boolean" {
			return v == "true" || v == "false"
		}
		n, e := strconv.ParseInt(v, 10, 64)
		if e != nil {
			return false
		}
		switch k {
		case "maxPlayers":
			if recipe == jc3SettingsRecipe {
				return n >= 1 && n <= 1000
			}
			return n >= 1 && n <= 200
		case "maxTickRate":
			return n >= 1 && n <= 1000
		case "difficulty":
			return n >= 1 && n <= 4
		case "worldSize":
			return n == 11 || n == 21 || n == 31 || n == 41 || n == 51
		default:
			return n >= -2147483648 && n <= 2147483647
		}
	}
	fields := map[string]gameSetting{}
	for pointer, span := range spans {
		if pointer == "" {
			continue
		}
		for key := range kinds {
			if strings.EqualFold(pointer, "/"+key) && pointer != "/"+key {
				return out, bad("Ambiguous native key alias.")
			}
		}
		if strings.Count(pointer, "/") != 1 {
			continue
		}
		key := strings.TrimPrefix(pointer, "/")
		kind, known := kinds[key]
		if !known {
			continue
		}
		raw := body[span.start:span.end]
		value := string(raw)
		if kind == "text" {
			if json.Unmarshal(raw, &value) != nil {
				return out, bad("Native string required.")
			}
		}
		if kind != "readonly" && !valid(key, value, kind) {
			return out, bad("Invalid native scalar.")
		}
		f := gameSetting{key: pointer, value: value, kind: kind, on: "true", off: "false", secret: key == "password"}
		out.fields = append(out.fields, f)
		fields[pointer] = f
	}
	sort.Slice(out.fields, func(i, j int) bool { return out.fields[i].key < out.fields[j].key })
	out.patch = func(changes map[string]string) ([]byte, error) {
		keys := []string{}
		encoded := map[string][]byte{}
		for key, v := range changes {
			f, ok := fields[key]
			if !ok || f.kind == "readonly" || !valid(strings.TrimPrefix(key, "/"), v, f.kind) {
				return nil, bad("Unsupported native change.")
			}
			raw := []byte(v)
			if f.kind == "text" {
				raw, _ = json.Marshal(v)
			}
			encoded[key] = raw
			keys = append(keys, key)
		}
		sort.Slice(keys, func(i, j int) bool { return spans[keys[i]].start > spans[keys[j]].start })
		result := append([]byte(nil), body...)
		for _, key := range keys {
			s := spans[key]
			next := append([]byte(nil), result[:s.start]...)
			next = append(next, encoded[key]...)
			result = append(next, result[s.end:]...)
		}
		return append(append([]byte(nil), prefix...), result...), nil
	}
	return out, nil
}
