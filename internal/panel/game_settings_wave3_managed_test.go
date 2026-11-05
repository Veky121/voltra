package panel

import (
	"strings"
	"testing"
)

func TestWave3ManagedSettingsBoundaries(t *testing.T) {
	for _, tc := range []struct {
		recipe, file string
		keys         []string
		fold         bool
	}{
		{"colony_survival/egg-colony-survival.json", "/server.config.json", []string{"/NewOptions/WorldName", "/LoadOptions/WorldName", "/ServerSettings/ServerName", "/ServerSettings/MaxPlayerCount", "/ServerSettings/ServerGamePort", "/ServerSettings/ServerIP"}, false},
		{"Archean/egg-archean.json", "/Archean-data/server/server.ini", []string{"networking/listen_port"}, true},
		{"assetto_corsa/egg-assetto-corsa.json", "/cfg/server_cfg.ini", []string{"SERVER/UDP_PORT", "SERVER/TCP_PORT", "SERVER/HTTP_PORT"}, true},
		{"assetto_corsa/egg-assetto-corsa--freeroam--a-i.json", "/cfg/server_cfg.ini", []string{"SERVER/UDP_PORT", "SERVER/TCP_PORT", "SERVER/HTTP_PORT"}, true},
		{"conan_exiles/egg-conan-exiles.json", "/ConanSandbox/Saved/Config/WindowsServer/Engine.ini", []string{"URL/Port", "OnlineSubsystem/ServerName", "OnlineSubsystem/ServerPassword", "OnlineSubsystemNull/GameServerQueryPort"}, true},
		{"conan_exiles/egg-conan-exiles-enhanced.json", "/ConanSandbox/Saved/Config/LinuxServer/Game.ini", []string{"RconPlugin/RconEnabled", "RconPlugin/RconPassword", "RconPlugin/RconPort", "/Script/Engine.GameSession/MaxPlayers"}, true},
		{"conan_exiles/egg-conan-exiles.json", "/ConanSandbox/Saved/Config/WindowsServer/ServerSettings.ini", []string{"ServerSettings/AdminPassword", "ServerSettings/ServerPassword"}, true},
	} {
		t.Run(tc.recipe+tc.file, func(t *testing.T) {
			var egg M
			for _, entry := range gameTemplates().Entries {
				if entry.Path == tc.recipe {
					egg = M{"uuid": gameTemplateEggUUID(entry)}
				}
			}
			if egg == nil {
				t.Fatal("missing recipe")
			}
			for _, key := range tc.keys {
				keys := []string{key}
				if tc.fold {
					keys = append(keys, strings.ToUpper(key))
				}
				for _, candidate := range keys {
					if !gameSettingManaged(egg, tc.file, candidate) {
						t.Fatalf("editable managed value %s", candidate)
					}
					if _, err := gameSettingsChanges([]gameSetting{{key: candidate, kind: "text"}}, M{candidate: "changed"}, egg, tc.file); err == nil {
						t.Fatal("managed patch accepted")
					}
					if gameSettingsRecipeManaged(egg, "/unrelated.ini", candidate) || gameSettingsRecipeManaged(M{"name": "Conan Exiles"}, tc.file, candidate) {
						t.Fatal("guard escaped recipe/document")
					}
				}
			}
			if gameSettingManaged(egg, tc.file, "Gameplay/NativeOption") {
				t.Fatal("unrelated gameplay field blocked")
			}
		})
	}
}
