package panel

import (
	"errors"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"
)

// TruckSIIField is metadata for the shared settings controls. No defaults are seeded.
type TruckSIIField struct {
	Key, Label, Group, Kind string
	Max                     int
}

func TruckSIIFields() []TruckSIIField {
	out := []TruckSIIField{{"lobby_name", "Lobby name", "General", "string", 63}, {"description", "Description", "General", "string", 63}, {"welcome_message", "Welcome message", "General", "string", 127}, {"max_players", "Maximum players", "General", "integer", 8}, {"timezones", "Time zones", "General", "integer", 2}}
	for _, key := range []string{"player_damage", "traffic", "hide_in_company", "hide_colliding", "force_speed_limiter", "mods_optioning", "service_no_collision", "in_menu_ghosting", "name_tags"} {
		out = append(out, TruckSIIField{key, strings.ReplaceAll(key, "_", " "), "Gameplay", "boolean", 0})
	}
	return out
}

type truckSIISpan struct {
	start, end int
	value      any
}

// TruckSII contains only editable, non-secret publisher scalars. The source is private.
type TruckSII struct {
	source string
	spans  map[string]truckSIISpan
}

var truckSIIUnit = regexp.MustCompile(`^[a-z_][a-z0-9_]*[ \t]*:[ \t]*[a-zA-Z0-9_.]+[ \t]*\{$`)
var truckSIIRow = regexp.MustCompile(`^([ \t]*)([a-z_][a-z0-9_]*(?:\[[0-9]*\])?)([ \t]*:[ \t]*)(.*)$`)
var truckSIIAtom = regexp.MustCompile(`^(?:true|false|[-+]?[0-9]+(?:\.[0-9]+)?|[a-zA-Z0-9_][a-zA-Z0-9_.]*)$`)

func truckSIIError() error { return errors.New("unsupported or ambiguous truck SII document") }

// truckSIICode separates a line comment without interpreting quoted content.
func truckSIICode(s string) (string, bool) {
	quote, escape := false, false
	for i := 0; i < len(s); i++ {
		c := s[i]
		if quote {
			if escape {
				if c != '"' && c != '\\' {
					return "", false
				}
				escape = false
			} else if c == '\\' {
				escape = true
			} else if c == '"' {
				quote = false
			}
			continue
		}
		if c == '"' {
			quote = true
		}
		if c == '#' {
			return "", false
		}
		if c == '/' && i+1 < len(s) && s[i+1] == '/' {
			return strings.TrimRight(s[:i], " \t\r"), true
		}
	}
	return strings.TrimRight(s, " \t\r"), !quote && !escape
}
func truckSIIValue(f TruckSIIField, raw string) (any, error) {
	switch f.Kind {
	case "string":
		v, e := strconv.Unquote(raw)
		if e != nil || !strings.HasPrefix(raw, `"`) || utf8.RuneCountInString(v) > f.Max {
			return nil, truckSIIError()
		}
		for _, c := range v {
			if c < 32 || c == 127 {
				return nil, truckSIIError()
			}
		}
		return v, nil
	case "boolean":
		if raw == "true" {
			return true, nil
		}
		if raw == "false" {
			return false, nil
		}
	case "integer":
		n, e := strconv.Atoi(raw)
		min := 0
		if f.Key == "max_players" {
			min = 1
		}
		if e == nil && n >= min && n <= f.Max {
			return n, nil
		}
	}
	return nil, truckSIIError()
}

// ParseTruckSII accepts a bounded, line-oriented scalar subset. Unknown flat units
// and array rows survive unchanged. Directives, nested blocks and expressions refuse.
func ParseTruckSII(data []byte) (*TruckSII, error) {
	if len(data) > 1024*1024 || !utf8.Valid(data) || strings.ContainsAny(string(data), "\x00") {
		return nil, truckSIIError()
	}
	d := &TruckSII{string(data), map[string]truckSIISpan{}}
	rules := map[string]TruckSIIField{}
	for _, f := range TruckSIIFields() {
		rules[f.Key] = f
	}
	state, targets, offset := 0, 0, 0
	target := false
	seen := map[string]bool{}
	for _, line := range strings.SplitAfter(d.source, "\n") {
		raw := strings.TrimSuffix(line, "\n")
		if offset == 0 {
			raw = strings.TrimPrefix(raw, "\ufeff")
		}
		code, ok := truckSIICode(raw)
		if !ok {
			return nil, truckSIIError()
		}
		s := strings.TrimSpace(code)
		if s != "" {
			switch state {
			case 0:
				if s != "SiiNunit" {
					return nil, truckSIIError()
				}
				state = 1
			case 1:
				if s != "{" {
					return nil, truckSIIError()
				}
				state = 2
			case 2:
				if s == "}" {
					state = 4
					break
				}
				nextState := 3
				if !strings.HasSuffix(s, "{") {
					s += " {"
					nextState = 5
				}
				if !truckSIIUnit.MatchString(s) {
					return nil, truckSIIError()
				}
				target = strings.TrimSpace(strings.SplitN(s, ":", 2)[0]) == "server_config"
				if target {
					targets++
					if targets > 1 {
						return nil, truckSIIError()
					}
				}
				seen = map[string]bool{}
				state = nextState
			case 5:
				if s != "{" {
					return nil, truckSIIError()
				}
				state = 3
			case 3:
				if s == "}" {
					state = 2
					break
				}
				m := truckSIIRow.FindStringSubmatch(code)
				if m == nil {
					return nil, truckSIIError()
				}
				key, value := m[2], m[4]
				if seen[key] && !strings.Contains(key, "[") {
					return nil, truckSIIError()
				}
				seen[key] = true
				if strings.HasPrefix(value, `"`) {
					if _, e := strconv.Unquote(value); e != nil {
						return nil, truckSIIError()
					}
				} else if !truckSIIAtom.MatchString(value) {
					return nil, truckSIIError()
				}
				if f, exists := rules[key]; target && exists {
					v, e := truckSIIValue(f, value)
					if e != nil {
						return nil, e
					}
					start := offset + len(m[1]) + len(key) + len(m[3])
					d.spans[key] = truckSIISpan{start, start + len(value), v}
				}
			default:
				return nil, truckSIIError()
			}
		}
		offset += len(line)
	}
	if state != 4 || targets != 1 {
		return nil, truckSIIError()
	}
	return d, nil
}
func (d *TruckSII) Values() map[string]any {
	out := map[string]any{}
	for k, s := range d.spans {
		out[k] = s.value
	}
	return out
}

// Patch never adds missing keys or accepts managed identity/network/secret fields.
// All changes validate before a new byte slice is returned; no filesystem IO occurs.
func (d *TruckSII) Patch(changes map[string]any) ([]byte, error) {
	replacements := map[int]string{}
	ends := map[int]int{}
	rules := map[string]TruckSIIField{}
	for _, f := range TruckSIIFields() {
		rules[f.Key] = f
	}
	for k, v := range changes {
		s, ok := d.spans[k]
		if !ok {
			return nil, truckSIIError()
		}
		f := rules[k]
		var encoded string
		switch f.Kind {
		case "string":
			x, ok := v.(string)
			if !ok {
				return nil, truckSIIError()
			}
			encoded = strconv.Quote(x)
		case "boolean":
			x, ok := v.(bool)
			if !ok {
				return nil, truckSIIError()
			}
			encoded = strconv.FormatBool(x)
		case "integer":
			x, ok := v.(int)
			if !ok {
				return nil, truckSIIError()
			}
			encoded = strconv.Itoa(x)
		}
		if _, e := truckSIIValue(f, encoded); e != nil {
			return nil, e
		}
		replacements[s.start] = encoded
		ends[s.start] = s.end
	}
	var out strings.Builder
	for i := 0; i < len(d.source); {
		if v, ok := replacements[i]; ok {
			out.WriteString(v)
			i = ends[i]
		} else {
			out.WriteByte(d.source[i])
			i++
		}
	}
	return []byte(out.String()), nil
}
