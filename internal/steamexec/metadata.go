package steamexec

import (
	"errors"
	"fmt"
	"strconv"
	"strings"
	"text/scanner"
)

// Valve KeyValues is hierarchical. Searching the first buildid can select a
// depot or a different branch, so parse and select the exact app/branch instead.
type kv map[string]any

func parseKV(raw string) (kv, error) {
	if len(raw) > 4<<20 {
		return nil, errors.New("Steam metadata exceeds limit")
	}
	var s scanner.Scanner
	s.Init(strings.NewReader(raw))
	s.Mode = scanner.ScanStrings | scanner.ScanIdents | scanner.ScanInts | scanner.SkipComments | scanner.ScanComments
	var scanErr bool
	s.Error = func(*scanner.Scanner, string) { scanErr = true }
	nodes := 0
	var object func(int, bool) (kv, error)
	object = func(depth int, nested bool) (kv, error) {
		if depth > 32 {
			return nil, errors.New("Steam metadata nesting exceeds limit")
		}
		out := kv{}
		for {
			t := s.Scan()
			if t == scanner.EOF {
				if nested {
					return nil, errors.New("truncated Steam metadata")
				}
				return out, nil
			}
			if t == '}' {
				if !nested {
					return nil, errors.New("invalid Steam metadata")
				}
				return out, nil
			}
			if t != scanner.String && t != scanner.Ident && t != scanner.Int {
				return nil, errors.New("invalid Steam metadata key")
			}
			key := s.TokenText()
			if t == scanner.String {
				key, _ = strconv.Unquote(key)
			}
			nodes++
			if nodes > 100000 {
				return nil, errors.New("Steam metadata count exceeds limit")
			}
			t = s.Scan()
			if _, duplicate := out[key]; duplicate {
				return nil, errors.New("duplicate Steam metadata key")
			}
			if t == '{' {
				value, err := object(depth+1, true)
				if err != nil {
					return nil, err
				}
				out[key] = value
			} else if t == scanner.String || t == scanner.Ident || t == scanner.Int {
				value := s.TokenText()
				if t == scanner.String {
					value, _ = strconv.Unquote(value)
				}
				out[key] = value
			} else {
				return nil, errors.New("invalid Steam metadata value")
			}
		}
	}
	out, err := object(0, false)
	if scanErr {
		return nil, errors.New("invalid Steam metadata syntax")
	}
	return out, err
}

func child(m kv, key string) kv     { v, _ := m[key].(kv); return v }
func value(m kv, key string) string { v, _ := m[key].(string); return v }
func buildID(v string) bool         { n, err := strconv.ParseUint(v, 10, 64); return err == nil && n > 0 }

func latestBuild(raw string, app int64, branch string) (string, error) {
	// SteamCMD prefixes app_info_print with diagnostic lines. Only the exact
	// quoted app root starts the KeyValues payload; ignore surrounding chatter.
	key := fmt.Sprintf(`"%d"`, app)
	start := strings.Index(raw, key)
	if start < 0 {
		return "", errors.New("Steam app metadata missing; anonymous access may be unavailable")
	}
	part := raw[start:]
	open := strings.Index(part, "{")
	if open < 0 {
		return "", errors.New("Steam app metadata missing")
	}
	// Find its balanced closing brace without counting braces in quoted strings.
	depth, quoted, escaped, end := 0, false, false, -1
	for i := open; i < len(part); i++ {
		c := part[i]
		if escaped {
			escaped = false
			continue
		}
		if quoted && c == '\\' {
			escaped = true
			continue
		}
		if c == '"' {
			quoted = !quoted
			continue
		}
		if quoted {
			continue
		}
		if c == '{' {
			depth++
		}
		if c == '}' {
			depth--
			if depth == 0 {
				end = i + 1
				break
			}
		}
	}
	if end < 0 {
		return "", errors.New("truncated Steam app metadata")
	}
	m, err := parseKV(part[:end])
	if err != nil {
		return "", err
	}
	b := child(child(child(child(m, strconv.FormatInt(app, 10)), "depots"), "branches"), branch)
	if value(b, "pwdrequired") == "1" {
		return "", errors.New("password-protected Steam branches are unsupported")
	}
	id := value(b, "buildid")
	if !buildID(id) {
		return "", errors.New("Steam branch build metadata unavailable")
	}
	return id, nil
}

func installedBuild(raw string, app int64) (string, error) {
	m, err := parseKV(raw)
	if err != nil {
		return "", err
	}
	state := child(m, "AppState")
	if value(state, "appid") != strconv.FormatInt(app, 10) {
		return "", errors.New("installed Steam manifest app ID mismatch")
	}
	id := value(state, "buildid")
	if !buildID(id) {
		return "", errors.New("installed Steam build missing")
	}
	flags, err := strconv.ParseUint(value(state, "StateFlags"), 10, 64)
	if err != nil || flags != 4 {
		return "", errors.New("Steam install is incomplete; run verify while stopped")
	}
	return id, nil
}
