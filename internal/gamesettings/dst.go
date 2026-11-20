package gamesettings

import (
	"bytes"
	"crypto/sha256"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"
)

const DstSettingsRecipe = "dont_starve/egg-don-t-starve-together.json"
const dstSettingsStartup = "exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/dst_runtime.py"

var dstClusterIdentity = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)

// Pure validation only. Root must supply bounded regular-file/no-symlink reads,
// actual startup/environment and mappings after RBAC/state lock, then revision CAS.
// This proves source selection, never a running process's arguments or consumption.
func dstSettingsAuthority(recipe, startup, identity, file string, mappings int, files map[string][]byte) error {
	if recipe != DstSettingsRecipe || startup != dstSettingsStartup || mappings != 0 || !dstClusterIdentity.MatchString(identity) {
		return fmt.Errorf("unsupported DST launch authority")
	}
	base := "/DoNotStarveTogether/config/" + identity
	if file != base+"/cluster.ini" && file != base+"/Master/server.ini" && file != base+"/Caves/server.ini" {
		return fmt.Errorf("inactive DST path")
	}
	pins := map[string]string{"/.voltra/steam_template.py": "7d908cdc739fbb999fdfb13f48f3e8d3a5fdf26fbfa48091dee1442913078897", "/.voltra/bundle_debian_python.py": "16b2ebdcfa2656b591624c9d627defa4c3940be4c8a69d8842778ff25ea0cdc0", "/.voltra/native_config.py": "8c125bb526b38896eeba57143ec2fc70bfb94f1c9783e4c6d652d8f57e3b52a2", "/.voltra/native_shards.py": "99b212190eb6a0e634cdc76de13a28e6eb7f16f2c1e1e1a2e1c997e5877f081d", "/.voltra/dst_config.py": "8d72e0a451398e20dc159ffdf5f16af3dcebd6ce1322564f2b54e576478a3ff8", "/.voltra/dst_install.py": "032e135613ea56688969b78b4521161e88de4c672bab8f75c698b3cfd5775849", "/.voltra/dst_runtime.py": "4158158a35dc5fb6d7da526759900cbfb1a986445464e294b925a41c0c65ffad"}
	for name, pin := range pins {
		data, ok := files[name]
		if !ok || fmt.Sprintf("%x", sha256.Sum256(data)) != pin {
			return fmt.Errorf("DST helper drift: %s", name)
		}
	}
	return nil
}

func dstSettingValid(key, value string) bool {
	if !utf8.ValidString(value) || strings.TrimSpace(value) != value || strings.ContainsFunc(value, unicode.IsControl) || strings.ContainsAny(value, `;#=[]{}()"'\`) {
		return false
	}
	switch key {
	case "GAMEPLAY/game_mode":
		return value == "survival" || value == "endless" || value == "wilderness" || value == "relaxed" || value == "lightsout"
	case "GAMEPLAY/max_players":
		n, e := strconv.Atoi(value)
		return e == nil && n >= 1 && n <= 31 && strconv.Itoa(n) == value
	case "GAMEPLAY/pvp", "GAMEPLAY/pause_when_empty":
		return value == "true" || value == "false"
	case "NETWORK/cluster_name":
		return len(value) <= 256
	case "NETWORK/cluster_description":
		return len(value) <= 1024
	case "NETWORK/cluster_password":
		return len(value) <= 128
	}
	return false
}

// No creation or default insertion. Unknown and managed values stay opaque.
// The shared INI byte-span patcher owns serialization; this adapter only fences schema.
func parseDSTSettings(file string, data []byte) (Parsed, error) {
	invalid := func() (Parsed, error) {
		return Parsed{}, bad("Unsupported or ambiguous DST configuration.")
	}
	if len(data) > 1024*1024 || !utf8.Valid(data) || bytes.ContainsRune(data, 0) {
		return invalid()
	}
	if !strings.HasSuffix(file, "/cluster.ini") && !strings.HasSuffix(file, "/Master/server.ini") && !strings.HasSuffix(file, "/Caves/server.ini") {
		return invalid()
	}
	body := bytes.TrimPrefix(data, []byte{239, 187, 191})
	// Reject syntax that Python ConfigParser could interpret differently from the
	// scalar editor, including DEFAULT inheritance, continuations and case aliases.
	sections, keys := map[string]bool{}, map[string]bool{}
	section := ""
	for _, line := range strings.Split(string(body), "\n") {
		t := strings.TrimSpace(line)
		if t == "" || strings.HasPrefix(t, ";") || strings.HasPrefix(t, "#") {
			continue
		}
		if strings.HasPrefix(t, "[") {
			if !strings.HasSuffix(t, "]") || strings.Count(t, "]") != 1 {
				return invalid()
			}
			section = t[1 : len(t)-1]
			fold := strings.ToLower(section)
			if sections[fold] || fold == "default" || strings.ContainsAny(section, "/\\") {
				return invalid()
			}
			sections[fold] = true
			if fold == "gameplay" || fold == "network" || fold == "misc" || fold == "shard" || fold == "steam" {
				if section != strings.ToUpper(section) {
					return invalid()
				}
			}
			continue
		}
		if section == "" || line[0] == ' ' || line[0] == '\t' {
			return invalid()
		}
		name, _, ok := strings.Cut(t, "=")
		name = strings.TrimSpace(name)
		if !ok || name == "" || strings.ContainsAny(name, "/:\\") {
			return invalid()
		}
		key := section + "/" + name
		fold := strings.ToLower(key)
		if keys[fold] {
			return invalid()
		}
		keys[fold] = true
	}
	parsed, err := parseGameSettingsLines(file, body)
	if err != nil {
		return Parsed{}, err
	}
	out := Parsed{}
	writable := map[string]bool{}
	cluster := strings.HasSuffix(file, "/cluster.ini")
	for _, f := range parsed.Fields {
		// Reject aliases of supported names even when the value isn't valid.
		known := false
		for _, k := range []string{"GAMEPLAY/game_mode", "GAMEPLAY/max_players", "GAMEPLAY/pvp", "GAMEPLAY/pause_when_empty", "NETWORK/cluster_name", "NETWORK/cluster_description", "NETWORK/cluster_password"} {
			if strings.EqualFold(f.Key, k) {
				if f.Key != k {
					return invalid()
				}
				known = true
			}
		}
		if SettingSecret.MatchString(f.Key) || strings.EqualFold(f.Key, "SHARD/cluster_key") {
			continue
		}
		if cluster && known {
			if !dstSettingValid(f.Key, f.Value) {
				return invalid()
			}
			writable[f.Key] = true
			f.Kind = "text"
			if f.Key == "GAMEPLAY/max_players" {
				f.Kind = "number"
			}
			if f.Key == "GAMEPLAY/pvp" || f.Key == "GAMEPLAY/pause_when_empty" {
				f.Kind, f.On, f.Off = "boolean", "true", "false"
			}
		} else {
			if !(f.Key == "SHARD/shard_enabled" || f.Key == "SHARD/bind_ip" || f.Key == "SHARD/master_ip" || f.Key == "SHARD/master_port" || f.Key == "SHARD/is_master" || f.Key == "SHARD/name" || f.Key == "SHARD/id" || f.Key == "MISC/console_enabled" || f.Key == "STEAM/master_server_port" || f.Key == "STEAM/authentication_port" || f.Key == "NETWORK/server_port" || f.Key == "NETWORK/offline_cluster" || f.Key == "NETWORK/lan_only_cluster") {
				continue
			}
			f.Kind = "readonly"
		}
		f.structured = false
		out.Fields = append(out.Fields, f)
	}
	original := bytes.Clone(data)
	out.Patch = func(changes map[string]string) ([]byte, error) {
		for k, v := range changes {
			if !writable[k] || !dstSettingValid(k, v) {
				return nil, bad("DST setting is managed, secret, absent or invalid.")
			}
		}
		if len(changes) == 0 {
			return bytes.Clone(original), nil
		}
		next, e := parsed.Patch(changes)
		if e != nil {
			return nil, e
		}
		if len(body) != len(data) {
			next = append([]byte{239, 187, 191}, next...)
		}
		if _, e = parseDSTSettings(file, next); e != nil {
			return nil, e
		}
		return next, nil
	}
	return out, nil
}

// Root calls this from the shared grouped-control presentation path.
func dstSettingPresentation(field M) {
	field["group"], field["restart_required"] = "General", true
	key := str(field["key"])
	if strings.HasPrefix(key, "GAMEPLAY/") {
		field["group"] = "Gameplay"
	}
	if key == "GAMEPLAY/max_players" {
		field["min"], field["max"] = 1, 31
	}
	if key == "GAMEPLAY/game_mode" {
		field["type"], field["options"] = "select", []string{"survival", "endless", "wilderness", "relaxed", "lightsout"}
	}
}
