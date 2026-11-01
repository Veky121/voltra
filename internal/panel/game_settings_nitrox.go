package panel

import (
	"strconv"
	"strings"
	"unicode/utf8"
)

// Nitrox 1.8.1.0, aec1f6e4e1a322b045c701bdb2394bc0dd2afc88:
// Nitrox.Model/Serialization/{SubnauticaServerConfig,NitroxConfig}.cs.
// Values are literal after the first equals; only column-zero # is a comment.
// This adapter never seeds keys, exposes credentials, or edits the managed port.
func parseNitroxSettings(data []byte) (gameSettingsParsed, error) {
	out := gameSettingsParsed{fields: []gameSetting{}}
	if len(data) > 8*1024*1024 || !utf8.Valid(data) || strings.ContainsRune(string(data), 0) {
		return out, bad("Invalid Nitrox configuration.")
	}
	lines := strings.SplitAfter(string(data), "\n")
	type span struct{ line, start, end int }
	spans := map[string]span{}
	seen := map[string]bool{}
	for i, line := range lines {
		prefix := 0
		if i == 0 && strings.HasPrefix(line, "\ufeff") {
			prefix = 3
		}
		text := strings.TrimSuffix(strings.TrimSuffix(line[prefix:], "\n"), "\r")
		if text == "" || strings.HasPrefix(text, "#") {
			continue
		}
		name, value, ok := strings.Cut(text, "=")
		if !ok {
			continue
		}
		key := strings.ToLower(name)
		if seen[key] {
			return out, bad("Repeated Nitrox configuration key.")
		}
		seen[key] = true
		kind := nitroxSettingKind(key)
		if kind == "" {
			continue
		}
		if !nitroxSettingValue(key, value) {
			return out, bad("Invalid Nitrox scalar value.")
		}
		f := gameSetting{key: name, value: value, kind: kind}
		if kind == "boolean" {
			f.on, f.off = "True", "False"
		}
		out.fields = append(out.fields, f)
		spans[name] = span{i, prefix + len(name) + 1, prefix + len(text)}
	}
	out.patch = func(changes map[string]string) ([]byte, error) {
		updated := append([]string(nil), lines...)
		for key, value := range changes {
			s, ok := spans[key]
			if !ok || !nitroxSettingValue(strings.ToLower(key), value) {
				return nil, bad("Invalid or unmanaged Nitrox setting change.")
			}
			updated[s.line] = lines[s.line][:s.start] + value + lines[s.line][s.end:]
		}
		return []byte(strings.Join(updated, "")), nil
	}
	return out, nil
}

func nitroxSettingKind(key string) string {
	switch key {
	case "createfullentitycache", "keepinventoryondeath", "disableconsole", "disableautosave", "disableautobackup", "localhostisadmin", "autoportforward", "landiscoveryenabled", "safebuilding", "isembedded", "pvpenabled":
		return "boolean"
	case "saveinterval", "maxbackups", "maxconnections", "initialsynctimeout":
		return "number"
	case "gamemode", "serializermode", "defaultplayerperm":
		return "text"
	}
	return ""
}

func nitroxSettingValue(key, value string) bool {
	switch nitroxSettingKind(key) {
	case "boolean":
		return value == "True" || value == "False"
	case "number":
		n, err := strconv.ParseInt(value, 10, 32)
		if err != nil {
			return false
		}
		switch key {
		case "saveinterval":
			return n >= 1000
		case "maxbackups":
			return n >= 0
		case "maxconnections":
			return n > 0
		default:
			return true
		}
	case "text":
		switch key {
		case "gamemode":
			return value == "SURVIVAL" || value == "FREEDOM" || value == "HARDCORE" || value == "CREATIVE"
		case "serializermode":
			return value == "PROTOBUF" || value == "JSON"
		case "defaultplayerperm":
			return value == "NONE" || value == "PLAYER" || value == "MODERATOR" || value == "ADMIN" || value == "CONSOLE"
		}
	}
	return false
}
