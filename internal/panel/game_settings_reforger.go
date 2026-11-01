package panel

import (
	"bytes"
	"encoding/json"
	"net/netip"
	"regexp"
	"strings"
	"unicode/utf8"
)

const reforgerSettingsRecipe = "arma/arma_reforger/egg-arma-reforger.json"

// Allocation context must come from the locked server and same-IP allocations,
// never from native JSON. Callers must refresh it before publication.
func parseReforgerSettings(data []byte, primary int, allocated []int) (gameSettingsParsed, error) {
	out, err := parseGameSettings("/config.json", data)
	if err != nil {
		return out, err
	}
	for i := range out.fields {
		switch out.fields[i].key {
		case "/bindPort", "/publicPort", "/bindAddress", "/a2s/address", "/rcon/address":
			out.fields[i].kind = "readonly"
		}
	}
	patch := out.patch
	out.patch = func(changes map[string]string) ([]byte, error) {
		for k := range changes {
			switch k {
			case "/bindPort", "/publicPort", "/bindAddress", "/a2s/address", "/rcon/address":
				return nil, bad("Reforger listener binding is allocation-managed.")
			}
		}
		candidate, e := patch(changes)
		if e != nil {
			return nil, e
		}
		if e = validateReforgerSettings(candidate, primary, allocated); e != nil {
			return nil, e
		}
		return candidate, nil
	}
	return out, nil
}

var reforgerInteger = regexp.MustCompile(`^[0-9]+$`)

func validateReforgerSettings(data []byte, primary int, allocated []int) error {
	var root map[string]any
	d := json.NewDecoder(bytes.NewReader(data))
	d.UseNumber()
	if d.Decode(&root) != nil || root == nil {
		return bad("Reforger config must be an object.")
	}
	invalid := func() error { return bad("Reforger setting violates the reviewed launcher constraints.") }
	object := func(parent map[string]any, key string) (map[string]any, bool) {
		v, ok := parent[key]
		if !ok {
			return map[string]any{}, true
		}
		m, ok := v.(map[string]any)
		return m, ok
	}
	text := func(parent map[string]any, key string, limit int, noSpace bool) bool {
		v, exists := parent[key]
		if !exists {
			return true
		}
		s, ok := v.(string)
		if !ok || utf8.RuneCountInString(s) > limit || (noSpace && strings.Contains(s, " ")) {
			return false
		}
		for _, r := range s {
			if r < 32 || r == 127 {
				return false
			}
		}
		return true
	}
	integer := func(v any, low, high int) (int, bool) {
		n, ok := v.(json.Number)
		if !ok || !reforgerInteger.MatchString(string(n)) {
			return 0, false
		}
		x, e := n.Int64()
		return int(x), e == nil && x >= int64(low) && x <= int64(high)
	}
	game, ok := object(root, "game")
	if !ok {
		return invalid()
	}
	props, ok := object(game, "gameProperties")
	if !ok {
		return invalid()
	}
	for k, limit := range map[string]int{"name": 255, "password": 32, "passwordAdmin": 32, "scenarioId": 4096} {
		if !text(game, k, limit, k == "passwordAdmin") {
			return invalid()
		}
	}
	if v, exists := game["maxPlayers"]; exists {
		if _, ok := integer(v, 1, 256); !ok {
			return invalid()
		}
	}
	for _, entry := range []struct {
		m map[string]any
		k string
	}{{game, "visible"}, {props, "battlEye"}, {props, "disableThirdPerson"}} {
		if v, exists := entry.m[entry.k]; exists {
			if _, ok := v.(bool); !ok {
				return invalid()
			}
		}
	}
	if !text(root, "publicAddress", 64, false) {
		return invalid()
	}
	if address, ok := root["publicAddress"].(string); ok && address != "" && address != "local" {
		ip, e := netip.ParseAddr(address)
		if e != nil || !ip.Is4() {
			return invalid()
		}
	}
	used := map[int]bool{primary: true}
	allowed := map[int]bool{}
	for _, port := range allocated {
		if port < 1 || port > 65535 {
			return invalid()
		}
		allowed[port] = true
	}
	for _, key := range []string{"a2s", "rcon"} {
		listener, ok := object(root, key)
		if !ok {
			return invalid()
		}
		port := 0
		if v, exists := listener["port"]; exists {
			var valid bool
			port, valid = integer(v, 0, 65535)
			if !valid {
				return invalid()
			}
		}
		if port == 0 {
			continue
		}
		if primary < 1 || primary > 65535 || !allowed[primary] || !allowed[port] || used[port] {
			return invalid()
		}
		used[port] = true
		if key == "rcon" {
			if !text(listener, "password", 128, true) {
				return invalid()
			}
			password, ok := listener["password"].(string)
			if !ok || utf8.RuneCountInString(password) < 8 {
				return invalid()
			}
		}
	}
	return nil
}
