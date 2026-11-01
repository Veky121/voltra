package panel

import (
	"bytes"
	"encoding/json"
	"strconv"
	"strings"
	"unicode/utf8"
)

const groundBranchSettingsRecipe = "ground_branch/egg-ground-branch.json"
const groundBranchSettingsPath = "/GroundBranch/ServerConfig/Server.ini"
const groundBranchSettingsSection = "/Script/RBZooKeeper.ZKServer/"
const groundBranchSettingsStartup = "exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/tactical_next_runtime.py"

// Only shipped, bounded identity/player scalars. Other native rules remain opaque.
func groundBranchScalar(key, value string) bool {
	if !utf8.ValidString(value) || strings.ContainsAny(value, "\"'\\;#=[]{}()") || strings.IndexFunc(value, func(r rune) bool { return r < 32 || r == 127 || r == 0x85 || r == 0x2028 || r == 0x2029 }) >= 0 {
		return false
	}
	switch strings.TrimPrefix(key, groundBranchSettingsSection) {
	case "ServerName":
		return strings.TrimSpace(value) != "" && utf8.RuneCountInString(value) <= 64
	case "ServerMOTD":
		return utf8.RuneCountInString(value) <= 512
	case "MaxPlayers", "MaxSpectators":
		if value == "" || strings.Trim(value, "0123456789") != "" {
			return false
		}
		n, e := strconv.ParseUint(value, 10, 31)
		return e == nil && (n > 0 || strings.HasSuffix(key, "MaxSpectators"))
	}
	return false
}
func groundBranchKnown(key string) string {
	for _, name := range []string{"ServerName", "ServerMOTD", "MaxPlayers", "MaxSpectators"} {
		if strings.EqualFold(key, groundBranchSettingsSection+name) {
			return groundBranchSettingsSection + name
		}
	}
	return ""
}

// Reuse generic byte spans; never seed missing rows or expand Unreal arrays.
func parseGroundBranchSettings(data []byte) (gameSettingsParsed, error) {
	if len(data) > 8*1024*1024 || !utf8.Valid(data) || bytes.ContainsRune(data, 0) {
		return gameSettingsParsed{}, bad("Invalid Ground Branch INI.")
	}
	bom := []byte{239, 187, 191}
	body := bytes.TrimPrefix(data, bom)
	p, e := parseGameSettingsLines(groundBranchSettingsPath, body)
	if e != nil {
		return p, e
	}
	p = gameSettingsINICaseSafety(groundBranchSettingsPath, body, p)
	fields := []gameSetting{}
	allowed := map[string]string{}
	seen := map[string]bool{}
	for _, f := range p.fields {
		candidate := f.key
		cut := strings.LastIndex(candidate, "/")
		if cut >= 0 {
			candidate = candidate[:cut+1] + strings.TrimLeft(candidate[cut+1:], "+-.!")
		}
		k := groundBranchKnown(candidate)
		if k == "" {
			continue
		}
		if candidate != f.key || f.kind == "readonly" || seen[k] || !groundBranchScalar(k, f.value) {
			return gameSettingsParsed{}, bad("Ambiguous or invalid Ground Branch scalar.")
		}
		seen[k] = true
		allowed[f.key] = k
		f.kind = "text"
		f.structured = false
		if strings.Contains(k, "/Max") {
			f.kind = "number"
		}
		fields = append(fields, f)
	}
	patch := p.patch
	p.fields = fields
	p.patch = func(changes map[string]string) ([]byte, error) {
		for k, v := range changes {
			canonical, ok := allowed[k]
			if !ok || !groundBranchScalar(canonical, v) {
				return nil, bad("Unsupported Ground Branch change.")
			}
		}
		out, e := patch(changes)
		if e == nil && len(body) != len(data) {
			out = append(bytes.Clone(bom), out...)
		}
		return out, e
	}
	return p, nil
}
func groundBranchSettingPresentation(field M) {
	k := str(field["key"])
	if groundBranchKnown(k) == "" {
		return
	}
	field["group"] = "General"
	field["restartRequired"] = true
	switch {
	case strings.HasSuffix(k, "/ServerName"):
		field["label"] = "Server name"
	case strings.HasSuffix(k, "/ServerMOTD"):
		field["label"] = "Message of the day"
	case strings.HasSuffix(k, "/MaxPlayers"):
		field["label"] = "Maximum players"
	case strings.HasSuffix(k, "/MaxSpectators"):
		field["label"] = "Maximum spectators"
	}
}

// Pure snapshots only. Root must read actual effective startup, empty Wings file
// mappings and confined regular helper files, then repeat after the save lock.
func groundBranchSettingsAuthority(recipe, startup string, mappings []byte, in settingsAuthorityInput) (settingsPathAuthority, error) {
	refuse := bad("Unsupported Ground Branch launcher or file authority.")
	var config map[string]json.RawMessage
	if recipe != groundBranchSettingsRecipe || startup != groundBranchSettingsStartup || in.Startup != startup || json.Unmarshal(mappings, &config) != nil || config == nil || len(config) != 0 {
		return settingsPathAuthority{}, refuse
	}
	if in.Env["VOLTRA_TACTICAL_NEXT"] != "groundbranch" || (in.Env["SRCDS_APPID"] != "" && in.Env["SRCDS_APPID"] != "476400") || (in.Env["WINDOWS_INSTALL"] != "" && in.Env["WINDOWS_INSTALL"] != "1") {
		return settingsPathAuthority{}, refuse
	}
	for name, digest := range groundBranchSettingsSources {
		if settingsAuthorityHash(in.Files[name]) != digest {
			return settingsPathAuthority{}, refuse
		}
	}
	data, ok := in.Files[strings.TrimPrefix(groundBranchSettingsPath, "/")]
	if !ok {
		return settingsPathAuthority{}, refuse
	}
	if _, e := parseGroundBranchSettings(data); e != nil {
		return settingsPathAuthority{}, e
	}
	return settingsAuthorityResult(groundBranchSettingsPath, "groundbranch-wave42:"+recipe+":"+startup+":"+settingsAuthorityHash(mappings)), nil
}

var groundBranchSettingsSources = map[string]string{
	".voltra/steam_template.py":        "dc8ff0a9e462751878aad55da80bea8fd2a2d4ef16dbf8d37b798ea8d4c476dd",
	".voltra/source_install.py":        "a1f63dd97984ed20dba5b5af6fddfaff5efdd15f7666231b32728da0c5f54a13",
	".voltra/source_next_install.py":   "ab8c1f51facbb540191bbb9904a8aae7479cf3804d5c71726a96c0819ff0a70e",
	".voltra/bundle_debian_python.py":  "16b2ebdcfa2656b591624c9d627defa4c3940be4c8a69d8842778ff25ea0cdc0",
	".voltra/native_config.py":         "8c125bb526b38896eeba57143ec2fc70bfb94f1c9783e4c6d652d8f57e3b52a2",
	".voltra/native_console.py":        "e8274872cb9ccbf7c60bca3615aed0d200c66bc28dc54b7fdd3b243070f9f3e5",
	".voltra/tactical_install.py":      "bf5b741881a20faf82a0fb53800abac90b9c4b32b4ba19198879579fee6f120e",
	".voltra/tactical_runtime.py":      "d0b95c6ae327dbdb7dc298141eddd9eba288693b91a3369b3dc120b3cd399578",
	".voltra/tactical_next_install.py": "0aa6ea0da0f919fd146b2dcd1ee2fbca6940ecaa2024da5d78a88501315610d6",
	".voltra/tactical_next_runtime.py": "5688ce21c87fade0b5217e30c66cff00702a15d24a3c3074c164ab2397850956",
	".voltra/native_log.py":            "ab7c12a2fc192d852b45d913207ebf63e7cb3497cbb349c34ebb8a3c0df89d92",
}
