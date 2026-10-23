package panel

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// Imported controls are translated into the existing managed Steam lifecycle.
// Secret values deliberately never enter the ordinary server-variable map.
type steamCatalogConfiguration struct {
	Values              M
	Secrets             map[string]string `json:"-"`
	Branch              string
	Validate, Automatic bool
	Players             int64
}

type steamCatalogField struct {
	Key, Label, Type, Default string
	Min, Max                  float64
	Secret                    bool
}

func steamCatalogBridgeID(recipe string) string {
	switch recipe {
	case "7_days_to_die/egg-7-days-to-die.json":
		return "7days"
	case "satisfactory/egg-satisfactory.json":
		return "satisfactory"
	}
	return ""
}

func steamCatalogFields(game string) []steamCatalogField {
	common := []steamCatalogField{{Key: "AUTO_UPDATE", Label: "Automatic updates", Type: "boolean", Default: "1"}, {Key: "SRCDS_BETAID", Label: "Steam branch", Type: "text"}}
	switch game {
	case "7days":
		return append(common, []steamCatalogField{
			{Key: "MAX_PLAYERS", Label: "Maximum players", Type: "integer", Default: "8", Min: 1, Max: 2147483647},
			{Key: "GAME_DIFFICULTY", Label: "Difficulty", Type: "integer", Default: "2", Min: 0, Max: 5},
			{Key: "SRCDS_APPID", Label: "Steam app ID", Type: "fixed", Default: "294420"},
			{Key: "LD_LIBRARY_PATH", Label: "Library search path", Type: "text", Default: "."},
			{Key: "PASSWORD", Label: "Private console password", Type: "text", Secret: true},
			{Key: "TELNET_PORT", Label: "Private console port", Type: "integer", Default: "8081", Min: 1024, Max: 65535},
			{Key: "SERVER_DISABLED_NETWORK_PROTOCOLS", Label: "Disabled network protocols", Type: "text"},
		}...)
	case "satisfactory":
		return append(common, []steamCatalogField{
			{Key: "VALIDATE", Label: "Validate files on automatic startup", Type: "boolean", Default: "0"},
			{Key: "MAX_PLAYERS", Label: "Maximum players", Type: "integer", Default: "4", Min: 1, Max: 2147483647},
			{Key: "NUM_AUTOSAVES", Label: "Rotating autosaves", Type: "integer", Default: "3", Min: 1, Max: 2147483647},
			{Key: "INIT_CONNECT_TIMEOUT", Label: "Initial connection timeout (seconds)", Type: "number", Default: "30", Min: 1, Max: math.MaxFloat32},
			{Key: "CONNECT_TIMEOUT", Label: "Connection timeout (seconds)", Type: "number", Default: "20", Min: 1, Max: math.MaxFloat32},
			{Key: "SRCDS_BETAPASS", Label: "Private branch password", Type: "text", Secret: true},
			{Key: "SRCDS_APPID", Label: "Steam app ID", Type: "fixed", Default: "1690800"},
			{Key: "RELIABLE_PORT", Label: "Reliable port", Type: "integer", Default: "0", Min: 0, Max: 65535},
		}...)
	}
	return nil
}

var steamCatalogBranch = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$`)
var steamCatalogProtocols = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9_]*(,[A-Za-z][A-Za-z0-9_]*)*$`)

func steamCatalogParse(game string, input M, players int64) (steamCatalogConfiguration, error) {
	out := steamCatalogConfiguration{Values: M{}, Secrets: map[string]string{}, Branch: "public", Automatic: true, Players: players}
	fields := steamCatalogFields(game)
	if len(fields) == 0 {
		return out, bad("This game has no imported Steam controls.")
	}
	known := map[string]bool{}
	for _, field := range fields {
		known[field.Key] = true
		raw := field.Default
		if field.Key == "MAX_PLAYERS" && players > 0 {
			raw = strconv.FormatInt(players, 10)
		}
		if value, ok := input[field.Key]; ok {
			switch value := value.(type) {
			case nil:
				// The common request normalizer converts optional empty text to
				// null. Public branch and empty protocol/credential controls remain
				// valid when the shared form explicitly submits their defaults.
				if field.Type != "text" {
					return out, bad("Invalid " + field.Label + " value.")
				}
				raw = ""
			case string:
				raw = value
			case bool:
				if value {
					raw = "1"
				} else {
					raw = "0"
				}
			default:
				if field.Type == "integer" || field.Type == "number" || field.Type == "boolean" || field.Type == "fixed" {
					raw = fmt.Sprint(value)
				} else {
					return out, bad("Invalid " + field.Label + " value.")
				}
			}
		}
		if !quickSingleLine(raw) || len(raw) > 4096 {
			return out, bad(field.Label + " must be a single bounded value.")
		}
		if field.Secret && len([]byte(raw)) > 1024 {
			return out, bad(field.Label + " must be at most 1024 UTF-8 bytes.")
		}
		if field.Key == "PASSWORD" {
			if err := steamCatalogConsolePassword(raw); err != nil {
				return out, err
			}
		}
		switch field.Type {
		case "boolean":
			if raw != "0" && raw != "1" {
				return out, bad(field.Label + " must be enabled or disabled.")
			}
		case "integer":
			n, err := strconv.ParseInt(raw, 10, 64)
			if err != nil || float64(n) < field.Min || float64(n) > field.Max {
				return out, bad("Invalid " + field.Label + ".")
			}
			raw = strconv.FormatInt(n, 10)
		case "number":
			n, err := strconv.ParseFloat(raw, 64)
			if err != nil || math.IsNaN(n) || math.IsInf(n, 0) || n < field.Min || n > field.Max {
				return out, bad("Invalid " + field.Label + ".")
			}
			raw = strconv.FormatFloat(n, 'f', -1, 64)
		case "fixed":
			if raw != field.Default {
				return out, bad("The managed Steam app ID cannot be changed.")
			}
		}
		if field.Key == "SRCDS_BETAID" && raw != "" && !steamCatalogBranch.MatchString(raw) {
			return out, bad("Invalid Steam branch name.")
		}
		if field.Key == "SERVER_DISABLED_NETWORK_PROTOCOLS" && raw != "" && !steamCatalogProtocols.MatchString(raw) {
			return out, bad("Use comma separated protocol names.")
		}
		if field.Key == "RELIABLE_PORT" && raw != "0" && num(raw) < 1024 {
			return out, bad("Choose an allocated reliable port from 1024 through 65535.")
		}
		if field.Secret {
			out.Secrets[field.Key] = raw
			out.Values[field.Key] = ""
		} else {
			out.Values[field.Key] = raw
		}
	}
	for key := range input {
		if !known[key] {
			return out, bad("Unsupported Steam control: " + key)
		}
	}
	if branch := str(out.Values["SRCDS_BETAID"]); branch != "" {
		out.Branch = branch
	}
	if out.Secrets["SRCDS_BETAPASS"] != "" && out.Branch == "public" {
		return out, bad("Select a private branch before setting its password.")
	}
	out.Validate = str(out.Values["VALIDATE"]) == "1"
	out.Automatic = str(out.Values["AUTO_UPDATE"]) == "1"
	out.Players = num(out.Values["MAX_PLAYERS"])
	return out, nil
}

// Patch only named scalar INI keys, retaining comments and unrelated sections.
func steamCatalogPatchINI(content []byte, changes map[string]map[string]string) ([]byte, error) {
	if len(content) > quickFileLimit || bytes.IndexByte(content, 0) >= 0 {
		return nil, bad("Configuration exceeds its size limit or contains invalid bytes.")
	}
	text := strings.ReplaceAll(string(content), "\r\n", "\n")
	lines := strings.Split(text, "\n")
	remaining := map[string]map[string]string{}
	for section, values := range changes {
		remaining[section] = map[string]string{}
		for key, value := range values {
			if !quickSingleLine(section+key+value) || strings.ContainsAny(key, "=[]") {
				return nil, bad("Invalid INI setting.")
			}
			remaining[section][key] = value
		}
	}
	section := ""
	seenSections := map[string]bool{}
	seenKeys := map[string]bool{}
	for i, line := range lines {
		trim := strings.TrimSpace(line)
		if strings.HasPrefix(trim, "[") && strings.HasSuffix(trim, "]") {
			section = trim[1 : len(trim)-1]
			if _, managed := changes[section]; managed {
				if seenSections[section] {
					return nil, bad("Duplicate managed INI section.")
				}
				seenSections[section] = true
			}
			continue
		}
		if strings.HasPrefix(trim, ";") || strings.HasPrefix(trim, "#") {
			continue
		}
		key, _, ok := strings.Cut(line, "=")
		key = strings.TrimSpace(key)
		if value, managed := changes[section][key]; ok && managed {
			identity := section + "\x00" + key
			if seenKeys[identity] {
				return nil, bad("Duplicate managed INI key.")
			}
			seenKeys[identity] = true
			lines[i] = key + "=" + value
			delete(remaining[section], key)
		}
	}
	// Append another section only when none exists; insert missing keys into an
	// existing section before its next header, without rewriting other settings.
	sections := []string{}
	for section := range remaining {
		sections = append(sections, section)
	}
	sort.Strings(sections)
	for _, section := range sections {
		keys := []string{}
		for key := range remaining[section] {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		if len(keys) == 0 {
			continue
		}
		added := []string{}
		for _, key := range keys {
			added = append(added, key+"="+remaining[section][key])
		}
		at := -1
		for i, line := range lines {
			if strings.TrimSpace(line) == "["+section+"]" {
				at = i + 1
				for at < len(lines) && !strings.HasPrefix(strings.TrimSpace(lines[at]), "[") {
					at++
				}
				break
			}
		}
		if at < 0 {
			lines = append(lines, "["+section+"]")
			lines = append(lines, added...)
		} else {
			tail := append([]string{}, lines[at:]...)
			lines = append(lines[:at], added...)
			lines = append(lines, tail...)
		}
	}
	return []byte(strings.Join(lines, "\n")), nil
}

func steamCatalogSatisfactoryINI(configuration steamCatalogConfiguration) (map[string]map[string]string, map[string]map[string]string) {
	return map[string]map[string]string{"/Script/Engine.GameSession": {"MaxPlayers": str(configuration.Values["MAX_PLAYERS"])}}, map[string]map[string]string{
		"/Script/FactoryGame.FGSaveSession":        {"mNumRotatingAutosaves": str(configuration.Values["NUM_AUTOSAVES"])},
		"/Script/OnlineSubsystemUtils.IpNetDriver": {"InitialConnectTimeout": str(configuration.Values["INIT_CONNECT_TIMEOUT"]), "ConnectionTimeout": str(configuration.Values["CONNECT_TIMEOUT"])},
	}
}

func steamCatalogConsolePassword(password string) error {
	// Native telnet trims the submitted line before comparing the password.
	// Preserve operator input and reject the demonstrated unusable boundary.
	if strings.HasPrefix(password, " ") || strings.HasSuffix(password, " ") {
		return bad("Private console password cannot begin or end with an ASCII space.")
	}
	return nil
}

func steamCatalogSevenDaysConsole(port int64, password string, artifacts ...steamCatalogConsolePackage) ([]byte, []byte, error) {
	if err := steamCatalogConsolePassword(password); err != nil {
		return nil, nil, err
	}
	if port < 1024 || port > 65535 || !quickSingleLine(password) || len(password) > 1024 {
		return nil, nil, bad("Invalid private console configuration.")
	}
	launcher := strings.ReplaceAll(sevenDaysLauncher, "8081", strconv.FormatInt(port, 10))
	address := fmt.Sprintf("0100007F:%04X", port)
	launcher = strings.ReplaceAll(launcher, "0100007F:1F91", address)
	if password == "" {
		return []byte(launcher), nil, nil
	}
	var artifact steamCatalogConsolePackage
	var artifactErr error
	if len(artifacts) == 0 {
		artifact, artifactErr = steamCatalogConsoleArtifact("amd64")
	} else if len(artifacts) == 1 {
		artifact = artifacts[0]
	} else {
		return nil, nil, bad("Invalid managed console package.")
	}
	if artifactErr != nil {
		return nil, nil, artifactErr
	}
	if len(artifact.SHA256) != 64 || len(artifact.Binary) == 0 {
		return nil, nil, bad("Managed console package is unavailable.")
	}
	// Verify the transferred public bytes before making the private copy
	// executable. Credentials remain in native files owned by the game user.
	preflight := fmt.Sprintf("printf '%%s  %%s\\n' '%s' '/home/container%s' | sha256sum -c - >/dev/null\nchmod 700 /home/container/.voltra /home/container%s\nchmod 600 /home/container/serverconfig.xml /home/container/.voltra/sevendays-console.yaml /home/container%s.manifest.json /home/container%s.LICENSE\n", artifact.SHA256, steamCatalogConsolePath, steamCatalogConsolePath, steamCatalogConsolePath, steamCatalogConsolePath)
	launcher = strings.Replace(launcher, "mkdir -p logs saves\n", "mkdir -p logs saves\n"+preflight, 1)
	// JSON is a YAML subset. The existing rcon client reads credentials from
	// this native configuration; neither argv nor the launch script contains it.
	configuration, err := json.Marshal(M{"default": M{"address": fmt.Sprintf("127.0.0.1:%d", port), "password": password, "type": "telnet", "log": ""}})
	if err != nil {
		return nil, nil, err
	}
	launcher = strings.Replace(launcher, fmt.Sprintf("printf 'shutdown\\r\\n' | timeout 10 nc 127.0.0.1 %d", port), "timeout 10 /home/container/.voltra/console-client -t telnet -c /home/container/.voltra/sevendays-console.yaml shutdown", 1)
	launcher = strings.Replace(launcher, fmt.Sprintf("telnet -E 127.0.0.1 %d <&0 &", port), "/home/container/.voltra/console-client -t telnet -c /home/container/.voltra/sevendays-console.yaml <&0 &", 1)
	// The interactive client can keep reading stdin after the server closes its
	// socket. Reap it after the native game exits so normal shutdown finishes.
	launcher = strings.Replace(launcher, "wait \"$console_pid\" || true\nwait \"$game_pid\"", "game_status=0\nwait \"$game_pid\" || game_status=$?\nkill \"$console_pid\" 2>/dev/null || true\nwait \"$console_pid\" || true\nexit \"$game_status\"", 1)
	// A password makes the publisher listen on the container wildcard socket.
	// No Telnet allocation is published by the managed setup.
	launcher = strings.Replace(launcher, "$2 == \""+address+"\"", fmt.Sprintf("($2 == %q || $2 == %q)", address, fmt.Sprintf("00000000:%04X", port)), 1)
	return []byte(launcher), configuration, nil
}
