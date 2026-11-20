package panel

import (
	"testing"
	"voltra/internal/gamesettings"
)

func TestCraftopiaManagedCaseAliases(t *testing.T) {
	egg := craftopiaSettingsFixtureEgg(t)
	for _, key := range []string{"GameWorld/name", "GAMEWORLD/NAME", "host/PORT", "Save/savePath", "SAVE/SAVEPATH"} {
		if !gamesettings.RecipeManaged(egg, gamesettings.CraftopiaSettingsPath, key) {
			t.Fatalf("managed alias editable: %s", key)
		}
	}
	for _, key := range []string{"Host/usePassword", "CreativeModeSetting/noDeath", "GameWorld/difficulty"} {
		if gamesettings.RecipeManaged(egg, gamesettings.CraftopiaSettingsPath, key) {
			t.Fatalf("ordinary gameplay field became managed: %s", key)
		}
	}
	if gamesettings.RecipeManaged(M{"name": "Craftopia"}, gamesettings.CraftopiaSettingsPath, "Host/port") {
		t.Fatal("display name grants recipe authority")
	}
}
