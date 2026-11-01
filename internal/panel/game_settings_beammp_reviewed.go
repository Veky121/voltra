package panel

import (
	"bytes"
	"github.com/pelletier/go-toml/v2"
	"strconv"
	"strings"
	"unicode/utf8"
)

// Existing fields only. Authority, active path, mutation lock and final guards remain caller-owned.
func parseBeamMPReviewedSettings(data []byte, seeds ...M) (gameSettingsParsed, error) {
	bom := []byte{239, 187, 191}
	hasBOM := bytes.HasPrefix(data, bom)
	raw := data
	if hasBOM {
		raw = data[3:]
	}
	var native map[string]any
	if toml.Unmarshal(raw, &native) != nil {
		return gameSettingsParsed{}, bad("Invalid BeamMP TOML; repair in Files.")
	}
	p, err := parseGameSettings("/ServerConfig.toml", raw)
	if err != nil {
		return p, err
	}
	types := map[string]string{"Name": "text", "Description": "text", "AuthKey": "text", "Map": "text", "Private": "boolean", "LogChat": "boolean", "MaxPlayers": "number", "MaxCars": "number", "Tags": "text", "AllowGuests": "boolean", "InformationPacket": "boolean", "Debug": "boolean", "ResourceFolder": "text", "Port": "number"}
	// Case aliases cannot acquire authority or coexist ambiguously with reviewed keys.
	for table, v := range native {
		if strings.EqualFold(table, "General") {
			if table != "General" {
				return p, bad("Ambiguous General table; use Files.")
			}
			if m, ok := v.(map[string]any); ok {
				for key := range m {
					for known := range types {
						if strings.EqualFold(key, known) && key != known {
							return p, bad("Ambiguous General key; use Files.")
						}
					}
				}
			}
		}
	}
	allowed := map[string]string{}
	general, _ := native["General"].(map[string]any)
	for i := range p.fields {
		f := &p.fields[i]
		key := strings.TrimPrefix(f.key, "General/")
		typ := types[key]
		if f.key != "General/"+key || typ == "" || key == "ResourceFolder" || key == "Port" {
			f.kind = "readonly"
			continue
		}
		v, ok := general[key]
		valid := false
		switch typ {
		case "text":
			_, valid = v.(string)
		case "boolean":
			_, valid = v.(bool)
		case "number":
			_, valid = v.(int64)
		}
		if !ok || !valid {
			f.kind = "readonly"
			continue
		}
		allowed[f.key] = typ
	}
	patch := p.patch
	p.patch = func(changes map[string]string) ([]byte, error) {
		for key, value := range changes {
			typ := allowed[key]
			if typ == "" {
				return nil, bad("Absent, managed, unreviewed or path setting; use Files.")
			}
			switch typ {
			case "boolean":
				if value != "true" && value != "false" {
					return nil, bad("Use a native boolean.")
				}
			case "number":
				n, e := strconv.Atoi(value)
				low, high := 0, 10
				if key == "General/MaxPlayers" {
					low, high = 1, 100
				}
				if e != nil || n < low || n > high || strconv.Itoa(n) != value {
					return nil, bad("Invalid BeamMP integer.")
				}
			case "text":
				limit := 1024
				if key == "General/AuthKey" {
					limit = 64
				}
				if !utf8.ValidString(value) || utf8.RuneCountInString(value) > limit || (key == "General/AuthKey" && value == "") {
					return nil, bad("Invalid BeamMP text length.")
				}
				for _, c := range value {
					if c < 32 || c == 127 {
						return nil, bad("Invalid BeamMP control character.")
					}
				}
			}
		}
		out, e := patch(changes)
		if e != nil {
			return nil, e
		}
		var check map[string]any
		if toml.Unmarshal(out, &check) != nil {
			return nil, bad("Invalid resulting TOML.")
		}
		if e = validateBeamMPEffective(check, seeds...); e != nil {
			return nil, e
		}
		if hasBOM {
			out = append(append([]byte{}, bom...), out...)
		}
		return out, nil
	}
	return p, nil
}
