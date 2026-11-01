package panel

import (
	"encoding/json"
	"errors"
	"regexp"
	"strings"
)

const iw4xAuthorityStartup = "exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/iw4x-native.py run"

// iw4xSettingsAuthority is source selection only. Files must include bounded,
// confined regular-file snapshots and confirmed absence for every shadow below.
// Caller repeats ALL observations after the settings lock, requires stopped
// state, compares both authority and document revisions, and retains file RBAC.
// Packed configs and native search precedence are not proved by this helper;
// do not enable an editor until those remaining resolution facts are established.
func iw4xSettingsAuthority(recipe, eggStartup string, in settingsAuthorityInput) (settingsPathAuthority, error) {
	refuse := errors.New("IW4x settings authority is unsupported or ambiguous")
	if recipe != iw4xSettingsRecipe || eggStartup != iw4xAuthorityStartup || in.Startup != eggStartup || !settingsAuthoritySources(in, iw4xAuthoritySources) {
		return settingsPathAuthority{}, refuse
	}
	env := in.Env
	if env["INSTALL_MODE"] != "existing" || env["SRCDS_APPID"] != "10190" || env["WINDOWS_INSTALL"] != "1" || env["WINETRICKS_RUN"] != "vcrun2022" {
		return settingsPathAuthority{}, refuse
	}
	// An operator updater may replace configs between source selection and launch.
	update := env["AUTO_UPDATE"]
	if value, ok := env["VOLTRA_STEAM_AUTO_UPDATE"]; ok {
		update = value
	}
	if update != "0" {
		return settingsPathAuthority{}, refuse
	}
	mod := env["MOD_DIR"]
	if mod != "" && !regexp.MustCompile(`^mods/[A-Za-z0-9_-]+$`).MatchString(mod) {
		return settingsPathAuthority{}, refuse
	}
	for _, key := range []string{"PYTHONPATH", "LD_PRELOAD", "EXTRA_ARGS", "ADDITIONAL_ARGS"} {
		if env[key] != "" {
			return settingsPathAuthority{}, refuse
		}
	}
	for _, dir := range []string{"", "main/", "iw4x/", "players/", "userraw/", mod + "/"} {
		for _, name := range []string{"server.cfg", "autoexec.cfg", "default_mp.cfg"} {
			path := strings.TrimPrefix(dir+name, "/")
			if path == "userraw/server.cfg" {
				continue
			}
			if _, exists := in.Files[path]; exists {
				return settingsPathAuthority{}, refuse
			}
		}
	}
	data, exists := in.Files["userraw/server.cfg"]
	if !exists {
		return settingsPathAuthority{}, refuse
	}
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "//") {
			continue
		}
		normalized := iw4xSetPrefix.ReplaceAllString(line, "")
		if sourceCvarLine.FindStringSubmatchIndex(normalized) == nil || strings.HasPrefix(strings.ToLower(normalized), "fs_") {
			return settingsPathAuthority{}, refuse
		}
		if normalized == line {
			return settingsPathAuthority{}, refuse
		}
	}
	parsed, err := parseIW4xSettings(data)
	if err != nil {
		return settingsPathAuthority{}, refuse
	}
	for _, field := range parsed.fields {
		if field.kind == "readonly" {
			return settingsPathAuthority{}, refuse
		}
	}
	// Bind all effective non-secret launcher selection values deterministically.
	selection := map[string]string{}
	for _, key := range []string{"INSTALL_MODE", "SRCDS_APPID", "WINDOWS_INSTALL", "WINETRICKS_RUN", "MOD_DIR", "AUTO_UPDATE", "VOLTRA_STEAM_AUTO_UPDATE", "SERVER_PORT", "VOLTRA_ALLOCATED_PORTS"} {
		selection[key] = env[key]
	}
	identity, _ := json.Marshal(selection)
	return settingsAuthorityResult(iw4xSettingsPath, "iw4x-authority-v1:"+in.Startup+string(identity)), nil
}

var iw4xAuthoritySources = map[string]string{
	".voltra/iw4x-native.py":    "0f07e6b5df10ccfd6cc822199b4473ff6bf721568199953c06731ed15d0e0836",
	".voltra/arena-native.py":   "d4292288ce7639403f77036318b641e8f4700cadfcfa6c465d149646c10b9a11",
	".voltra/native-console.py": "7f0c2a6e4050d12fc3bb2af9dcd723df6b80109fed91a26ccd1ae52d2bb1b3a4",
	".voltra/steam_template.py": "7d908cdc739fbb999fdfb13f48f3e8d3a5fdf26fbfa48091dee1442913078897",
}
