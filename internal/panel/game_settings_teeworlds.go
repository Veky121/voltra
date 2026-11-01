package panel

import (
	"strconv"
	"strings"
	"unicode/utf8"
)

const teeworldsSettingsPath = "/autoexec.cfg"

func teeworldsSettingKind(key string) string {
	switch key {
	case "sv_name", "sv_motd", "sv_map", "sv_gametype", "password", "sv_rcon_password", "bindaddr":
		return "text"
	case "sv_max_clients", "sv_port":
		return "number"
	case "sv_register":
		return "boolean"
	}
	return ""
}

func teeworldsSettingValue(key, value string) bool {
	if !utf8.ValidString(value) {
		return false
	}
	for _, c := range value {
		if c < 32 || c == 127 || c == '\u0085' || c == '\u2028' || c == '\u2029' || strings.ContainsRune(";\"\\", c) {
			return false
		}
	}
	switch key {
	case "sv_name", "bindaddr":
		return len(value) <= 127
	case "sv_motd":
		return len(value) <= 899
	case "password":
		return len(value) <= 31
	case "sv_rcon_password":
		return len(value) > 0 && len(value) <= 31
	case "sv_map":
		if value == "" || len(value) > 100 {
			return false
		}
		for _, c := range value {
			if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == ' ' || c == '_' || c == '-') {
				return false
			}
		}
		return true
	case "sv_gametype":
		return value == "dm" || value == "tdm" || value == "ctf" || value == "lms" || value == "lts"
	case "sv_max_clients":
		n, err := strconv.Atoi(value)
		return err == nil && n >= 1 && n <= 64
	case "sv_port":
		n, err := strconv.Atoi(value)
		return err == nil && n >= 1 && n <= 65535
	case "sv_register":
		return value == "0" || value == "1"
	}
	return false
}

func parseTeeworldsSettings(data []byte) (gameSettingsParsed, error) {
	parsed, err := parseNativeConsoleSettings(data, nativeConsoleSettingsSchema{kind: teeworldsSettingKind, valid: teeworldsSettingValue, barrier: func(key string) bool { return key == "exec" || key == "exec_if" || key == "exec_if_exists" }})
	if err != nil {
		return parsed, err
	}
	for i := range parsed.fields {
		f := &parsed.fields[i]
		f.secret = gameSettingSecret.MatchString(f.key)
		if f.key == "sv_port" || f.key == "bindaddr" {
			f.kind = "readonly"
		}
	}
	patch := parsed.patch
	parsed.patch = func(changes map[string]string) ([]byte, error) {
		for key := range changes {
			if key == "sv_port" || key == "bindaddr" {
				return nil, bad("Allocated listener settings are managed by Runtime.")
			}
		}
		return patch(changes)
	}
	return parsed, nil
}
