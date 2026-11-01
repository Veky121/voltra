package panel

import (
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"
)

const foundryVTTRecipe = "foundry_vtt/egg-FoundryVTT.json"
const fiveMRecipe = "gta/fivem/egg-five-m.json"

const portalKnightsRecipe = "portal_knights/egg-portal-knights.json"

const resoniteSettingsRecipe = "resonite/egg-resonite.json"

func reviewedNewSettings(egg M) (string, string) {
	if nativeSettingsIsRecipe(egg, sonsSettingsRecipe) {
		return sonsSettingsPath, sonsSettingsStartup
	}
	if nativeSettingsIsRecipe(egg, resoniteSettingsRecipe) {
		return "/Headless/Config/Config.json", "exec python3 .voltra/resonite_owner.py runtime"
	}
	if nativeSettingsIsRecipe(egg, redMSettingsRecipe) {
		return redMSettingsPath, "exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/redm-owner-next.py"
	}
	if nativeSettingsIsRecipe(egg, portalKnightsRecipe) {
		return "/dedicated_server/server_config.json", "exec python3 .voltra/portal_knights_owner_next.py"
	}

	if nativeSettingsIsRecipe(egg, foundryVTTRecipe) {
		return "/data/Config/options.json", "exec python3 .voltra/foundry-native.py run"
	}
	if nativeSettingsIsRecipe(egg, fiveMRecipe) {
		return "/server.cfg", "exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/fivem-runtime.py"
	}
	return "", ""
}
func reviewedNewDocument(egg M, file string) bool {
	p, s := reviewedNewSettings(egg)
	return p != "" && p == file && str(egg["startup"]) == s
}

var fiveMScalar = regexp.MustCompile(`^(\s*(?:set[ \t]+)?)(sv_hostname|sv_maxclients|sv_lan)(\s+)("[^"\r\n]*"|[^\s";]+)(\s*(?://.*|#.*)?)$`)

func parseFiveMSettings(data []byte) (gameSettingsParsed, error) {
	out := gameSettingsParsed{}
	lines := strings.Split(string(data), "\n")
	indexes := map[string]int{}
	matches := map[string][]string{}
	valid := func(k, v string) bool {
		if strings.ContainsAny(v, "\r\n\x00\";\\") || !utf8.ValidString(v) || len(v) > 128 {
			return false
		}
		if k == "sv_hostname" {
			return true
		}
		n, e := strconv.Atoi(v)
		if k == "sv_lan" {
			return v == "true" || v == "false" || e == nil && (n == 0 || n == 1)
		}
		return e == nil && n >= 1 && n <= 48
	}
	for i, line := range lines {
		t := strings.TrimSpace(line)
		if t == "" || strings.HasPrefix(t, "#") || strings.HasPrefix(t, "//") {
			continue
		}
		cmd := strings.Fields(t)[0]
		if cmd == "exec" || cmd == "vstr" || strings.ContainsAny(t, ";\x00") {
			return out, bad("Use Files for executable or ambiguous FiveM configuration.")
		}
		m := fiveMScalar.FindStringSubmatch(strings.TrimSuffix(line, "\r"))
		if m == nil {
			if cmd == "sv_hostname" || cmd == "sv_maxclients" || cmd == "sv_lan" {
				return out, bad("Ambiguous FiveM setting.")
			}
			continue
		}
		k := m[2]
		v := strings.Trim(m[4], "\"")
		if _, ok := indexes[k]; ok || !valid(k, v) {
			return out, bad("Invalid or duplicate FiveM setting.")
		}
		indexes[k] = i
		matches[k] = m
		kind := "number"
		if k == "sv_hostname" {
			kind = "text"
		}
		if k == "sv_lan" {
			kind = "boolean"
		}
		on, off := "1", "0"
		if k == "sv_lan" && (v == "true" || v == "false") {
			on, off = "true", "false"
		}
		out.fields = append(out.fields, gameSetting{key: k, value: v, kind: kind, on: on, off: off})
	}
	out.patch = func(changes map[string]string) ([]byte, error) {
		next := append([]string(nil), lines...)
		for k, v := range changes {
			i, ok := indexes[k]
			if !ok || !valid(k, v) {
				return nil, bad("Invalid FiveM setting change.")
			}
			m := matches[k]
			if k == "sv_hostname" {
				v = "\"" + v + "\""
			}
			cr := ""
			if strings.HasSuffix(lines[i], "\r") {
				cr = "\r"
			}
			next[i] = m[1] + k + m[3] + v + m[5] + cr
		}
		return []byte(strings.Join(next, "\n")), nil
	}
	return out, nil
}
