package panel

import (
	"bytes"
	"encoding/xml"
	"io"
	"sort"
	"strings"
	"unicode/utf8"
)

const ragecoopRecipe = "gta/ragecoop/egg-rage-c-o-o-p.json"
const ragecoopPath = "/ragecoop/Settings.xml"
const ragecoopStartup = "exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/ragecoop-runtime.py"

// Pure snapshot validation, never process attestation. Root supplies fresh bounded,
// symlink-free Wings reads after locking, enforces RBAC/stopped state, and binds
// this revision plus native document revision before publication. No disk I/O here.
func ragecoopSettingsAuthority(recipe, configPath string, in settingsAuthorityInput) (settingsPathAuthority, error) {
	if recipe != ragecoopRecipe || configPath != ragecoopPath || in.Startup != ragecoopStartup || (in.Env["VOLTRA_SERVER_ROOT"] != "" && in.Env["VOLTRA_SERVER_ROOT"] != "/home/container") || !settingsAuthoritySources(in, map[string]string{
		".voltra/ragecoop-runtime.py": "bc134ca3e441cc97d85238c0d7838a1220972fdde7e92ddd02987c18379f584c",
		".voltra/gta-runtime.py":      "77861a5830154ed6b27e3ae25640b28b22a19071b03944f08be0c0481470d5c2",
		".voltra/native-console.py":   "7f0c2a6e4050d12fc3bb2af9dcd723df6b80109fed91a26ccd1ae52d2bb1b3a4",
	}) {
		return settingsPathAuthority{}, bad("Unproved RAGECOOP helper authority.")
	}
	if _, err := parseRagecoopSettings(in.Files["ragecoop/Settings.xml"]); err != nil {
		return settingsPathAuthority{}, err
	}
	return settingsAuthorityResult(ragecoopPath, "ragecoop-wave56:"+in.Startup), nil
}

// Retained native capture proves these two controls only. Four boot-managed
// values are visible read-only; all other scalars, credentials and nested data
// remain opaque. No defaults are inserted. Shared property XML helpers edit
// attributes and cannot represent this publisher's child-text XML layout.
func parseRagecoopSettings(data []byte) (gameSettingsParsed, error) {
	invalid := func() (gameSettingsParsed, error) {
		return gameSettingsParsed{}, bad("Invalid or ambiguous RAGECOOP XML.")
	}
	if len(data) > 1<<20 || !utf8.Valid(data) {
		return invalid()
	}
	source := append([]byte(nil), data...)
	base := 0
	if bytes.HasPrefix(source, []byte{239, 187, 191}) {
		base = 3
	}
	d := xml.NewDecoder(bytes.NewReader(source[base:]))
	type span struct {
		start, end int
		value      string
		nested     bool
	}
	spans := map[string]span{}
	seen := map[string]bool{}
	depth, roots := 0, 0
	key := ""
	for {
		before := base + int(d.InputOffset())
		tok, err := d.Token()
		after := base + int(d.InputOffset())
		if err == io.EOF {
			break
		}
		if err != nil {
			return invalid()
		}
		switch v := tok.(type) {
		case xml.Directive:
			return invalid()
		case xml.ProcInst:
			if v.Target != "xml" || before != base {
				return invalid()
			}
		case xml.StartElement:
			depth++
			if depth > 64 {
				return invalid()
			}
			if depth == 1 {
				roots++
				if roots != 1 || v.Name.Local != "Settings" || v.Name.Space != "" {
					return invalid()
				}
			}
			if depth == 2 {
				key = v.Name.Local
				fold := strings.ToLower(key)
				if seen[fold] || v.Name.Space != "" || len(v.Attr) != 0 {
					return invalid()
				}
				seen[fold] = true
				spans[key] = span{start: after, end: after}
			}
			if depth > 2 {
				s := spans[key]
				s.nested = true
				spans[key] = s
			}
		case xml.CharData:
			if depth == 0 && strings.TrimSpace(string(v)) != "" {
				return invalid()
			}
			if depth == 2 {
				s := spans[key]
				s.value += string(v)
				spans[key] = s
			}
		case xml.Comment:
			if depth == 2 {
				s := spans[key]
				s.nested = true
				spans[key] = s
			}
		case xml.EndElement:
			if depth == 2 {
				s := spans[key]
				s.end = before
				spans[key] = s
			}
			depth--
		}
	}
	if depth != 0 || roots != 1 {
		return invalid()
	}
	kinds := map[string]string{"WelcomeMessage": "text", "UseVoice": "boolean", "Port": "readonly", "Name": "readonly", "MaxPlayers": "readonly", "AnnounceSelf": "readonly"}
	out := gameSettingsParsed{}
	valid := func(k, v string) bool {
		if kinds[k] == "boolean" {
			return v == "true" || v == "false"
		}
		return k == "WelcomeMessage" && utf8.ValidString(v) && len(v) <= 4096 && strings.IndexFunc(v, func(r rune) bool { return r < 32 || r == 127 }) < 0
	}
	for key := range spans {
		for known := range kinds {
			if strings.EqualFold(key, known) && key != known {
				return invalid()
			}
		}
	}
	for _, k := range []string{"WelcomeMessage", "UseVoice", "Name", "MaxPlayers", "AnnounceSelf", "Port"} {
		s, ok := spans[k]
		if !ok {
			continue
		}
		if s.nested || s.end < s.start {
			return invalid()
		}
		if kinds[k] != "readonly" && !valid(k, s.value) {
			return invalid()
		}
		out.fields = append(out.fields, gameSetting{key: k, value: s.value, kind: kinds[k], on: "true", off: "false"})
	}
	out.patch = func(changes map[string]string) ([]byte, error) {
		keys := []string{}
		for k, v := range changes {
			s, ok := spans[k]
			if !ok || s.nested || !valid(k, v) {
				return nil, bad("Unsupported RAGECOOP edit.")
			}
			keys = append(keys, k)
		}
		sort.Slice(keys, func(i, j int) bool { return spans[keys[i]].start > spans[keys[j]].start })
		result := append([]byte(nil), source...)
		for _, k := range keys {
			var b bytes.Buffer
			if xml.EscapeText(&b, []byte(changes[k])) != nil {
				return nil, bad("Invalid XML text.")
			}
			s := spans[k]
			result = append(append(append([]byte(nil), result[:s.start]...), b.Bytes()...), result[s.end:]...)
		}
		if len(keys) > 0 {
			if _, err := parseRagecoopSettings(result); err != nil {
				return nil, err
			}
		}
		return result, nil
	}
	return out, nil
}
