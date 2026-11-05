package panel

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"math/big"
	"net"
	"regexp"
	"strings"
	"unicode/utf8"
)

const fofSettingsRecipe = "fof/egg-fof.json"

const fofSettingsPath = "/fof/cfg/server.cfg"
const fofSettingsStartup = "exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/source_variants_wave58.py 295230"

// Historical app295230 native acceptance observed 17 and a Team Shootout cap
// of 20. This deliberately conservative nonnegative range does
// not claim a universal clamp for every FoF mode.
func fofSettingValue(key, value string) bool {
	if key != "mp_timelimit" || len(value) > 32 || !sourceNumber.MatchString(value) {
		return false
	}
	n, ok := new(big.Rat).SetString(value)
	return ok && n.Sign() >= 0 && n.Cmp(big.NewRat(20, 1)) <= 0
}

// This parses file bytes only. Root must establish effective startup/path
// authority before dispatch, and repeat that check after acquiring the save lock.
func parseFoFSettings(data []byte) (gameSettingsParsed, error) {
	if len(data) > 8*1024*1024 || !utf8.Valid(data) || bytes.HasPrefix(data, []byte{0xef, 0xbb, 0xbf}) {
		return gameSettingsParsed{}, bad("Invalid FoF settings document.")
	}
	out, err := parseSourceSettingsWithSchema(data, map[string]string{"mp_timelimit": "number"}, fofSettingValue)
	if err != nil {
		return out, err
	}
	unsafe := false
	for _, raw := range strings.Split(string(data), "\n") {
		line := strings.TrimSuffix(raw, "\r")
		if len(line) > 65536 || strings.ContainsAny(line, "\r\u0085\u2028\u2029") {
			return gameSettingsParsed{}, bad("Unsupported FoF settings line.")
		}
		trim := strings.TrimSpace(line)
		if trim == "" || strings.HasPrefix(trim, "//") {
			continue
		}
		// Every other executable statement may change precedence or the command
		// namespace. Preserve it, but require the native editor for such documents.
		if trim == "writeip" || trim == "writeid" {
			continue
		}
		parts := strings.Fields(trim)
		if len(parts) == 2 && parts[0] == "exec" && (parts[1] == "banned_user.cfg" || parts[1] == "banned_ip.cfg") {
			continue
		}
		m := sourceCvarLine.FindStringSubmatch(line)
		if m == nil {
			unsafe = true
			continue
		}
		switch strings.ToLower(m[2]) {
		case "mp_timelimit", "hostname", "sv_password", "rcon_password", "sv_lan", "tv_enable", "tv_port",
			"sv_turbophysics", "sv_voiceenable", "sv_alltalk", "sv_allow_wait_command", "sv_region", "fof_sv_currentmode", "mp_teamplay", "fof_sv_maxteams", "mp_forcecamera", "fof_sv_bot_dynamicjoin", "fof_sv_bot_slotpct", "fof_bot_skill", "sv_minrate", "sv_maxrate", "sv_minupdaterate", "sv_maxupdaterate", "sv_maxcmdrate", "sv_mincmdrate", "sv_client_max_interp_ratio", "sv_client_min_interp_ratio", "sv_client_predict", "log", "sv_logbans", "sv_logecho", "sv_logfile", "sv_log_onefile", "sv_downloadurl", "sv_allowdownload", "sv_allowupload", "fof_sv_motd_countdown", "fof_sv_maxidle_secs", "fof_sv_obj_warmuptime", "fof_sv_dm_comp", "fof_sv_dm_comp_points", "net_maxroutable", "net_maxfragments":
		default:
			unsafe = true
		}
	}
	if unsafe {
		for i := range out.fields {
			out.fields[i].kind = "readonly"
		}
		out.patch = func(changes map[string]string) ([]byte, error) {
			if len(changes) > 0 {
				return nil, bad("FoF executable or unreviewed configuration requires the native file editor.")
			}
			return append([]byte(nil), data...), nil
		}
	}
	return out, nil
}

// Pins cover every emitted module from the frozen canonical FoF installer.
func fofSourceHelpers(files map[string][]byte) bool {
	pins := map[string]string{
		".voltra/steam_template.py":         "7d908cdc739fbb999fdfb13f48f3e8d3a5fdf26fbfa48091dee1442913078897",
		".voltra/source_install.py":         "a1f63dd97984ed20dba5b5af6fddfaff5efdd15f7666231b32728da0c5f54a13",
		".voltra/bundle_debian_python.py":   "16b2ebdcfa2656b591624c9d627defa4c3940be4c8a69d8842778ff25ea0cdc0",
		".voltra/native_console.py":         "e8274872cb9ccbf7c60bca3615aed0d200c66bc28dc54b7fdd3b243070f9f3e5",
		".voltra/source_runtime.py":         "f04a64a44b49a03ad45af79d61698b413b27c0ee999081696024085944633752",
		".voltra/source_variant_runtime.py": "6a22ec1d61167233f22be3332d409369bc3f0119e0308f6a89482cbeb6c200b3",
		".voltra/source_pair_preflight.py":  "017d25ca65651161301bb11e56684786c79cebfe678344d9e669ad26f188083b",
		".voltra/source_variants_wave58.py": "e93e35cfb31eecace31054e937fa705d53b9ff8a142fc1e61db7218c3ba1fd03",
	}
	for name, pin := range pins {
		sum := sha256.Sum256(files[name])
		if hex.EncodeToString(sum[:]) != pin {
			return false
		}
	}
	return true
}

func fofSettingPresentation(egg M, file string, field M) {
	if !nativeSettingsIsRecipe(egg, fofSettingsRecipe) || file != fofSettingsPath || str(egg["startup"]) != fofSettingsStartup {
		return
	}
	if field["key"] == "mp_timelimit" {
		field["label"] = "Map time limit (minutes)"
		if field["type"] == "number" && field["readonly"] != true && field["secret"] != true {
			field["min"] = 0
			field["max"] = 20
		}
	}
}

// Wings injects SERVER_PORT from the primary allocation at container creation.
// The panel environment normally omits it; reject a conflicting explicit value.
func fofPrimaryPortMatches(env map[string]string, primary string) bool {
	return env["SERVER_PORT"] == "" || env["SERVER_PORT"] == primary
}

var fofBanIdentity = regexp.MustCompile(`^(?:STEAM_[0-5]:[01]:[0-9]+|\[U:1:[0-9]+\])$`)

// Only ban data may execute after the editable scalar in the publisher config.
// Arbitrary nested commands, aliases and traversal never gain edit authority.
func fofBanDataSafe(data []byte, ipFile bool) bool {
	if len(data) > 1024*1024 || !utf8.Valid(data) {
		return false
	}
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "//") {
			continue
		}
		p := strings.Fields(line)
		if len(p) != 3 || !sourceNumber.MatchString(p[1]) {
			return false
		}
		n, ok := new(big.Rat).SetString(p[1])
		if !ok || n.Sign() < 0 {
			return false
		}
		if ipFile {
			if p[0] != "addip" || net.ParseIP(p[2]) == nil {
				return false
			}
		} else if p[0] != "banid" || !fofBanIdentity.MatchString(p[2]) {
			return false
		}
	}
	return true
}
