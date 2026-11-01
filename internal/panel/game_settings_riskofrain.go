package panel

import (
	"bytes"
	"errors"
	"regexp"
	"sort"
	"strings"
	"unicode/utf8"
)

const riskOfRainSettingsPath = "/Risk of Rain 2_Data/Config/server.cfg"

// Authority is established by the caller from the actual startup and all scripts,
// never from the catalog identity. The base adventure helper rewrites gameplay
// values; only reviewed seed-once startup/scripts can satisfy this contract.
type riskOfRainSettingsAuthority struct {
	ActivePath                                             string
	StartupReviewed, ScriptsReviewed, NativeSchemaReviewed bool
}

var riskOfRainScalar = regexp.MustCompile(`^([ \t]*)([A-Za-z_][A-Za-z0-9_]*)([ \t]+)("(?:\\["\\]|[^"\\])*"|[A-Za-z0-9_.+-]+)([ \t]*)$`)
var riskOfRainRefusal = errors.New("Risk of Rain settings require explicit active-file, startup, script and native-schema authority; ambiguous or executable CFG cannot be edited")

// parseRiskOfRainSettings preserves exact value spans. Only the publisher's
// historical string and 0/1 controls are candidates. No player limits are proven.
// Returned secret fields carry no plaintext. Omitted secrets remain unchanged.
func parseRiskOfRainSettings(data []byte, authority riskOfRainSettingsAuthority) (gameSettingsParsed, error) {
	out := gameSettingsParsed{fields: []gameSetting{}}
	if authority.ActivePath != riskOfRainSettingsPath || !authority.StartupReviewed || !authority.ScriptsReviewed || !authority.NativeSchemaReviewed {
		return out, riskOfRainRefusal
	}
	return parseRiskOfRainCandidateGrammar(data)
}

// Candidate grammar only; this does not establish native command semantics.
func parseRiskOfRainCandidateGrammar(data []byte) (gameSettingsParsed, error) {
	out := gameSettingsParsed{fields: []gameSetting{}}
	if !utf8.Valid(data) {
		return out, riskOfRainRefusal
	}
	type span struct {
		start, end int
		quoted     bool
	}
	spans := map[string]span{}
	seen := map[string]bool{}
	// Split top-level statements while retaining comments and byte offsets.
	start, quoted, comment, escaped := 0, false, false, false
	consume := func(end int) error {
		raw := string(data[start:end])
		prefix := 0
		if start == 0 && strings.HasPrefix(raw, "\xef\xbb\xbf") {
			prefix = 3
			raw = raw[3:]
		}
		if strings.TrimSpace(raw) == "" {
			return nil
		}
		m := riskOfRainScalar.FindStringSubmatchIndex(raw)
		if m == nil {
			return riskOfRainRefusal
		}
		key := raw[m[4]:m[5]]
		lower := strings.ToLower(key)
		// Unknown scalar statements are refused. Programs,
		// aliases and includes cannot establish an effective-value authority.
		known := lower == "sv_hostname" || lower == "sv_password" || lower == "steam_server_heartbeat_enabled" || lower == "sv_maxplayers" || lower == "sv_port" || lower == "steam_server_query_port" || lower == "steam_server_steam_port"
		if !known {
			return riskOfRainRefusal
		}
		if seen[lower] || key != lower {
			return riskOfRainRefusal
		}
		seen[lower] = true
		a, b := start+prefix+m[8], start+prefix+m[9]
		value := string(data[a:b])
		q := strings.HasPrefix(value, "\"")
		if q {
			value = value[1 : len(value)-1]
			value = strings.NewReplacer(`\"`, `"`, `\\`, `\`).Replace(value)
		}
		kind := "readonly"
		switch key {
		case "sv_hostname", "sv_password":
			if !q {
				return riskOfRainRefusal
			}
			kind = "text"
		case "steam_server_heartbeat_enabled":
			if q || value != "0" && value != "1" {
				return riskOfRainRefusal
			}
			kind = "boolean"
		}
		f := gameSetting{key: key, value: value, kind: kind, secret: key == "sv_password"}
		if f.secret {
			f.value = ""
		}
		if kind == "boolean" {
			f.on = "1"
			f.off = "0"
		}
		out.fields = append(out.fields, f)
		if kind != "readonly" {
			spans[key] = span{a, b, q}
		}
		return nil
	}
	for i, c := range data {
		if comment {
			if c == '\n' {
				comment = false
				start = i + 1
			}
			continue
		}
		if escaped {
			if c != '"' && c != '\\' {
				return gameSettingsParsed{}, riskOfRainRefusal
			}
			escaped = false
			continue
		}
		if quoted && c == '\\' {
			escaped = true
			continue
		}
		if c == '"' {
			quoted = !quoted
			continue
		}
		if quoted && (c == '\r' || c == '\n') {
			return gameSettingsParsed{}, riskOfRainRefusal
		}
		if c == '\\' || c < 32 && c != '\t' && c != '\r' && c != '\n' || c == 127 {
			return gameSettingsParsed{}, riskOfRainRefusal
		}
		if !quoted && c == '/' && i+1 < len(data) && data[i+1] == '/' {
			if err := consume(i); err != nil {
				return gameSettingsParsed{}, err
			}
			comment = true
			continue
		}
		if !quoted && (c == ';' || c == '\n' || c == '\r') {
			if err := consume(i); err != nil {
				return gameSettingsParsed{}, err
			}
			start = i + 1
		}
	}
	if quoted || escaped {
		return gameSettingsParsed{}, riskOfRainRefusal
	}
	if !comment {
		if err := consume(len(data)); err != nil {
			return gameSettingsParsed{}, err
		}
	}
	original := bytes.Clone(data)
	out.patch = func(changes map[string]string) ([]byte, error) {
		type edit struct {
			span
			value string
		}
		edits := []edit{}
		for key, value := range changes {
			s, ok := spans[key]
			if !ok {
				return nil, riskOfRainRefusal
			}
			// Encode only the native quoted-string subset: quote and backslash.
			// Separators inside these quotes are data; controls cannot cross lines.
			if !utf8.ValidString(value) {
				return nil, riskOfRainRefusal
			}
			for _, c := range value {
				if c < 32 || c == 127 {
					return nil, riskOfRainRefusal
				}
			}
			if key == "steam_server_heartbeat_enabled" && value != "0" && value != "1" {
				return nil, riskOfRainRefusal
			}
			if s.quoted {
				value = "\"" + strings.NewReplacer(`\`, `\\`, `"`, `\"`).Replace(value) + "\""
			}
			edits = append(edits, edit{s, value})
		}
		sort.Slice(edits, func(i, j int) bool { return edits[i].start > edits[j].start })
		result := bytes.Clone(original)
		for _, e := range edits {
			result = append(append(append([]byte{}, result[:e.start]...), []byte(e.value)...), result[e.end:]...)
		}
		return result, nil
	}
	return out, nil
}
