package panel

import (
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io/fs"
	"strings"
)

const fs25Path = "farming-simulator/egg-farming-simulator-25.json"
const fs25Revision = "3ad302f2a67726567a534c964cc423c76d2d1d88"
const fs25Source = "https://github.com/nn-home-com/farming-simulator-25-egg/blob/" + fs25Revision + "/egg-farming-simulator-25.json"

const fs25ReadyPattern = `regex:^\[Server\]\s+\[\d{2}/[A-Za-z]{3}/\d{4}:\d{2}:\d{2}:\d{2}\]\s+Game server started\s*$`

//go:embed game_library/fs25
var fs25Files embed.FS

func farmingSimulatorTemplate() gameTemplate {
	raw, _ := fs25Files.ReadFile("game_library/fs25/upstream-egg.json")
	egg := M{}
	if err := json.Unmarshal(raw, &egg); err != nil {
		panic(err)
	}
	script := "#!/bin/bash\nset -euo pipefail\numask 077\ncd /mnt/server\nmkdir -p installer dlc data/mods data/pdlc .voltra/fs25\n"
	err := fs.WalkDir(fs25Files, "game_library/fs25", func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() || strings.HasSuffix(path, "upstream-egg.json") {
			return nil
		}
		body, err := fs25Files.ReadFile(path)
		if err != nil {
			return err
		}
		relative := strings.TrimPrefix(path, "game_library/fs25/")
		if i := strings.LastIndex(relative, "/"); i >= 0 {
			script += "mkdir -p '.voltra/fs25/" + relative[:i] + "'\n"
		}
		digest := sha256.Sum256(body)
		delimiter := "VOLTRA_" + hex.EncodeToString(digest[:])
		script += fmt.Sprintf("cat > '.voltra/fs25/%s' <<'%s'\n%s\n%s\n", relative, delimiter, string(body), delimiter)
		return nil
	})
	if err != nil {
		panic(err)
	}
	script += "echo 'FS25 prepared. Start from Console to download and activate your licensed game.'\n"
	egg["startup"] = "bash .voltra/fs25/start.sh"
	egg["docker_images"] = M{"WineHQ 11 (pinned)": "ghcr.io/nn-home-com/farming-simulator-25-egg@sha256:10073fd00ab197e36c45dd8af94ca297c04ae2a4288d4b3bd65c16aa468b8dc8"}
	egg["scripts"] = M{"installation": M{"script": script, "container": "debian:bookworm-slim", "entrypoint": "bash"}}
	egg["features"] = []any{"voltra_fs25"}
	egg["config"] = M{"files": "{}", "startup": M{"done": fs25ReadyPattern, "strip_ansi": true}, "logs": "{}", "stop": "^C"}
	egg["description"] = "GIANTS-licensed FS25 server under Wine. Downloads from GIANTS or accepts an uploaded installer. Separate server licence required."
	vars := asSlice(egg["variables"])
	for _, raw := range vars {
		v := asMap(raw)
		if str(v["env_variable"]) != "GAME_SERIAL" && str(v["env_variable"]) != "DLC_PRODUCT_KEY" {
			v["user_editable"] = true
		}
		switch str(v["env_variable"]) {
		case "GAME_SERIAL":
			v["name"] = "GIANTS server licence"
			v["description"] = "Saved encrypted. Blank uses the configured admin licence."
			v["user_viewable"], v["user_editable"] = false, false
		case "AUTO_DOWNLOAD":
			v["description"] = "Download from GIANTS. Turn off to upload an installer instead."
		case "DOWNLOAD_DLC":
			v["default_value"] = "false"
			v["description"] = "Download owned DLCs on start. Players need matching content."
		case "WEB_PASSWORD":
			v["default_value"] = ""
			v["rules"] = "required|string|min:12|max:64"
			v["description"] = "Choose a strong web manager password."
		case "WEB_PORT":
			v["default_value"] = ""
			v["rules"] = "nullable|integer|between:1024,65535"
		case "KEEP_INSTALLER", "AUTO_SAVE_INTERVAL", "STATS_INTERVAL", "PAUSE_IF_EMPTY", "SAVEGAME_INDEX", "SERVER_LANGUAGE", "WEB_USERNAME", "ADMIN_PASSWORD", "GAME_PASSWORD":
			v["user_viewable"] = true
		case "MAP_ID":
			v["description"] = "Base-game or installed mod map ID."
		}
	}
	vars = append(vars, M{"name": "Admin DLC licences", "description": "Encrypted admin-managed DLC credentials. Downloads are matched to their own licence.", "env_variable": "DLC_PRODUCT_KEY", "default_value": "", "user_viewable": false, "user_editable": false, "rules": "nullable|string|max:16384"}, M{"name": "DLC timeout (seconds)", "description": "Maximum time per DLC before reporting failure. Increase for large packs.", "env_variable": "DLC_TIMEOUT", "default_value": "900", "user_viewable": true, "user_editable": true, "rules": "required|integer|between:60,7200"})
	egg["variables"] = vars
	body, _ := json.Marshal(egg)
	sum := sha256.Sum256(body)
	id := sha256.Sum256([]byte(fs25Path))
	return gameTemplate{ID: hex.EncodeToString(id[:8]), Path: fs25Path, SHA256: hex.EncodeToString(sum[:]), Profile: "fs25-reviewed-v1", Egg: egg, Defaults: M{"memory": 6144, "disk": 102400}, Platforms: []string{"linux/amd64"}, RequiredPorts: 2,
		PortRules:    []templatePortRule{{Environment: "WEB_PORT", Minimum: 1024, Maximum: 65535, Count: 2, Condition: "nonzero", AllocatedValue: true, ExcludePrimary: true, AutoAllocate: true}},
		Verification: "runtime_unverified", Detail: "Reviewed source and hardened installer. Licensed game activation and DLC gameplay have not been verified by Voltra.",
		SetupSteps: []string{"Use a separate GIANTS server licence. Steam player purchases do not supply the required server serial.", "Start from Console after preparation. GIANTS downloads, Wine installation and activation run on first start. Allow at least 100 GiB for temporary files.", "Administrators save game and DLC licences in Admin integrations, then apply them under server Runtime. Each pack downloads and activates with its matching key.", "Check game logs for loaded DLCs and test joining with matching client content. A file or web-manager colour alone does not prove a DLC works."}}
}

func fs25Secret(name string) bool {
	return name == "GAME_SERIAL" || name == "DLC_PRODUCT_KEY" || name == "WEB_PASSWORD" || name == "ADMIN_PASSWORD" || name == "GAME_PASSWORD"
}
