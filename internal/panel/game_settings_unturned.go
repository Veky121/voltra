package panel

import (
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"
)

var unturnedChatRateNumber = regexp.MustCompile(`^[0-9]+(?:\.[0-9]+)?$`)

func validUnturnedChatRate(s string) bool {
	if !unturnedChatRateNumber.MatchString(s) {
		return false
	}
	n, err := strconv.ParseFloat(s, 64)
	return err == nil && n >= 0 && n <= 60
}

// Only documented, non-startup-owned commands are writable. Unknown
// commands, credentials, spelling, whitespace and newline bytes remain opaque.
func parseUnturnedCommandsSettings(data []byte) (gameSettingsParsed, error) {
	p := gameSettingsParsed{}
	original := string(data)
	if !utf8.Valid(data) || strings.ContainsAny(original, "\x00") {
		return p, bad("Invalid Unturned command document.")
	}
	type span struct {
		key                              string
		start, end, valueStart, valueEnd int
	}
	var spans []span
	seen := map[string]bool{}
	offset := 0
	for _, line := range strings.SplitAfter(original, "\n") {
		words := strings.Fields(line)
		if len(words) > 0 {
			key := ""
			switch strings.ToLower(words[0]) {
			case "cheats":
				key = "Cheats"
			case "chatrate":
				key = "Chatrate"
			}
			if key != "" {
				if seen[key] || (key == "Cheats" && len(words) != 1) || (key == "Chatrate" && (len(words) != 2 || !validUnturnedChatRate(words[1]))) {
					return p, bad("Ambiguous or invalid Unturned command; leave the document unchanged.")
				}
				seen[key] = true
				s := span{key: key, start: offset, end: offset + len(line)}
				field := gameSetting{key: key, value: "true", kind: "boolean", on: "true", off: "false"}
				if key == "Chatrate" {
					start := strings.Index(line, words[0]) + len(words[0])
					start += len(line[start:]) - len(strings.TrimLeft(line[start:], " \t"))
					s.valueStart, s.valueEnd = offset+start, offset+start+len(words[1])
					field.value, field.kind = words[1], "number"
				}
				spans = append(spans, s)
				p.fields = append(p.fields, field)
			}
		}
		offset += len(line)
	}
	// Cheats is a presence flag. Keeping its false state visible permits re-enabling.
	if !seen["Cheats"] {
		p.fields = append(p.fields, gameSetting{key: "Cheats", value: "false", kind: "boolean", on: "true", off: "false"})
	}
	if !seen["Chatrate"] {
		p.fields = append(p.fields, gameSetting{key: "Chatrate", value: "0.25", kind: "number"})
	}
	p.patch = func(changes map[string]string) ([]byte, error) {
		for key, value := range changes {
			if (key != "Cheats" && key != "Chatrate") || (key == "Cheats" && value != "true" && value != "false") || (key == "Chatrate" && !validUnturnedChatRate(value)) {
				return nil, bad("Only supported Unturned commands can be changed.")
			}
		}
		out := original
		for i := len(spans) - 1; i >= 0; i-- {
			s := spans[i]
			v, ok := changes[s.key]
			if !ok {
				continue
			}
			if s.key == "Cheats" {
				if v == "false" {
					out = out[:s.start] + out[s.end:]
				}
			} else {
				out = out[:s.valueStart] + v + out[s.valueEnd:]
			}
		}
		for _, key := range []string{"Cheats", "Chatrate"} {
			value, changed := changes[key]
			if !changed || seen[key] || (key == "Cheats" && value == "false") {
				continue
			}
			newline := "\n"
			if strings.Contains(original, "\r\n") {
				newline = "\r\n"
			}
			if out != "" && !strings.HasSuffix(out, "\n") && !strings.HasSuffix(out, "\r") {
				out += newline
			}
			out += key
			if key == "Chatrate" {
				out += " " + value
			}
			out += newline
		}
		return []byte(out), nil
	}
	return p, nil
}
