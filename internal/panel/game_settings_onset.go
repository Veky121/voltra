package panel

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"strconv"
	"unicode/utf8"
)

const onsetSettingsRecipe = "onset/egg-onset.json"
const onsetSettingsStartup = "exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/onset_native.py run"

// CONFIG authority only. Packages may change effective gameplay values.
func onsetSettingsAuthority(recipe, startup string, mappings int, installed, reviewed map[string]string) bool {
	if recipe != onsetSettingsRecipe || startup != onsetSettingsStartup || mappings != 0 || len(reviewed) == 0 {
		return false
	}
	for path, digest := range reviewed {
		if digest == "" || installed[path] != digest {
			return false
		}
	}
	return true
}

func onsetValueKind(key string, raw []byte) string {
	var v any
	d := json.NewDecoder(bytes.NewReader(raw))
	d.UseNumber()
	if d.Decode(&v) != nil {
		return "readonly"
	}
	switch key {
	case "servername", "servername_short", "gamemode", "website_url", "password", "connect_screen_url":
		if s, ok := v.(string); ok && utf8.ValidString(s) {
			limit := 4096
			if key == "servername" {
				limit = 260
			}
			if key == "servername_short" {
				limit = 128
			}
			if utf8.RuneCountInString(s) <= limit {
				return "text"
			}
		}
	case "masterlist", "vac", "sandbox", "dev_whitelist", "voice", "voice_spatialization", "connect_screen_show_cursor":
		if _, ok := v.(bool); ok {
			return "boolean"
		}
	case "timeout", "voice_sample_rate":
		if n, ok := v.(json.Number); ok {
			i, e := strconv.Atoi(string(n))
			if e == nil && (key == "timeout" && i >= 10000 && i <= 20000 || key == "voice_sample_rate" && (i == 8000 || i == 12000 || i == 16000 || i == 24000 || i == 48000)) {
				return "number"
			}
		}
	}
	return "readonly"
}

func onsetUniqueJSON(d *json.Decoder) error {
	t, e := d.Token()
	if e != nil {
		return e
	}
	delim, ok := t.(json.Delim)
	if !ok {
		return nil
	}
	if delim == '{' {
		seen := map[string]bool{}
		for d.More() {
			k, e := d.Token()
			if e != nil {
				return e
			}
			s := k.(string)
			if seen[s] {
				return fmt.Errorf("duplicate Onset key")
			}
			seen[s] = true
			if e = onsetUniqueJSON(d); e != nil {
				return e
			}
		}
	} else if delim == '[' {
		for d.More() {
			if e = onsetUniqueJSON(d); e != nil {
				return e
			}
		}
	} else {
		return fmt.Errorf("invalid JSON")
	}
	_, e = d.Token()
	return e
}

func parseOnsetSettings(data []byte) (gameSettingsParsed, error) {
	out := gameSettingsParsed{}
	if len(data) > 8*1024*1024 || !utf8.Valid(data) || !json.Valid(data) {
		return out, fmt.Errorf("invalid Onset JSON")
	}
	check := json.NewDecoder(bytes.NewReader(data))
	check.UseNumber()
	if e := onsetUniqueJSON(check); e != nil {
		return out, e
	}
	if _, e := check.Token(); e != io.EOF {
		return out, fmt.Errorf("trailing JSON")
	}
	d := json.NewDecoder(bytes.NewReader(data))
	t, _ := d.Token()
	if t != json.Delim('{') {
		return out, fmt.Errorf("Onset config must be object")
	}
	type span struct {
		start, end int
		kind       string
	}
	spans := map[string]span{}
	for d.More() {
		token, _ := d.Token()
		key := token.(string)
		start := int(d.InputOffset())
		for start < len(data) && (data[start] == ':' || data[start] == ' ' || data[start] == '\t' || data[start] == '\r' || data[start] == '\n') {
			start++
		}
		var raw json.RawMessage
		if e := d.Decode(&raw); e != nil {
			return out, e
		}
		end := int(d.InputOffset())
		kind := onsetValueKind(key, raw)
		value := string(raw)
		if kind == "text" {
			json.Unmarshal(raw, &value)
		}
		out.fields = append(out.fields, gameSetting{key: key, value: value, kind: kind, on: "true", off: "false", secret: key == "password"})
		spans[key] = span{start, end, kind}
	}
	out.patch = func(changes map[string]string) ([]byte, error) {
		replacements := map[int]struct {
			end int
			raw []byte
		}{}
		for key, value := range changes {
			s, ok := spans[key]
			if !ok || s.kind == "readonly" {
				return nil, fmt.Errorf("unknown or managed Onset setting")
			}
			raw := []byte(value)
			if s.kind == "text" {
				raw, _ = json.Marshal(value)
			}
			if onsetValueKind(key, raw) != s.kind {
				return nil, fmt.Errorf("invalid Onset setting")
			}
			replacements[s.start] = struct {
				end int
				raw []byte
			}{s.end, raw}
		}
		result := []byte{}
		for i := 0; i < len(data); {
			if r, ok := replacements[i]; ok {
				result = append(result, r.raw...)
				i = r.end
			} else {
				result = append(result, data[i])
				i++
			}
		}
		return result, nil
	}
	return out, nil
}
