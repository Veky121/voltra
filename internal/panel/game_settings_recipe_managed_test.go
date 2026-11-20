package panel

import (
	"testing"
	"voltra/internal/gamesettings"
)

func TestGameSettingsRecipeListeners(t *testing.T) {
	for _, tc := range []struct {
		recipe string
		file   string
		keys   []string
	}{
		{"among_us/impostor_server/egg-among-us--impostor-server.json", "/impostor/config.json", []string{"/Server/ListenIp", "/Server/ListenPort", "/HttpServer/ListenIp", "/HttpServer/ListenPort"}},
		{"beamng/kissmp/egg-kissmp.json", "/config.json", []string{"/port"}},
	} {
		t.Run(tc.recipe, func(t *testing.T) {
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
				if !gamesettings.SettingManaged(egg, tc.file, key) {
					t.Fatalf("editable listener %s", key)
				}
				fields := []gamesettings.Setting{{Key: key, Kind: "text"}}
				if _, err := gamesettings.Changes(fields, M{key: "other"}, egg, tc.file); err == nil {
					t.Fatal("listener patch accepted")
				}
				if gamesettings.RecipeManaged(egg, "/other.json", key) || gamesettings.RecipeManaged(M{"name": "Impostor"}, tc.file, key) {
					t.Fatal("guard escaped its recipe/document")
				}
			}
			if gamesettings.SettingManaged(egg, "/config.json", "/gameplay/port") {
				t.Fatal("unrelated gameplay key blocked")
			}
		})
	}
}
