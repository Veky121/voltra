package panel

import (
	"bytes"
	"encoding/json"
	"io"
	"sort"
	"strconv"
)

// VTT only. Unknown and credential properties remain opaque and cannot be patched.
func parseFoundryVTTSettings(data []byte) (gameSettingsParsed, error) {
	out := gameSettingsParsed{}
	if len(data) > 8*1024*1024 {
		return out, bad("Foundry VTT options too large.")
	}
	dec := json.NewDecoder(bytes.NewReader(data))
	token, err := dec.Token()
	if err != nil || token != json.Delim('{') {
		return out, bad("Invalid Foundry VTT options.")
	}
	values := map[string]json.RawMessage{}
	for dec.More() {
		key, err := dec.Token()
		if err != nil {
			return out, bad("Invalid Foundry VTT option.")
		}
		name, ok := key.(string)
		if !ok {
			return out, bad("Invalid Foundry VTT option.")
		}
		if _, exists := values[name]; exists {
			return out, bad("Duplicate Foundry VTT option.")
		}
		var raw json.RawMessage
		if dec.Decode(&raw) != nil {
			return out, bad("Invalid Foundry VTT value.")
		}
		values[name] = raw
	}
	if _, err = dec.Token(); err != nil {
		return out, bad("Invalid Foundry VTT options.")
	}
	if dec.Decode(new(any)) != io.EOF {
		return out, bad("Trailing Foundry VTT options.")
	}
	allowed := map[string]string{"hostname": "text", "routePrefix": "text", "world": "text", "proxySSL": "boolean", "upnp": "boolean", "minifyStaticFiles": "boolean", "proxyPort": "number"}
	keys := []string{}
	for k := range allowed {
		if _, ok := values[k]; ok {
			keys = append(keys, k)
		}
	}
	sort.Strings(keys)
	validate := func(k, v string) (json.RawMessage, bool) {
		switch allowed[k] {
		case "boolean":
			if v != "true" && v != "false" {
				return nil, false
			}
			return json.RawMessage(v), true
		case "number":
			n, e := strconv.Atoi(v)
			if e != nil || n < 1 || n > 65535 {
				return nil, false
			}
			return json.RawMessage(v), true
		case "text":
			if len(v) > 256 {
				return nil, false
			}
			for _, r := range v {
				if r < 32 || r == 127 {
					return nil, false
				}
			}
			b, _ := json.Marshal(v)
			return b, true
		}
		return nil, false
	}
	for _, k := range keys {
		var v any
		if json.Unmarshal(values[k], &v) != nil {
			return out, bad("Invalid Foundry VTT setting.")
		}
		if v == nil {
			continue
		}
		text := ""
		switch x := v.(type) {
		case string:
			text = x
		case bool:
			text = strconv.FormatBool(x)
		case float64:
			text = string(values[k])
		default:
			return out, bad("Invalid Foundry VTT setting type.")
		}
		raw, ok := validate(k, text)
		if !ok || (allowed[k] == "text" && len(raw) > 0 && values[k][0] != '"') || (allowed[k] != "text" && values[k][0] == '"') {
			return out, bad("Invalid Foundry VTT setting type.")
		}
		out.fields = append(out.fields, gameSetting{key: k, value: text, kind: allowed[k], on: "true", off: "false"})
	}
	out.patch = func(changes map[string]string) ([]byte, error) {
		updated := map[string]json.RawMessage{}
		for k, v := range values {
			updated[k] = v
		}
		for k, v := range changes {
			if _, ok := values[k]; !ok {
				return nil, bad("Unknown Foundry VTT setting.")
			}
			raw, ok := validate(k, v)
			if !ok {
				return nil, bad("Invalid Foundry VTT setting change.")
			}
			updated[k] = raw
		}
		return json.MarshalIndent(updated, "", "  ")
	}
	return out, nil
}
