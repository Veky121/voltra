package panel

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"strconv"
	"strings"
	"unicode/utf8"
)

const kspDMPRecipe = "ksp/DMP/egg-k-s-p-d-m-p.json"
const kspDMPSettingsPath = "/Config/Settings.txt"
const kspDMPStartup = "exec python3 .voltra/ksp_runtime.py dmp"

// Pure snapshot validation only. Root must bound/confine every Wings read, lock,
// recheck RBAC/state and both authority/document revisions before publication.
// This identifies supported source, not an attested running process or binary.
func kspDMPSettingsAuthority(recipe, file string, in settingsAuthorityInput) (settingsPathAuthority, error) {
	refuse := errors.New("DMP settings authority needs the exact pinned launcher, source receipt and active path")
	if recipe != kspDMPRecipe || file != kspDMPSettingsPath || in.Startup != kspDMPStartup || !settingsAuthoritySources(in, map[string]string{
		".voltra/ksp_runtime.py": "c26b7c8ebf40d5bc9b30f97d42d6ef21b50ccccd36085f2c2ae1786ce3ea24de",
	}) {
		return settingsPathAuthority{}, refuse
	}
	raw := in.Files[".voltra/ksp/dmp-release.json"]
	if len(raw) == 0 || len(raw) > 65536 {
		return settingsPathAuthority{}, refuse
	}
	// Duplicate JSON keys are not accepted as source identity evidence.
	d := json.NewDecoder(bytes.NewReader(raw))
	t, e := d.Token()
	if e != nil || t != json.Delim('{') {
		return settingsPathAuthority{}, refuse
	}
	seen := map[string]bool{}
	fields := map[string]json.RawMessage{}
	for d.More() {
		t, e = d.Token()
		if e != nil {
			return settingsPathAuthority{}, refuse
		}
		k, ok := t.(string)
		if !ok || seen[strings.ToLower(k)] {
			return settingsPathAuthority{}, refuse
		}
		seen[strings.ToLower(k)] = true
		var v json.RawMessage
		if d.Decode(&v) != nil {
			return settingsPathAuthority{}, refuse
		}
		fields[k] = v
	}
	if _, e = d.Token(); e != nil {
		return settingsPathAuthority{}, refuse
	}
	var extra any
	if d.Decode(&extra) != io.EOF {
		return settingsPathAuthority{}, refuse
	}
	for k, want := range map[string]string{"game": "dmp", "version": "0.3.8.5", "source_commit": "8253dc8e4f40e4519c085c3ee223abecd1a52954", "runtime": "Microsoft.NETCore.App10"} {
		var got string
		if json.Unmarshal(fields[k], &got) != nil || got != want {
			return settingsPathAuthority{}, refuse
		}
	}
	var deps map[string]string
	if json.Unmarshal(fields["dependency_commits"], &deps) != nil || deps["External/SettingsParser"] != "0a1c1e1666bf94a9069acf1967e64d2679dc27a2" {
		return settingsPathAuthority{}, refuse
	}
	return settingsAuthorityResult(file, kspDMPStartup+":"+settingsAuthorityHash(raw)), nil
}

// SettingsStore and SettingsParser are pinned in the installer. Native strings
// are literal after '='; the generic INI engine agrees only for this bounded
// unquoted subset. Opaque rows never enter that engine or the response.
func parseKspDMPSettings(data []byte) (gameSettingsParsed, error) {
	out := gameSettingsParsed{fields: []gameSetting{}}
	if len(data) > 8*1024*1024 || !utf8.Valid(data) || bytes.ContainsRune(data, 0) {
		return out, bad("Invalid DMP settings")
	}
	bom := ""
	text := string(data)
	if strings.HasPrefix(text, "\ufeff") {
		bom = "\ufeff"
		text = strings.TrimPrefix(text, bom)
	}
	lines := strings.SplitAfter(text, "\n")
	parsers := map[string]gameSettingsParsed{}
	indexes := map[string]int{}
	seen := map[string]bool{}
	for i, line := range lines {
		trim := strings.TrimSpace(line)
		if strings.HasPrefix(trim, "#") {
			continue
		}
		name, value, ok := strings.Cut(trim, "=")
		if !ok {
			continue
		}
		canonical := ""
		for _, k := range []string{"serverName", "maxPlayers", "whitelisted", "sendPlayerToLatestSubspace", "useUTCTimeInLog", "cheats", "compressionEnabled", "port", "httpPort", "address", "supportIpv6", "screenshotDirectory"} {
			if strings.EqualFold(strings.TrimSpace(name), k) {
				canonical = k
				break
			}
		}
		if canonical == "" {
			continue
		}
		if name != canonical || seen[canonical] {
			return out, bad("Ambiguous DMP setting")
		}
		seen[canonical] = true
		kind := kspDMPKind(canonical)
		if kind == "" {
			continue
		} // managed ports, paths and unsupported IPv6 remain opaque
		if !kspDMPValue(canonical, value) || strings.ContainsAny(value, "#;\"'\\=\t") || strings.TrimSpace(value) != value {
			return out, bad("Unsupported DMP scalar syntax")
		}
		p, e := parseGameSettingsLines("Settings.ini", []byte(line))
		if e != nil || len(p.fields) != 1 {
			return out, bad("Unsupported DMP scalar")
		}
		f := p.fields[0]
		f.kind = kind
		f.value = value
		f.structured = false
		if kind == "boolean" {
			f.on = "True"
			f.off = "False"
		}
		out.fields = append(out.fields, f)
		parsers[canonical] = p
		indexes[canonical] = i
	}
	out.patch = func(changes map[string]string) ([]byte, error) {
		next := append([]string(nil), lines...)
		for k, v := range changes {
			p, ok := parsers[k]
			if !ok || !kspDMPValue(k, v) || strings.ContainsAny(v, "#;\"'\\=\t") {
				return nil, bad("Invalid or managed DMP setting")
			}
			b, e := p.patch(map[string]string{k: v})
			if e != nil {
				return nil, e
			}
			next[indexes[k]] = string(b)
		}
		return []byte(bom + strings.Join(next, "")), nil
	}
	return out, nil
}
func kspDMPKind(k string) string {
	switch k {
	case "serverName":
		return "text"
	case "maxPlayers":
		return "number"
	case "whitelisted", "sendPlayerToLatestSubspace", "useUTCTimeInLog", "cheats", "compressionEnabled":
		return "boolean"
	}
	return ""
}
func kspDMPValue(k, v string) bool {
	switch kspDMPKind(k) {
	case "text":
		return len(v) <= 48 && strings.TrimSpace(v) == v && quickSingleLine(v)
	case "number":
		n, e := strconv.Atoi(v)
		return e == nil && n >= 1 && n <= 1000
	case "boolean":
		return v == "True" || v == "False"
	}
	return false
}
