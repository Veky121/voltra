package panel

import (
	"bytes"
	"math"
	"strconv"
	"strings"
	"unicode/utf8"
)

const cssSettingsPath = "/cstrike/cfg/server.cfg"

type cssScalarSpec struct {
	kind             string
	minimum, maximum float64
	integer          bool
}

// Fresh per-call specs. Native limits/defaults were measured from Valve
// app232330 public build25338297. maxrounds/timelimit upper bounds are explicit
// conservative UI limits, not claimed publisher hard maxima.
func cssScalarSchema() map[string]cssScalarSpec {
	return map[string]cssScalarSpec{
		"mp_friendlyfire":    {"boolean", 0, 1, true},
		"mp_autoteambalance": {"number", 0, 2, true},
		"mp_limitteams":      {"number", 0, 30, true},
		"mp_roundtime":       {"number", 1, 9, false},
		"mp_freezetime":      {"number", 0, 60, true},
		"mp_maxrounds":       {"number", 0, 1000000, true},
		"mp_timelimit":       {"number", 0, 10080, false},
	}
}

func cssScalarValue(specs map[string]cssScalarSpec, key, value string) bool {
	spec, known := specs[key]
	if !known || len(value) > 32 || !sourceNumber.MatchString(value) {
		return false
	}
	if spec.kind == "boolean" {
		return value == "0" || value == "1"
	}
	n, err := strconv.ParseFloat(value, 64)
	return err == nil && !math.IsNaN(n) && !math.IsInf(n, 0) && n >= spec.minimum && n <= spec.maximum && (!spec.integer || math.Trunc(n) == n)
}

func parseCSSSettings(data []byte) (gameSettingsParsed, error) {
	if len(data) > 8*1024*1024 || !utf8.Valid(data) || bytes.Count(data, []byte{'\n'}) > 100000 || bytes.HasPrefix(data, []byte{0xef, 0xbb, 0xbf}) {
		return gameSettingsParsed{}, bad("Invalid or oversized CSS settings document.")
	}
	specs := cssScalarSchema()
	kinds := make(map[string]string, len(specs))
	for key, spec := range specs {
		kinds[key] = spec.kind
	}
	out, err := parseSourceSettingsWithSchema(data, kinds, func(key, value string) bool { return cssScalarValue(specs, key, value) })
	if err != nil {
		return out, err
	}
	unsafe := false
	for _, raw := range strings.Split(string(data), "\n") {
		line := strings.TrimRight(raw, "\r")
		if len(line) > 65536 || strings.ContainsAny(line, "\r\u0085\u2028\u2029") {
			return gameSettingsParsed{}, bad("Unsupported CSS settings line.")
		}
		trim := strings.TrimSpace(line)
		if trim == "" || strings.HasPrefix(trim, "//") {
			continue
		}
		// A quoted command head is outside the shared scalar lexer. It can
		// hide another assignment or include, so effective authority is unknown.
		if strings.HasPrefix(trim, "\"") {
			unsafe = true
		}
		key := trim
		if end := strings.IndexAny(key, " \t;=\""); end >= 0 {
			key = key[:end]
		}
		switch strings.ToLower(key) {
		case "exec", "execifexists", "alias", "cmd", "script", "script_execute", "plugin_load", "sm_cvar":
			unsafe = true
		}
	}
	if unsafe {
		for index := range out.fields {
			out.fields[index].kind = "readonly"
		}
		out.patch = func(changes map[string]string) ([]byte, error) {
			if len(changes) > 0 {
				return nil, bad("CSS includes or executable aliases make effective settings ambiguous; use the native file editor.")
			}
			return append([]byte(nil), data...), nil
		}
	}
	return out, nil
}
