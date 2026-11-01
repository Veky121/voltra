package panel

import "errors"

const puckAuthorityStartup = "exec python3 .voltra/puck_file_authority.py"

// Pinned current canonical emitted modules, not historical native acceptance.
var puckAuthoritySources = map[string]string{
	".voltra/steam_template.py":           "7d908cdc739fbb999fdfb13f48f3e8d3a5fdf26fbfa48091dee1442913078897",
	".voltra/native_config.py":            "8c125bb526b38896eeba57143ec2fc70bfb94f1c9783e4c6d652d8f57e3b52a2",
	".voltra/native_console.py":           "7f0c2a6e4050d12fc3bb2af9dcd723df6b80109fed91a26ccd1ae52d2bb1b3a4",
	".voltra/light_games_next_runtime.py": "fa397706ee24ddd779f2152356cbad9d946fdb647e3aa8c44a69599ef6ab6b96",
	".voltra/light_games_next_install.py": "7a5f774bf977ac39c4d3deff529ed44384d901acb7de3e67df8d00bb7be60885",
	".voltra/puck_readiness.py":           "1854ece3ca098cd4c06b07de32525e34a4a14473af88e70799f3ce45cebc8b70",
	".voltra/puck_file_authority.py":      "c0edfcbf4a91aa541c657f574f14afa52e50ee23e52e35709cdbaf31b8d2d77d",
}

// puckSettingsAuthority accepts confined, bounded regular-file snapshots obtained
// using the supported Wings file API. Root must repeat these reads and selection
// after the existing settings write lock, and compare both authority and content
// revisions. It grants no permissions and makes no external SFTP race guarantee.
// The adapter fixes cwd to /home/container and invokes /bin/bash start_server.sh
// --serverConfigPath /home/container/server_config.json. The captured publisher
// launcher forwards "$@" unchanged. LoadConfig gives nonempty environment JSON
// precedence over inline CLI JSON, then path CLI, then ./server_config.json.
func puckSettingsAuthority(recipe, eggStartup string, in settingsAuthorityInput) (settingsPathAuthority, error) {
	refuse := errors.New("Puck settings authority is unsupported or ambiguous")
	if recipe != "puck/egg-puck.json" || eggStartup != puckAuthorityStartup || in.Startup != eggStartup || !settingsAuthoritySources(in, puckAuthoritySources) {
		return settingsPathAuthority{}, refuse
	}
	// Bash startup injection can supersede argv even with reviewed launcher bytes.
	for _, key := range []string{"PYTHONPATH", "PYTHONHOME", "LD_PRELOAD", "PUCK_SERVER_CONFIG", "BASH_ENV", "ENV", "SHELLOPTS", "BASHOPTS", "BASH_FUNC_exec%%", "BASH_FUNC_pwd%%", "BASH_FUNC_chmod%%"} {
		if in.Env[key] != "" {
			return settingsPathAuthority{}, refuse
		}
	}
	launcher, ok := in.Files["start_server.sh"]
	if !ok || settingsAuthorityHash(launcher) != "b25ebd1f2a1ef052bd35242ea32647b5f9218eddb8477e43a062386d6a64994c" {
		return settingsPathAuthority{}, refuse
	}
	data, ok := in.Files["server_config.json"]
	if !ok {
		return settingsPathAuthority{}, refuse
	}
	if _, err := parsePuckSettings(data); err != nil {
		return settingsPathAuthority{}, refuse
	}
	return settingsAuthorityResult(puckSettingsPath, "puck-file-authority-v1:"+in.Startup), nil
}
