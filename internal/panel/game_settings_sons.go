package panel

import (
	"bytes"
	"encoding/json"
	"math"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"
)

const sonsSettingsRecipe = "sonsoftheforest/egg-sons-of-the-forest.json"
const sonsSettingsPath = "/serverconfig/dedicatedserver.cfg"
const sonsSettingsStartup = "exec python3 .voltra/sons-of-forest.py run"

type sonsSettingSpec struct {
	key, kind, label, group, fallback string
	minimum, maximum                  float64
}

// Documented top-level JSON only. Listener/bind values are allocation-owned;
// arbitrary gameplay objects stay in Files and are never flattened into controls.
var sonsSettingSpecs = []sonsSettingSpec{
	{"ServerName", "text", "Server name", "General", "Sons Of The Forest Server (dedicated)", 0, 256},
	{"MaxPlayers", "number", "Maximum players", "General", "8", 1, 8},
	{"Password", "text", "Server password", "General", "", 0, 40},
	{"LanOnly", "boolean", "LAN only", "General", "false", 0, 0},
	{"SaveSlot", "number", "Save slot", "World and saves", "1", 1, 2147483647},
	{"SaveMode", "select", "Save mode", "World and saves", "Continue", 0, 0},
	{"GameMode", "select", "New-game difficulty", "World and saves", "Normal", 0, 0},
	{"SaveInterval", "number", "Autosave interval (seconds)", "World and saves", "600", -2147483648, 2147483647},
	{"IdleDayCycleSpeed", "decimal", "Idle day-cycle speed", "Performance", "0.0", 0, 1},
	{"IdleTargetFramerate", "number", "Idle frame rate", "Performance", "5", 1, 2147483647},
	{"ActiveTargetFramerate", "number", "Active frame rate", "Performance", "60", 10, 2147483647},
	{"LogFilesEnabled", "boolean", "Write log files", "Logs", "false", 0, 0},
	{"TimestampLogFilenames", "boolean", "Timestamp log filenames", "Logs", "true", 0, 0},
	{"TimestampLogEntries", "boolean", "Timestamp log entries", "Logs", "true", 0, 0},
	{"SkipNetworkAccessibilityTest", "boolean", "Skip network accessibility test", "Network", "false", 0, 0},
}

func sonsSettingChoices(key string) []string {
	if key == "SaveMode" {
		return []string{"Continue", "New"}
	}
	return []string{"Normal", "Hard", "HardSurvival", "Peaceful", "Creative", "Custom"}
}

func sonsSettingValid(spec sonsSettingSpec, value string) bool {
	switch spec.kind {
	case "text":
		return utf8.ValidString(value) && utf8.RuneCountInString(value) <= int(spec.maximum) && !strings.ContainsFunc(value, func(r rune) bool { return r < 32 || r == 127 })
	case "boolean":
		return value == "true" || value == "false"
	case "select":
		for _, choice := range sonsSettingChoices(spec.key) {
			if strings.EqualFold(value, choice) {
				return true
			}
		}
	case "number":
		if !json.Valid([]byte(value)) {
			return false
		}
		n, err := strconv.ParseInt(value, 10, 32)
		return err == nil && float64(n) >= spec.minimum && float64(n) <= spec.maximum
	case "decimal":
		if !json.Valid([]byte(value)) {
			return false
		}
		n, err := strconv.ParseFloat(value, 64)
		return err == nil && !math.IsNaN(n) && !math.IsInf(n, 0) && n >= spec.minimum && n <= spec.maximum
	}
	return false
}

func parseSonsSettings(data []byte) (gameSettingsParsed, error) {
	invalid := func() (gameSettingsParsed, error) {
		return gameSettingsParsed{}, bad("Invalid or ambiguous Sons of the Forest configuration. Review it in Files.")
	}
	if len(data) > 4*1024*1024 || !utf8.Valid(data) {
		return invalid()
	}
	prefix := 0
	if bytes.HasPrefix(data, []byte{0xef, 0xbb, 0xbf}) {
		prefix = 3
	}
	body := data[prefix:]
	if !json.Valid(body) {
		return invalid()
	}
	spans, err := bananaJSONSpans(body)
	if err != nil || !spans[""].object {
		return invalid()
	}
	parsed := gameSettingsParsed{}
	allowed := map[string]sonsSettingSpec{}
	for _, spec := range sonsSettingSpecs {
		key := "/" + spec.key
		for existing := range spans {
			if existing != key && strings.EqualFold(existing, key) {
				return invalid()
			}
		}
		value := spec.fallback
		if span, ok := spans[key]; ok {
			raw := body[span.start:span.end]
			if string(raw) == "null" {
				// An explicit null is retained; do not guess its native semantics.
				continue
			}
			value = string(raw)
			if spec.kind == "text" || spec.kind == "select" {
				if json.Unmarshal(raw, &value) != nil {
					return invalid()
				}
			}
		}
		if !sonsSettingValid(spec, value) {
			return invalid()
		}
		kind := spec.kind
		if kind == "select" {
			kind = "text"
		} else if kind == "decimal" {
			kind = "number"
		}
		parsed.fields = append(parsed.fields, gameSetting{key: key, value: value, kind: kind, on: "true", off: "false", secret: spec.key == "Password"})
		allowed[key] = spec
	}
	original := append([]byte(nil), data...)
	parsed.patch = func(changes map[string]string) ([]byte, error) {
		type edit struct {
			start, end int
			value      []byte
		}
		edits := []edit{}
		missing := []string{}
		for key, value := range changes {
			spec, ok := allowed[key]
			if !ok || !sonsSettingValid(spec, value) {
				return nil, bad("Unsupported Sons of the Forest setting or value.")
			}
			if _, exists := spans[key]; !exists {
				missing = append(missing, key)
			}
		}
		encode := func(key, value string) []byte {
			if allowed[key].kind == "text" || allowed[key].kind == "select" {
				encoded, _ := json.Marshal(value)
				return encoded
			}
			return []byte(value)
		}
		for key, value := range changes {
			if span, exists := spans[key]; exists {
				edits = append(edits, edit{span.start + prefix, span.end + prefix, encode(key, value)})
			}
		}
		if len(missing) > 0 {
			sort.Strings(missing)
			newline := "\n"
			if bytes.Contains(body, []byte("\r\n")) {
				newline = "\r\n"
			}
			var addition bytes.Buffer
			for i, key := range missing {
				if len(spans) > 1 || i > 0 {
					addition.WriteByte(',')
				}
				addition.WriteString(newline + "  ")
				name, _ := json.Marshal(strings.TrimPrefix(key, "/"))
				addition.Write(name)
				addition.WriteString(": ")
				addition.Write(encode(key, changes[key]))
			}
			addition.WriteString(newline)
			at := spans[""].end - 1 + prefix
			edits = append(edits, edit{at, at, addition.Bytes()})
		}
		sort.Slice(edits, func(i, j int) bool { return edits[i].start > edits[j].start })
		out := append([]byte(nil), original...)
		for _, edit := range edits {
			next := append([]byte(nil), out[:edit.start]...)
			next = append(next, edit.value...)
			out = append(next, out[edit.end:]...)
		}
		return out, nil
	}
	return parsed, nil
}

func sonsSettingPresentation(egg M, file string, field M) {
	if !nativeSettingsIsRecipe(egg, sonsSettingsRecipe) || !reviewedNewDocument(egg, file) {
		return
	}
	for _, spec := range sonsSettingSpecs {
		if str(field["key"]) != "/"+spec.key {
			continue
		}
		field["label"], field["group"] = spec.label, spec.group
		if spec.kind == "number" || spec.kind == "decimal" {
			field["min"], field["max"] = spec.minimum, spec.maximum
		}
		if spec.kind == "select" {
			field["type"] = "select"
			options := []M{}
			for _, choice := range sonsSettingChoices(spec.key) {
				value, label := choice, choice
				if strings.EqualFold(str(field["value"]), choice) {
					value = str(field["value"])
				}
				if spec.key == "SaveMode" && choice == "New" {
					label = "New on every start (overwrites selected save)"
				}
				options = append(options, M{"value": value, "label": label})
			}
			field["options"] = options
		}
		return
	}
}
