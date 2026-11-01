package panel

import (
	"context"
	"math"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"
)

const openArenaSettingsRecipe = "openarena/egg-open-arena.json"
const openArenaBaseSettingsPath = "/openarena/userdata/baseoa/server.cfg"
const openArenaMissionSettingsPath = "/openarena/userdata/missionpack/server.cfg"

func openArenaSelectedSettingsDocument(egg M) string {
	if !nativeSettingsIsRecipe(egg, openArenaSettingsRecipe) {
		return ""
	}
	if file := str(egg["_openarena_settings_path"]); file == openArenaMissionSettingsPath {
		return file
	}
	return openArenaBaseSettingsPath
}

func openArenaSettingsDocument(egg M, file string) bool {
	return file != "" && file == openArenaSelectedSettingsDocument(egg)
}

func (a *App) prepareOpenArenaSettingsEgg(ctx context.Context, server, egg M) error {
	if !nativeSettingsIsRecipe(egg, openArenaSettingsRecipe) {
		return nil
	}
	rows, err := a.query(ctx, "SELECT COALESCE(sv.variable_value,ev.default_value) AS value FROM egg_variables ev LEFT JOIN server_variables sv ON sv.variable_id=ev.id AND sv.server_id=$1 WHERE ev.egg_id=$2 AND ev.env_variable='GAME_MOD'", server["id"], server["egg_id"])
	if err != nil {
		return err
	}
	if len(rows) > 1 {
		return bad("Ambiguous OpenArena game module; review Runtime before editing settings.")
	}
	module := "baseoa"
	if len(rows) == 1 {
		module = str(rows[0]["value"])
	}
	switch module {
	case "baseoa":
		egg["_openarena_settings_path"] = openArenaBaseSettingsPath
	case "missionpack":
		egg["_openarena_settings_path"] = openArenaMissionSettingsPath
	default:
		return bad("Choose baseoa or missionpack in GAME_MOD before editing OpenArena settings.")
	}
	return nil
}

// Source: OpenArena/gamecode oa-0.8.8 code/game/g_main.c cvarTable.
// Startup's original nine controls remain authoritative and are deliberately
// absent. This document exposes additional gameplay tuning only.
var openArenaSettingKinds = map[string]string{
	"fraglimit": "number", "timelimit": "number", "capturelimit": "number",
	"g_friendlyfire": "boolean", "g_allowvote": "boolean", "g_dowarmup": "boolean",
	"g_warmup": "number", "g_inactivity": "number",
}

var openArenaSetPrefix = regexp.MustCompile(`(?i)^([ \t]*set[asu]?[ \t]+)`)
var openArenaInteger = regexp.MustCompile(`^[0-9]+$`)

func openArenaSettingValue(key, value string) bool {
	kind, exists := openArenaSettingKinds[key]
	if !exists || len(value) > 32 {
		return false
	}
	if kind == "boolean" {
		return value == "0" || value == "1"
	}
	if key != "timelimit" {
		n, err := strconv.ParseUint(value, 10, 31)
		return openArenaInteger.MatchString(value) && err == nil && n <= math.MaxInt32
	}
	n, err := strconv.ParseFloat(value, 64)
	return sourceNumber.MatchString(value) && err == nil && !math.IsInf(n, 0) && !math.IsNaN(n) && n >= 0
}

// Retain exact set/seta prefixes by padding with equal byte-width whitespace
// only during the shared scalar parser's analysis. Restore every original
// prefix after its value-span patch, including unknown commands/settings.
func parseOpenArenaSettings(data []byte) (gameSettingsParsed, error) {
	if len(data) > 8*1024*1024 || !utf8.Valid(data) || strings.HasPrefix(string(data), "\ufeff") {
		return gameSettingsParsed{}, bad("Invalid OpenArena settings document.")
	}
	lines := strings.SplitAfter(string(data), "\n")
	if len(lines) > 100000 {
		return gameSettingsParsed{}, bad("Oversized OpenArena settings document.")
	}
	prefixes := make(map[int]string)
	unsafeControl := false
	for i, line := range lines {
		if len(line) > 65536 || strings.ContainsAny(strings.TrimSuffix(strings.TrimSuffix(line, "\n"), "\r"), "\r\u0085\u2028\u2029") {
			return gameSettingsParsed{}, bad("Unsupported OpenArena settings line.")
		}
		words := strings.Fields(strings.TrimSpace(line))
		if len(words) > 0 {
			head := words[0]
			if end := strings.IndexAny(head, ";=\""); end >= 0 {
				head = head[:end]
			}
			switch strings.ToLower(head) {
			case "exec", "vstr", "toggle", "reset", "unset", "cvar_restart", "map", "devmap", "map_restart", "wait":
				unsafeControl = true
			}
		}
		prefix := openArenaSetPrefix.FindString(line)
		if len(words) > 0 && prefix == "" {
			head := strings.ToLower(words[0])
			if end := strings.IndexAny(head, ";=\""); end >= 0 {
				head = head[:end]
			}
			if head == "set" || head == "seta" || head == "sets" || head == "setu" {
				unsafeControl = true
			}
		}
		if prefix != "" {
			prefixes[i] = prefix
			lines[i] = strings.Repeat(" ", len(prefix)) + line[len(prefix):]
		}
		if strings.HasPrefix(strings.TrimSpace(lines[i]), "\"") {
			unsafeControl = true
		}
	}
	parsed, err := parseSourceSettingsWithSchema([]byte(strings.Join(lines, "")), openArenaSettingKinds, openArenaSettingValue)
	if err != nil {
		return parsed, err
	}
	if unsafeControl {
		for i := range parsed.fields {
			parsed.fields[i].kind = "readonly"
		}
		parsed.patch = func(changes map[string]string) ([]byte, error) {
			if len(changes) > 0 {
				return nil, bad("OpenArena script control requires the native file editor.")
			}
			return append([]byte(nil), data...), nil
		}
		return parsed, nil
	}
	patch := parsed.patch
	parsed.patch = func(changes map[string]string) ([]byte, error) {
		updated, err := patch(changes)
		if err != nil {
			return nil, err
		}
		rows := strings.SplitAfter(string(updated), "\n")
		if len(rows) != len(lines) {
			return nil, bad("Invalid OpenArena patch layout.")
		}
		for i, prefix := range prefixes {
			if len(rows[i]) < len(prefix) {
				return nil, bad("Invalid OpenArena patch prefix.")
			}
			rows[i] = prefix + rows[i][len(prefix):]
		}
		return []byte(strings.Join(rows, "")), nil
	}
	return parsed, nil
}
