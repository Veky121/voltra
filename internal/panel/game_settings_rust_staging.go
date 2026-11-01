package panel

import (
	"regexp"
	"strings"
	"unicode/utf8"
)

const rustStagingSettingsRecipe = "rust/rust_staging/egg-rust-staging.json"

// Candidate only: root must establish managed launcher, active identity path,
// stopped state, revision and file permissions before dispatching here.
// Facepunch documents tags independently from world/wipe and runtime settings.
var rustStagingScalar = regexp.MustCompile(`^([ \t]*)([A-Za-z_][A-Za-z0-9_.]*)([ \t]+)("[^"\\]*"|[^ \t"\\;]+)([ \t]*)(?://.*)?$`)

func rustStagingTags(key, value string) bool {
	if key != "server_tags" || !utf8.ValidString(value) {
		return false
	}
	if value == "" {
		return true
	}
	groups := map[string]string{"monthly": "wipe", "biweekly": "wipe", "weekly": "wipe", "vanilla": "difficulty", "hardcore": "difficulty", "softcore": "difficulty", "NA": "region", "SA": "region", "EU": "region", "WA": "region", "EA": "region", "OC": "region", "AF": "region"}
	seen := map[string]bool{}
	for _, tag := range strings.Split(value, ",") {
		group, ok := groups[tag]
		if !ok {
			switch tag {
			case "pve", "roleplay", "creative", "minigame", "training", "battlefield", "broyale", "builds", "tut", "premium":
				group = tag
			default:
				return false
			}
		}
		if seen[group] {
			return false
		}
		seen[group] = true
	}
	return true
}

// Adapt dotted Rust keys to the existing span editor, then restore every key.
// Only existing server.tags is exposed; secrets and unknown scalars never enter
// fields. Executable/ambiguous syntax makes the entire document read-only.
func parseRustStagingSettings(data []byte) (gameSettingsParsed, error) {
	lines := strings.SplitAfter(string(data), "\n")
	normalized := append([]string(nil), lines...)
	unsafe := !utf8.Valid(data)
	type keySpan struct {
		start, end int
		key        string
	}
	keys := map[int]keySpan{}
	for i, raw := range lines {
		line := strings.TrimRight(raw, "\r\n")
		for _, c := range line {
			if c == 127 || c == '\u0085' || c == '\u2028' || c == '\u2029' {
				unsafe = true
			}
		}
		trim := strings.TrimSpace(line)
		if trim == "" || strings.HasPrefix(trim, "//") {
			continue
		}
		m := rustStagingScalar.FindStringSubmatchIndex(line)
		if m == nil {
			unsafe = true
			continue
		}
		key := line[m[4]:m[5]]
		if !strings.Contains(key, ".") {
			unsafe = true
		}
		// Underscore alias must never collide with the normalized editable key.
		if strings.EqualFold(key, "server_tags") {
			unsafe = true
		}
		keys[i] = keySpan{m[4], m[5], key}
		normalized[i] = raw[:m[4]] + strings.ReplaceAll(key, ".", "_") + raw[m[5]:]
	}
	out, err := parseSourceSettingsWithSchema([]byte(strings.Join(normalized, "")), map[string]string{"server_tags": "text"}, rustStagingTags)
	if err != nil {
		return out, err
	}
	for i := range out.fields {
		out.fields[i].key = "server.tags"
		if unsafe {
			out.fields[i].kind = "readonly"
		}
	}
	patch := out.patch
	out.patch = func(changes map[string]string) ([]byte, error) {
		mapped := map[string]string{}
		for key, value := range changes {
			if unsafe || key != "server.tags" {
				return nil, bad("Rust staging setting is protected or ambiguous.")
			}
			mapped["server_tags"] = value
		}
		next, err := patch(mapped)
		if err != nil {
			return nil, err
		}
		result := strings.SplitAfter(string(next), "\n")
		for i, span := range keys {
			result[i] = result[i][:span.start] + span.key + result[i][span.end:]
		}
		return []byte(strings.Join(result, "")), nil
	}
	return out, nil
}
