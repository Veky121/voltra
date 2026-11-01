package panel

import (
	"bytes"
	"strings"
)

// parseDDNetOriginalSettings is restricted to the original DDNet recipe's
// seed-once root autoexec. The one fixed base exec must run before all six
// editable scalar statements. Any other execution/order ambiguity is read-only.
func parseDDNetOriginalSettings(data []byte) (gameSettingsParsed, error) {
	readonly := func() (gameSettingsParsed, error) {
		out, err := parseDDNetSettings(data)
		for i := range out.fields {
			out.fields[i].kind = "readonly"
		}
		out.patch = func(changes map[string]string) ([]byte, error) {
			if len(changes) != 0 {
				return nil, bad("This DDNet configuration requires Files editing.")
			}
			return bytes.Clone(data), nil
		}
		return out, err
	}
	lines := strings.SplitAfter(string(data), "\n")
	start, stop, offset := -1, -1, 0
	counts := map[string]int{}
	statements := 0
	for _, raw := range lines {
		line := strings.TrimRight(raw, "\r\n")
		trim := strings.TrimSpace(line)
		if trim == "" || strings.HasPrefix(trim, "#") {
			offset += len(raw)
			continue
		}
		if statements == 0 && trim == "exec data/autoexec_server.cfg" {
			start, stop = offset, offset+len(line)
			statements++
			offset += len(raw)
			continue
		}
		if start < 0 {
			return readonly()
		}
		m := ddnetCvarLine.FindStringSubmatch(line)
		if m == nil || m[2] != strings.ToLower(m[2]) {
			return readonly()
		}
		key, value := m[2], strings.Trim(m[4], "\"")
		_, known := ddnetSettingKinds[key]
		if !known && key != "password" && key != "sv_rcon_password" {
			return readonly()
		}
		counts[key]++
		if counts[key] != 1 || known && !ddnetSettingValue(key, value) {
			return readonly()
		}
		statements++
		offset += len(raw)
	}
	if start < 0 {
		return readonly()
	}
	for key := range ddnetSettingKinds {
		if counts[key] != 1 {
			return readonly()
		}
	}
	// Mask only the separately proven fixed first exec while reusing the shared
	// conservative scalar parser. Its byte length and every subsequent span stay
	// unchanged; restore the exact original exec bytes after any scalar patch.
	masked := bytes.Clone(data)
	for i := start; i < stop; i++ {
		masked[i] = ' '
	}
	masked[start] = '#'
	out, err := parseDDNetSettings(masked)
	if err != nil {
		return out, err
	}
	registrationBoolean := false
	for i := range out.fields {
		f := &out.fields[i]
		if f.key == "sv_register" && f.kind != "readonly" && (f.value == "0" || f.value == "1") {
			f.kind, f.on, f.off = "boolean", "1", "0"
			registrationBoolean = true
		}
	}
	patch := out.patch
	out.patch = func(changes map[string]string) ([]byte, error) {
		if value, changed := changes["sv_register"]; changed && registrationBoolean && value != "0" && value != "1" {
			return nil, bad("Public listing must be enabled or disabled.")
		}
		next, err := patch(changes)
		if err != nil {
			return nil, err
		}
		copy(next[start:stop], data[start:stop])
		return next, nil
	}
	return out, nil
}
