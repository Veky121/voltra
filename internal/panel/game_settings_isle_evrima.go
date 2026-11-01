package panel

import (
	"bytes"
	"strconv"
	"strings"
	"unicode/utf8"
)

const isleEvrimaSettingsPath = "/TheIsle/Saved/Config/LinuxServer/Game.ini"
const isleEvrimaSection = "/Script/TheIsle.TIGameSession"

// Pure existing-scalar parser. Integration must first prove native file authority;
// require the canonical emitted isle-evrima native-authority adapter.
func parseIsleEvrimaSettings(data []byte) (gameSettingsParsed, error) {
	out := gameSettingsParsed{}
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
			if strings.EqualFold(section, isleEvrimaSection) {
				if section != isleEvrimaSection || seenSection {
					return out, invalid()
				}
				seenSection = true
			}
			continue
		}
		if section != isleEvrimaSection {
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
	parsed, err := parseGameSettingsLines(isleEvrimaSettingsPath, body)
	if err != nil {
		return out, invalid()
	}
	values := map[string]gameSetting{}
	for _, f := range parsed.fields {
		values[f.key] = f
	}
	validate := func(kind, value string) bool {
		if !quickSingleLine(value) || strings.ContainsAny(value, "\"'\\#;=()[]") {
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
		f, ok := values[isleEvrimaSection+"/"+spec.key]
		if !ok {
			continue
		}
		if f.structured || f.kind == "readonly" {
			return out, invalid()
		}
		f.kind = spec.kind
		f.on = "true"
		f.off = "false"
		f.secret = spec.kind == "password"
		if spec.kind == "boolean" {
			f.value = strings.ToLower(f.value)
		}
		if (spec.key == "ServerName" && utf8.RuneCountInString(f.value) > 70) || (spec.key == "ServerPassword" && utf8.RuneCountInString(f.value) > 20) || !validate(f.kind, f.value) {
			return out, invalid()
		}
		if f.secret {
			f.value = ""
		}
		out.fields = append(out.fields, f)
	}
	out.patch = func(changes map[string]string) ([]byte, error) {
		for key, value := range changes {
			found := false
			for _, f := range out.fields {
				if key == f.key {
					found = true
					if !validate(f.kind, value) {
						return nil, invalid()
					}
				}
			}
			if !found {
				return nil, invalid()
			}
		}
		next, e := parsed.patch(changes)
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
