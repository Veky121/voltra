package panel

import (
	"bytes"
	"encoding/xml"
	"io"
	"math"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// parseSTKGameSettings is exclusively for the STK v6 server-config document.
// Dispatch must be scoped to the reviewed STK egg and resolved CONFIG_NAME;
// neither an XML extension nor the unrelated serverconfig.xml schema suffices.
func parseSTKGameSettings(data []byte) (gameSettingsParsed, error) {
	invalid := func() (gameSettingsParsed, error) {
		return gameSettingsParsed{}, bad("Invalid or unsupported STK v6 settings document")
	}
	if len(data) > 1024*1024 {
		return invalid()
	}
	source := append([]byte(nil), data...)
	decoder := xml.NewDecoder(bytes.NewReader(source))
	type span struct {
		start, end int
		value      string
	}
	spans := map[string]span{}
	out := gameSettingsParsed{}
	depth, roots := 0, 0
	active := ""
	for {
		start := int(decoder.InputOffset())
		token, err := decoder.Token()
		end := int(decoder.InputOffset())
		if err == io.EOF {
			break
		}
		if err != nil {
			return invalid()
		}
		switch t := token.(type) {
		case xml.Directive:
			return invalid()
		case xml.ProcInst:
			if t.Target != "xml" || roots != 0 {
				return invalid()
			}
		case xml.StartElement:
			if active != "" {
				return invalid()
			}
			depth++
			if depth == 1 {
				roots++
				if roots != 1 || t.Name.Space != "" || t.Name.Local != "server-config" || len(t.Attr) != 1 || t.Attr[0].Name.Space != "" || t.Attr[0].Name.Local != "version" || t.Attr[0].Value != "6" {
					return invalid()
				}
			} else if depth == 2 {
				key := t.Name.Local
				rule, known := stkSettingRules[key]
				if !known || t.Name.Space != "" {
					continue
				}
				if _, exists := spans[key]; exists {
					return invalid()
				}
				seen := map[xml.Name]bool{}
				value := ""
				count := 0
				for _, a := range t.Attr {
					if seen[a.Name] {
						return invalid()
					}
					seen[a.Name] = true
					if a.Name.Space == "" && a.Name.Local == "value" {
						value = a.Value
						count++
					}
				}
				if count != 1 || !rule.valid(value) {
					return invalid()
				}
				raw := source[start:end]
				matches := stkValueAttribute.FindAllSubmatchIndex(raw, -1)
				if len(matches) != 1 {
					return invalid()
				}
				m := matches[0]
				lo, hi := m[4], m[5]
				if lo < 0 {
					lo, hi = m[6], m[7]
				}
				spans[key] = span{start + lo, start + hi, value}
				kind := rule.kind
				if kind == "integer" {
					kind = "number"
				}
				out.fields = append(out.fields, gameSetting{key: key, value: value, kind: kind, on: "true", off: "false"})
				active = key
			}
		case xml.EndElement:
			if depth == 2 {
				active = ""
			}
			depth--
		case xml.CharData:
			if (active != "" || depth == 0) && strings.TrimSpace(string(t)) != "" {
				return invalid()
			}
		}
	}
	if roots != 1 || depth != 0 {
		return invalid()
	}
	out.patch = func(values map[string]string) ([]byte, error) {
		keys := make([]string, 0, len(values))
		for key, value := range values {
			if _, ok := spans[key]; !ok || !stkSettingRules[key].valid(value) {
				return nil, bad("Invalid or unsupported STK setting")
			}
			keys = append(keys, key)
		}
		sort.Slice(keys, func(i, j int) bool { return spans[keys[i]].start > spans[keys[j]].start })
		result := append([]byte(nil), source...)
		for _, key := range keys {
			s := spans[key]
			if values[key] == s.value {
				continue
			}
			var escaped bytes.Buffer
			if err := xml.EscapeText(&escaped, []byte(values[key])); err != nil {
				return nil, bad("Invalid STK setting")
			}
			next := make([]byte, 0, len(result)+escaped.Len())
			next = append(next, result[:s.start]...)
			next = append(next, escaped.Bytes()...)
			next = append(next, result[s.end:]...)
			result = next
		}
		return result, nil
	}
	return out, nil
}

var stkValueAttribute = regexp.MustCompile(`\svalue\s*=\s*("([^"]*)"|'([^']*)')`)

type stkSettingRule struct {
	kind      string
	low, high float64
	choices   string
}

func (r stkSettingRule) valid(value string) bool {
	if r.kind == "boolean" {
		return value == "true" || value == "false"
	}
	if r.choices != "" {
		return strings.Contains("|"+r.choices+"|", "|"+value+"|")
	}
	if strings.TrimSpace(value) != value || value == "" {
		return false
	}
	n, err := strconv.ParseFloat(value, 64)
	if err != nil || math.IsNaN(n) || math.IsInf(n, 0) || n < r.low || n > r.high {
		return false
	}
	if r.kind == "integer" {
		_, err = strconv.ParseInt(value, 10, 32)
		return err == nil
	}
	return true
}

// Deliberately excludes credentials, SQL paths, listener/security configuration,
// and CLI-owned server-name/mode/difficulty/slots/MOTD.
var stkSettingRules = map[string]stkSettingRule{
	"chat": {kind: "boolean"}, "track-voting": {kind: "boolean"},
	"owner-less": {kind: "boolean"}, "auto-end": {kind: "boolean"},
	"team-choosing": {kind: "boolean"}, "soccer-goal-target": {kind: "boolean"},
	"live-spectate": {kind: "boolean"}, "real-addon-karts": {kind: "boolean"},
	"voting-timeout":            {kind: "integer", low: 1, high: 600},
	"min-start-game-players":    {kind: "integer", low: 1, high: 24},
	"gp-track-count":            {kind: "integer", low: 1, high: 20},
	"max-players-in-game":       {kind: "integer", low: 0, high: 24},
	"start-game-counter":        {kind: "number", low: 0, high: 600},
	"official-karts-threshold":  {kind: "number", low: 0, high: 1},
	"official-tracks-threshold": {kind: "number", low: 0, high: 1},
	"flag-return-timeout":       {kind: "number", low: 0, high: 600},
	"flag-deactivated-time":     {kind: "number", low: 0, high: 60},
	"hit-limit":                 {kind: "integer", low: 0, high: 1000},
	"capture-limit":             {kind: "integer", low: 0, high: 1000},
	"time-limit-ffa":            {kind: "number", low: 0, high: 86400},
	"time-limit-ctf":            {kind: "number", low: 0, high: 86400},
}
