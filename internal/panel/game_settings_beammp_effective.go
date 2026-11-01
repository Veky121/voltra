package panel

import (
	"fmt"
	"strconv"
	"strings"
	"unicode/utf8"
)

// Mirrors the staged pure prepare General scalar contract. Filesystem ownership
// and native resource availability remain separate gates.
func validateBeamMPEffective(document map[string]any, seeds ...M) error {
	env := M{}
	if len(seeds) > 0 && seeds[0] != nil {
		env = seeds[0]
	}
	general := map[string]any{}
	if raw, exists := document["General"]; exists {
		var ok bool
		general, ok = raw.(map[string]any)
		if !ok {
			return bad("General must be a table.")
		}
	}
	fields := []struct {
		key, control string
		fallback     any
	}{
		{"Name", "NAME", "BeamMP Server"}, {"Description", "DESCRIPTION", "BeamMP Default Description"}, {"AuthKey", "AUTHKEY", ""}, {"Map", "MAP", "/levels/gridmap_v2/info.json"},
		{"Private", "PRIVATE", true}, {"LogChat", "LOGCHAT", true}, {"MaxPlayers", "MAX_PLAYERS", int64(6)}, {"MaxCars", "MAX_CARS", int64(1)}, {"Tags", "TAGS", "Freeroam"}, {"AllowGuests", "ALLOW_GUESTS", true}, {"InformationPacket", "INFORMATION_PACKET", false}, {"Debug", "DEBUG", false}, {"ResourceFolder", "RESOURCE_FOLDER", "Resources"},
	}
	integer := func(v any, lo, hi int64) bool {
		s := fmt.Sprint(v)
		if s == "" {
			return false
		}
		for _, c := range s {
			if c < '0' || c > '9' {
				return false
			}
		}
		n, e := strconv.ParseInt(s, 10, 64)
		return e == nil && n >= lo && n <= hi
	}
	for _, f := range fields {
		v, native := general[f.key]
		if !native {
			var exists bool
			v, exists = env[f.control]
			if !exists {
				v = f.fallback
			}
		}
		invalid := false
		switch f.fallback.(type) {
		case bool:
			if native {
				_, ok := v.(bool)
				invalid = !ok
			}
			s := strings.ToLower(fmt.Sprint(v))
			invalid = invalid || (s != "true" && s != "false" && s != "0" && s != "1")
		case int64:
			if native {
				_, ok := v.(int64)
				invalid = !ok
			}
			lo, hi := int64(0), int64(10)
			if f.key == "MaxPlayers" {
				lo, hi = 1, 100
			}
			invalid = invalid || !integer(v, lo, hi)
		case string:
			s, ok := v.(string)
			limit := 1024
			if f.key == "AuthKey" {
				limit = 64
			}
			invalid = !ok || !utf8.ValidString(s) || utf8.RuneCountInString(s) > limit
			for _, c := range s {
				if c < 32 || c == 127 {
					invalid = true
				}
			}
			if f.key == "AuthKey" && s == "" {
				invalid = true
			}
			if f.key == "ResourceFolder" {
				invalid = invalid || s == "" || strings.HasPrefix(s, "/")
				for _, part := range strings.Split(s, "/") {
					if part == ".." {
						invalid = true
					}
				}
			}
		}
		if invalid {
			return bad("Invalid effective BeamMP General setting: " + f.key)
		}
	}
	if v, ok := general["Port"]; ok {
		if _, ok := v.(int64); !ok || !integer(v, 1024, 65535) {
			return bad("Invalid native BeamMP port.")
		}
	}
	port, ok := env["SERVER_PORT"]
	if !ok {
		port = "30814"
	}
	if !integer(port, 1024, 65535) {
		return bad("Invalid allocated BeamMP port.")
	}
	allocated, ok := env["VOLTRA_ALLOCATED_PORTS"]
	if !ok {
		allocated = fmt.Sprint(port)
	}
	found := false
	pn, _ := strconv.ParseInt(fmt.Sprint(port), 10, 64)
	for _, s := range strings.Split(fmt.Sprint(allocated), ",") {
		s = strings.TrimSpace(s)
		if !integer(s, 1024, 65535) {
			return bad("Invalid BeamMP allocations.")
		}
		n, _ := strconv.ParseInt(s, 10, 64)
		found = found || n == pn
	}
	if !found {
		return bad("Primary BeamMP port is not allocated.")
	}
	return nil
}
