package gamesettings

import (
	"path"
	"strings"
	"unicode"
)

// gameSettingsINICaseSafety must run before structured-value expansion. It
// changes editor metadata only; the existing span patcher retains source bytes.
// Both the UI and direct patch calls are fenced, including operator arrays.
func gameSettingsINICaseSafety(file string, data []byte, parsed Parsed) Parsed {
	if !gameSettingsCaseInsensitiveINI(file, data) {
		return parsed
	}
	identities := map[string][]int{}
	blocked := map[string]bool{}
	for i, field := range parsed.Fields {
		section, name := "", field.Key
		if cut := strings.LastIndexByte(name, '/'); cut >= 0 {
			section, name = name[:cut], name[cut+1:]
		}
		if strings.ContainsAny(name[:min(1, len(name))], "+-.!") {
			blocked[field.Key] = true
			continue
		}
		// Use separate components so section/key boundaries cannot collide.
		identity := INIFold(section) + "\x00" + INIFold(name)
		identities[identity] = append(identities[identity], i)
	}
	for _, indexes := range identities {
		if len(indexes) > 1 {
			for _, i := range indexes {
				blocked[parsed.Fields[i].Key] = true
			}
		}
	}
	for i := range parsed.Fields {
		if blocked[parsed.Fields[i].Key] {
			parsed.Fields[i].Kind = "readonly"
			parsed.Fields[i].structured = false
			// Do not expose an arbitrary shadowed value, especially a secret.
			parsed.Fields[i].Value = "Ambiguous or array setting; edit in Files."
		}
	}
	patch := parsed.Patch
	parsed.Patch = func(changes map[string]string) ([]byte, error) {
		for key := range changes {
			if blocked[key] {
				return nil, bad("Ambiguous or array configuration values must be edited in Files.")
			}
		}
		return patch(changes)
	}
	return parsed
}

func gameSettingsCaseInsensitiveINI(file string, data []byte) bool {
	file = strings.ToLower(strings.ReplaceAll(file, "\\", "/"))
	if path.Ext(file) != ".ini" {
		return false
	}
	if strings.Contains("/"+file, "/windowsserver/") || strings.Contains("/"+file, "/saved/config/") {
		return true
	}
	for _, line := range strings.Split(string(data), "\n") {
		if strings.HasPrefix(strings.ToLower(strings.TrimSpace(line)), "[/script/") {
			return true
		}
	}
	return false
}

// Canonicalize Unicode simple-fold cycles, matching strings.EqualFold rather
// than lowercasing only. Original field names and file bytes remain unchanged.
func INIFold(value string) string {
	return strings.Map(func(r rune) rune {
		minimum := r
		for next := unicode.SimpleFold(r); next != r; next = unicode.SimpleFold(next) {
			if next < minimum {
				minimum = next
			}
		}
		return minimum
	}, value)
}
