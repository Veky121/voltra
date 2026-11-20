package gamesettings

import (
	"bytes"
	"strconv"
	"strings"
	"unicode/utf8"
)

const IsleEvrimaSettingsPath = "/TheIsle/Saved/Config/LinuxServer/Game.ini"
const IsleEvrimaSection = "/Script/TheIsle.TIGameSession"

// Pure existing-scalar parser. Integration must first prove native file authority;
// require the canonical emitted isle-evrima native-authority adapter.
func parseIsleEvrimaSettings(data []byte) (Parsed, error) {
	out := Parsed{}
	invalid := func() error { return bad("Unsupported or ambiguous Evrima settings.") }
	if len(data) > 8*1024*1024 || !utf8.Valid(data) || bytes.ContainsRune(data, 0) {
		return out, invalid()
	}
	body := bytes.TrimPrefix(data, []byte{239, 187, 191})
	specs := []struct{ key, kind string }{
		{"ServerName", "text"}, {"MaxPlayerCount", "number"},
		{"bEnableHumans", "boolean"}, {"bServerPassword", "boolean"}, {"ServerPassword", "password"},
		{"bAllowReplay", "boolean"}, {"bServerDynamicWeather", "boolean"},
	}
	// Reject case variants, duplicate sections/scalars and Unreal array aliases of
	// editable scalars. Unknown repeated arrays remain byte-for-byte opaque.
	section := ""
	seenSection := false
	seen := map[string]bool{}
	for _, line := range strings.Split(string(body), "\n") {
		t := strings.TrimSpace(line)
		if t == "" || strings.HasPrefix(t, ";") || strings.HasPrefix(t, "#") {
			continue
		}
		if strings.HasPrefix(t, "[") {
			end := strings.IndexByte(t, ']')
			if end < 0 {
				return out, invalid()
			}
			section = t[1:end]
			if strings.EqualFold(section, IsleEvrimaSection) {
				if section != IsleEvrimaSection || seenSection {
					return out, invalid()
				}
				seenSection = true
			}
			continue
		}
		if section != IsleEvrimaSection {
			continue
		}
		eq := strings.IndexByte(t, '=')
		if eq < 0 {
			continue
		}
		name := strings.TrimSpace(t[:eq])
		alias := strings.TrimSpace(strings.TrimLeft(name, "+-.!"))
		for _, spec := range specs {
			if strings.EqualFold(alias, spec.key) {
				if name != spec.key || seen[spec.key] {
					return out, invalid()
				}
				seen[spec.key] = true
			}
		}
	}
	parsed, err := parseGameSettingsLines(IsleEvrimaSettingsPath, body)
	if err != nil {
		return out, invalid()
	}
	values := map[string]Setting{}
	for _, f := range parsed.Fields {
		values[f.Key] = f
	}
	validate := func(kind, value string) bool {
		if !QuickSingleLine(value) || strings.ContainsAny(value, "\"'\\#;=()[]") {
			return false
		}
		switch kind {
		case "boolean":
			return value == "true" || value == "false"
		case "number":
			// Lexical integer validity only: no publisher gameplay bound asserted.
			if value == "" || strings.Trim(value, "0123456789") != "" {
				return false
			}
			n, e := strconv.ParseUint(value, 10, 64)
			return e == nil && n >= 1 && n <= 10000
		}
		return true
	}
	for _, spec := range specs {
		f, ok := values[IsleEvrimaSection+"/"+spec.key]
		if !ok {
			continue
		}
		if f.structured || f.Kind == "readonly" {
			return out, invalid()
		}
		f.Kind = spec.kind
		f.On = "true"
		f.Off = "false"
		f.Secret = spec.kind == "password"
		if spec.kind == "boolean" {
			f.Value = strings.ToLower(f.Value)
		}
		if (spec.key == "ServerName" && utf8.RuneCountInString(f.Value) > 70) || (spec.key == "ServerPassword" && utf8.RuneCountInString(f.Value) > 20) || !validate(f.Kind, f.Value) {
			return out, invalid()
		}
		if f.Secret {
			f.Value = ""
		}
		out.Fields = append(out.Fields, f)
	}
	out.Patch = func(changes map[string]string) ([]byte, error) {
		for key, value := range changes {
			found := false
			for _, f := range out.Fields {
				if key == f.Key {
					found = true
					if !validate(f.Kind, value) {
						return nil, invalid()
					}
				}
			}
			if !found {
				return nil, invalid()
			}
		}
		next, e := parsed.Patch(changes)
		if e != nil {
			return nil, invalid()
		}
		if _, e = parseIsleEvrimaSettings(next); e != nil {
			return nil, e
		}
		if len(body) != len(data) {
			next = append([]byte{239, 187, 191}, next...)
		}
		return next, nil
	}
	return out, nil
}
