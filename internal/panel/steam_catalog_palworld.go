package panel

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"regexp"
	"strconv"
	"strings"
	"voltra/internal/steamapi"
)

var steamPalworldPassword = regexp.MustCompile(`^[\p{L}\p{M}\p{N}_-]+$`)

func steamPalworldValidate(configuration steamCatalogConfiguration) error {
	for _, key := range []string{"ADMIN_PASSWORD", "SERVER_PASSWORD"} {
		value := configuration.Secrets[key]
		if value != "" && !steamPalworldPassword.MatchString(value) {
			return bad("Palworld passwords may contain letters, numbers, underscores and dashes.")
		}
	}
	return nil
}

func steamPalworldVariant(game string) bool {
	return game == "palworld-native" || game == "palworld-proton"
}

func (a *App) steamPalworldNodeAvailable(nodeID int64, game string) bool {
	h := a.connectors()
	h.mu.Lock()
	defer h.mu.Unlock()
	c := h.controls[nodeID]
	return c != nil && c.capabilities[steamapi.PalworldBridgeCapability] && (game != "palworld-proton" || c.capabilities[steamapi.WindowsCapability])
}

func (a *App) steamPalworldConfigurationFiles(ctx context.Context, server M, configuration steamCatalogConfiguration, selected map[string]bool, all bool, extra map[string]string) (map[string][]byte, error) {
	wanted := map[string][]byte{}
	game := "palworld-native"
	if str(configuration.Values["WINDOWS_INSTALL"]) == "1" {
		game = "palworld-proton"
	}
	allocation, err := a.one(ctx, "SELECT ip,port FROM allocations WHERE id=$1 AND server_id=$2", server["allocation_id"], server["id"])
	if err != nil {
		return nil, err
	}
	patch, err := steamPalworldPatch(configuration, num(allocation["port"]), str(allocation["ip"]))
	if err != nil {
		return nil, err
	}
	mapping := map[string][]string{"SERVER_NAME": {"ServerName"}, "SERVER_DESCRIPTION": {"ServerDescription"}, "MAX_PLAYERS": {"ServerPlayerMaxNum"}, "SERVER_PASSWORD": {"ServerPassword"}, "ADMIN_PASSWORD": {"AdminPassword"}, "PUBLIC_IP": {"PublicIP", "PublicPort"}, "RCON_ENABLE": {"RCONEnabled"}, "RCON_PORT": {"RCONPort"}, "ALLOW_CONNECT_PLATFORM": {"CrossplayPlatforms", "AllowConnectPlatform"}}
	patch["AllowConnectPlatform"] = str(configuration.Values["ALLOW_CONNECT_PLATFORM"])
	filtered := map[string]string{}
	for key, targets := range mapping {
		if all || selected[key] {
			for _, target := range targets {
				filtered[target] = patch[target]
			}
		}
	}
	for key, value := range extra {
		filtered[key] = value
	}
	file := steamPalworldSettingsPath(game)
	if len(filtered) > 0 {
		content, exists, err := a.quickSetupRead(ctx, server, file)
		if err != nil {
			return nil, err
		}
		if !exists {
			content, exists, err = a.quickSetupRead(ctx, server, "/DefaultPalWorldSettings.ini")
			if err != nil {
				return nil, err
			}
			if !exists {
				return nil, bad("Steam did not install DefaultPalWorldSettings.ini. Verify the installation before starting.")
			}
		}
		patched, err := quickPatchPalworld(content, filtered)
		if err != nil {
			return nil, err
		}
		wanted[file] = patched
	}
	if all || selected["ADMIN_PASSWORD"] || selected["RCON_PORT"] {
		artifact, err := a.steamCatalogConsoleNodeArtifact(ctx, server)
		if err != nil {
			return nil, err
		}
		launcher, err := steamPalworldConsole(game, num(configuration.Values["RCON_PORT"]), artifact)
		if err != nil {
			return nil, err
		}
		console, err := json.Marshal(M{"default": M{"address": fmt.Sprintf("127.0.0.1:%d", num(configuration.Values["RCON_PORT"])), "password": configuration.Secrets["ADMIN_PASSWORD"], "type": "rcon", "log": ""}})
		if err != nil {
			return nil, err
		}
		if game == "palworld-proton" {
			wanted["/.voltra/palworld-proton-run.sh"] = steamPalworldProtonInner()
		}
		wanted["/.voltra/palworld-start.sh"] = launcher
		wanted["/.voltra/palworld-console.json"] = console
		wanted[steamCatalogConsolePath] = artifact.Binary
		wanted[steamCatalogConsolePath+".manifest.json"] = artifact.Manifest
		wanted[steamCatalogConsolePath+".LICENSE"] = artifact.Licenses
	}
	return wanted, nil
}

func steamPalworldFields(game string) []steamCatalogField {
	fields := []steamCatalogField{
		{Key: "SRCDS_APPID", Label: "Steam app ID", Type: "fixed", Default: "2394010"},
		{Key: "AUTO_UPDATE", Label: "Automatic updates", Type: "boolean", Default: "1"},
		{Key: "MAX_PLAYERS", Label: "Maximum players", Type: "integer", Default: "32", Min: 1, Max: 32},
		{Key: "ADMIN_PASSWORD", Label: "Admin and private console password", Type: "text", Secret: true, Required: true, MaxLength: 30},
		{Key: "PUBLIC_IP", Label: "Advertised public IP", Type: "text"},
		{Key: "SERVER_NAME", Label: "In-game server name", Type: "text", Default: "A Pterodactyl hosted Palworld Server", Required: true, MaxLength: 64},
		{Key: "SERVER_PASSWORD", Label: "Join password", Type: "text", Secret: true, MaxLength: 30},
		{Key: "RCON_PORT", Label: "Private console port", Type: "integer", Default: "25575", Min: 1, Max: 65535},
		{Key: "RCON_ENABLE", Label: "Private console enabled", Type: "fixed", Default: "True"},
		{Key: "SERVER_DESCRIPTION", Label: "Server description", Type: "text", MaxLength: 128},
		{Key: "ALLOW_CONNECT_PLATFORM", Label: "Allowed player platform", Type: "select", Default: "Steam", Options: []string{"Steam", "Xbox"}},
	}
	if game == "palworld-proton" {
		fields = append(fields, steamCatalogField{Key: "WINDOWS_INSTALL", Label: "Windows publisher files", Type: "fixed", Default: "1"})
	}
	return fields
}

func steamPalworldSettingsPath(game string) string {
	if game == "palworld-proton" {
		return "/Pal/Saved/Config/WindowsServer/PalWorldSettings.ini"
	}
	return palworldSettingsPath
}

func steamPalworldPatch(configuration steamCatalogConfiguration, port int64, allocatedIP string) (map[string]string, error) {
	publicIP := str(configuration.Values["PUBLIC_IP"])
	if publicIP == "" {
		publicIP = allocatedIP
	}
	if net.ParseIP(allocatedIP) == nil {
		return nil, bad("The game allocation has no valid IP address.")
	}
	platform := str(configuration.Values["ALLOW_CONNECT_PLATFORM"])
	if platform != "Steam" && platform != "Xbox" {
		return nil, bad("Choose Steam or Xbox players.")
	}
	return map[string]string{
		"ServerName":         quickUnrealQuote(str(configuration.Values["SERVER_NAME"])),
		"ServerDescription":  quickUnrealQuote(str(configuration.Values["SERVER_DESCRIPTION"])),
		"ServerPlayerMaxNum": strconv.FormatInt(configuration.Players, 10),
		"ServerPassword":     quickUnrealQuote(configuration.Secrets["SERVER_PASSWORD"]),
		"AdminPassword":      quickUnrealQuote(configuration.Secrets["ADMIN_PASSWORD"]),
		"PublicIP":           quickUnrealQuote(publicIP), "PublicPort": strconv.FormatInt(port, 10),
		"RCONEnabled": "True", "RCONPort": str(configuration.Values["RCON_PORT"]),
		// Publisher docs deprecate AllowConnectPlatform. The original Steam/Xbox
		// selector now writes the supported one-element CrossplayPlatforms tuple.
		"CrossplayPlatforms": "(" + platform + ")",
	}, nil
}

func (a *App) steamPalworldAfterInstall(ctx context.Context, server, settings M) error {
	game := str(settings["managed_variant"])
	if !steamPalworldVariant(game) {
		return bad("The Palworld runtime variant is missing.")
	}
	file := steamPalworldSettingsPath(game)
	_, exists, err := a.quickSetupRead(ctx, server, file)
	if err != nil {
		return err
	}
	configuration, _, err := a.steamCatalogLoad(ctx, server)
	if err != nil {
		return err
	}
	if exists {
		// An uploaded world/configuration still needs its private console bundle.
		// Preserve unrelated gameplay and original names while establishing the
		// managed admin/console boundary.
		return a.steamCatalogApplyConfiguration(ctx, server, configuration, []string{"ADMIN_PASSWORD", "RCON_PORT", "RCON_ENABLE"})
	}
	return a.steamCatalogApplyConfiguration(ctx, server, configuration, nil)
}

func steamPalworldConsole(game string, port int64, artifact steamCatalogConsolePackage) ([]byte, error) {
	if !steamPalworldVariant(game) || port < 1 || port > 65535 || len(artifact.SHA256) != 64 || len(artifact.Binary) == 0 {
		return nil, bad("Invalid managed Palworld console configuration.")
	}
	preflight := ""
	shutdownSeconds := 15
	command := "./Pal/Binaries/Linux/PalServer-Linux-Shipping Pal"
	file := steamPalworldSettingsPath(game)
	if game == "palworld-proton" {
		var err error
		preflight, err = steamPalworldProtonPreflight()
		if err != nil {
			return nil, err
		}
		command = "/usr/bin/xvfb-run -a /bin/bash .voltra/palworld-proton-run.sh"
		shutdownSeconds = 5
	}
	launcher := fmt.Sprintf(`#!/usr/bin/env bash
set -euo pipefail
cd /home/container
printf '%%s  %%s\n' '%s' '/home/container/.voltra/console-client' | sha256sum -c - >/dev/null
chmod 700 .voltra .voltra/console-client
chmod 600 %s .voltra/palworld-console.json .voltra/console-client.manifest.json .voltra/console-client.LICENSE
%s%s -publiclobby -useperfthreads -NoAsyncLoadingThread -UseMultithreadForDS "-port=${SERVER_PORT}" &
game_pid=$!
stop_game() { .voltra/console-client -t rcon -c .voltra/palworld-console.json Save || true; .voltra/console-client -t rcon -c .voltra/palworld-console.json 'Shutdown %d' || true; wait "$game_pid" || true; }
trap stop_game TERM INT
for ((attempt=0;attempt<300;attempt++)); do
 if ! kill -0 "$game_pid" 2>/dev/null; then wait "$game_pid"; exit 1; fi
 if %s; then break; fi
 sleep 1
done
%s
printf 'VOLTRA_PALWORLD_CONSOLE_READY\n'
# Palworld can close idle RCON sessions. Each input command gets a new
# authenticated connection, matching the original recipe. Never replay a failed
# command: show its error and continue only when another command arrives.
(while IFS= read -r command; do
 [ -n "$command" ] || continue
 .voltra/console-client -t rcon -c .voltra/palworld-console.json "$command" || true
done) <&0 &
console_pid=$!
status=0
wait "$game_pid" || status=$?
kill "$console_pid" 2>/dev/null || true
wait "$console_pid" || true
exit "$status"
`, artifact.SHA256, strings.TrimPrefix(file, "/"), func() string {
		if preflight != "" {
			return preflight + "\n"
		}
		return ""
	}(), command, shutdownSeconds, steamPalworldReadiness(game, port), steamPalworldReadiness(game, port))
	return []byte(launcher), nil
}

func steamPalworldReadiness(game string, port int64) string {
	if game == "palworld-proton" {
		return fmt.Sprintf("timeout 1 bash -c 'exec 3<>/dev/tcp/127.0.0.1/%d' >/dev/null 2>&1", port)
	}
	return fmt.Sprintf("nc -z 127.0.0.1 %d", port)
}

// Quick setup shares the managed control transaction so native files, encrypted
// credentials and startup variables cannot drift after an admin/password edit.
func (a *App) steamPalworldQuickUpdate(ctx context.Context, server M, game, file, revision string, settings M, patch map[string]string) error {
	changes := M{}
	extra := map[string]string{}
	mapping := map[string]string{"ServerName": "SERVER_NAME", "ServerDescription": "SERVER_DESCRIPTION", "ServerPassword": "SERVER_PASSWORD", "AdminPassword": "ADMIN_PASSWORD", "ServerPlayerMaxNum": "MAX_PLAYERS"}
	for key, encoded := range patch {
		if control := mapping[key]; control != "" {
			changes[control] = settings[key]
		} else {
			extra[key] = encoded
		}
	}
	guard := func(ctx context.Context) error {
		content, exists, err := a.quickSetupRead(ctx, server, file)
		if err != nil {
			return err
		}
		if revision != quickRevision(game, file, content, exists) {
			return APIError{409, "QuickSetupRevisionConflict", "These settings changed since you opened Quick setup. Reload before saving."}
		}
		if !exists {
			return APIError{409, "QuickSetupConfigMissing", "The game has not created its configuration yet. Start it once, stop it, then reload Quick setup."}
		}
		return nil
	}
	_, err := a.steamCatalogMutateControls(ctx, server, changes, extra, guard)
	return err
}
