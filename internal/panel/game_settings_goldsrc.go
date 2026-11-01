package panel

import (
	"bytes"
	"math"
	"math/big"
	"strconv"
	"strings"
	"unicode/utf8"
)

const goldSrcCS16SettingsPath = "/cstrike/voltra_gameplay.cfg"

type goldSrcScalarSpec struct {
	kind             string
	minimum, maximum float64
	maximumLimited   bool
	integer          bool
}

// Valve app90 public build15961496: shipped cstrike/settings.scr provides types
// and GUI ranges. Actual map transitions clamp roundtime to 1..9, superseding
// that file's stale 0..15 range. Native cvarlist confirms all fifteen names. GUI
// defaults are not engine defaults (tkpunish/autokick/hostagepenalty differ).
// A maximum of -1 in the publisher script means no upper bound; only the finite
// float32 ABI guard then applies. No CSS enums, bot/plugin cvars or bounds leak.
// Specs and the kind table are fresh per parse and never escape to callers.
func goldSrcCS16ScalarSchema() map[string]goldSrcScalarSpec {
	return map[string]goldSrcScalarSpec{
		"mp_timelimit":      {"number", 0, 0, false, false},
		"mp_winlimit":       {"number", 0, 0, false, false},
		"mp_maxrounds":      {"number", 0, 0, false, false},
		"mp_roundtime":      {"number", 1, 9, true, false},
		"mp_freezetime":     {"number", 0, 60, true, false},
		"mp_buytime":        {"number", 0.25, 0, false, false},
		"mp_startmoney":     {"number", 800, 16000, true, false},
		"mp_footsteps":      {"boolean", 0, 1, true, true},
		"mp_forcecamera":    {"number", 0, 2, true, true},
		"mp_fadetoblack":    {"boolean", 0, 1, true, true},
		"mp_friendlyfire":   {"boolean", 0, 1, true, true},
		"mp_tkpunish":       {"boolean", 0, 1, true, true},
		"mp_autokick":       {"boolean", 0, 1, true, true},
		"mp_hostagepenalty": {"number", 0, 0, false, false},
		"mp_flashlight":     {"boolean", 0, 1, true, true},
	}
}

func goldSrcScalarValue(specs map[string]goldSrcScalarSpec, key, value string) bool {
	spec, known := specs[key]
	if !known || len(value) > 32 || !sourceNumber.MatchString(value) {
		return false
	}
	if spec.kind == "boolean" {
		return value == "0" || value == "1"
	}
	if spec.kind != "number" {
		return false
	}
	// Compare publisher boundaries exactly, matching the runtime's Decimal
	// validator. float64 rounding must not turn 9.00000000000000000001 into 9,
	// or a value just below 800 into an allowed starting-money value.
	exact, ok := new(big.Rat).SetString(value)
	if !ok || exact.Cmp(new(big.Rat).SetFloat64(spec.minimum)) < 0 || spec.maximumLimited && exact.Cmp(new(big.Rat).SetFloat64(spec.maximum)) > 0 || spec.integer && !exact.IsInt() {
		return false
	}
	// Valve's public HLSDK cvar_t stores numeric values in float. This is an
	// engine representation guard, not an invented gameplay minimum/maximum.
	n, err := strconv.ParseFloat(value, 64)
	if err != nil || math.IsNaN(n) || math.IsInf(n, 0) || n > 3.4028234e38 {
		return false
	}
	f := float32(n)
	return !math.IsInf(float64(f), 0) && (n == 0 || f != 0)
}

func parseGoldSrcCS16Settings(data []byte) (gameSettingsParsed, error) {
	if len(data) > 65536 || !utf8.Valid(data) || bytes.HasPrefix(data, []byte{0xef, 0xbb, 0xbf}) {
		return gameSettingsParsed{}, bad("Invalid or oversized GoldSrc settings document.")
	}
	if bytes.Contains(bytes.ReplaceAll(data, []byte("\r\n"), nil), []byte{'\r'}) {
		return gameSettingsParsed{}, bad("Unsupported GoldSrc settings line separator.")
	}
	specs := goldSrcCS16ScalarSchema()
	kinds := make(map[string]string, len(specs))
	for key, spec := range specs {
		kinds[key] = spec.kind
	}
	out, err := parseSourceSettingsWithSchema(data, kinds, func(key, value string) bool {
		return goldSrcScalarValue(specs, key, value)
	})
	if err != nil {
		return out, err
	}
	// The runtime validates this dedicated document with the same closed scalar
	// contract before every boot. Legacy server.cfg and ban includes remain in
	// Files; their execution order cannot prove effective scalar authority here.
	unsafe := false
	seen := make(map[string]bool, len(specs))
	for _, raw := range strings.Split(string(data), "\n") {
		line := strings.TrimRight(raw, "\r")
		if len(line) > 65536 || strings.ContainsAny(line, "\r\u0085\u2028\u2029") {
			return gameSettingsParsed{}, bad("Unsupported GoldSrc settings line.")
		}
		for _, c := range line {
			if c < 32 && c != '\t' || c == 127 {
				return gameSettingsParsed{}, bad("Unsupported GoldSrc settings control character.")
			}
		}
		trim := strings.TrimSpace(line)
		if trim == "" || strings.HasPrefix(trim, "//") {
			continue
		}
		if strings.HasPrefix(trim, "\"") {
			unsafe = true
			continue
		}
		parts := sourceCvarLine.FindStringSubmatch(line)
		if parts == nil {
			unsafe = true
			continue
		}
		key := strings.ToLower(parts[2])
		value := strings.Trim(parts[4], "\"")
		if _, known := specs[key]; !known || seen[key] || !goldSrcScalarValue(specs, key, value) {
			unsafe = true
		}
		seen[key] = true
	}
	if unsafe {
		for index := range out.fields {
			out.fields[index].kind = "readonly"
		}
		out.patch = func(changes map[string]string) ([]byte, error) {
			if len(changes) > 0 {
				return nil, bad("This GoldSrc gameplay document has unknown, repeated or unsupported commands; review it in Files.")
			}
			return bytes.Clone(data), nil
		}
	}
	return out, nil
}
