package panel

import (
	"bytes"
	"fmt"
	"regexp"
	"strings"
	"unicode/utf8"
)

const wurmSettingsRecipe = "wurm_unlimited/egg-wurm-unlimited.json"
const wurmSettingsPath = "/LaunchConfig.ini"
const wurmOwnerStartup = "exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/wurm_owner.py"

// Launcher configuration only. Gameplay settings live in the world databases
// and remain CLI-owned; this parser never opens or edits those databases.
// Root must dispatch only after exact startup/helper authority, stopped state,
// file RBAC and revision checks. No arbitrary plugin effectiveness guarantee.
func parseWurmSettings(data []byte) (gameSettingsParsed, error) {
	out := gameSettingsParsed{}
	if len(data) > 1024*1024 || !utf8.Valid(data) || bytes.IndexByte(data, 0) >= 0 {
		return out, fmt.Errorf("Invalid Wurm launcher configuration")
	}
	re := regexp.MustCompile(`(?m)^([^\r\n]*)`)
	start, end := -1, -1
	for _, loc := range re.FindAllSubmatchIndex(data, -1) {
		line := string(data[loc[2]:loc[3]])
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "#") || strings.HasPrefix(trimmed, ";") || !strings.Contains(line, "=") {
			continue
		}
		eq := strings.IndexByte(line, '=')
		key := strings.TrimSpace(line[:eq])
		if !strings.EqualFold(key, "CleanLogsOnStart") {
			continue
		}
		value := strings.TrimSpace(line[eq+1:])
		if start >= 0 || key != "CleanLogsOnStart" || value != "true" && value != "false" {
			return out, fmt.Errorf("Ambiguous Wurm CleanLogsOnStart")
		}
		offset := eq + 1 + len(line[eq+1:]) - len(strings.TrimLeft(line[eq+1:], " \t"))
		start = loc[2] + offset
		end = start + len(value)
		out.fields = append(out.fields, gameSetting{key: "CleanLogsOnStart", value: value, kind: "boolean", on: "true", off: "false"})
	}
	if start < 0 {
		return out, fmt.Errorf("Missing Wurm CleanLogsOnStart; launch once with reviewed helper")
	}
	original := bytes.Clone(data)
	out.patch = func(changes map[string]string) ([]byte, error) {
		result := bytes.Clone(original)
		for key, value := range changes {
			if key != "CleanLogsOnStart" || value != "true" && value != "false" {
				return nil, fmt.Errorf("Unsupported Wurm launcher setting")
			}
			result = append(append(append([]byte{}, original[:start]...), []byte(value)...), original[end:]...)
		}
		return result, nil
	}
	return out, nil
}
