package panel

import "testing"

func TestCraftopiaManagedCaseAliases(t *testing.T) {
	egg := craftopiaSettingsFixtureEgg(t)
	for _, key := range []string{"GameWorld/name", "GAMEWORLD/NAME", "host/PORT", "Save/savePath", "SAVE/SAVEPATH"} {
		if !gameSettingsRecipeManaged(egg, craftopiaSettingsPath, key) {
			t.Fatalf("managed alias editable: %s", key)
		}
	}
	for _, key := range []string{"Host/usePassword", "CreativeModeSetting/noDeath", "GameWorld/difficulty"} {
		if gameSettingsRecipeManaged(egg, craftopiaSettingsPath, key) {
			t.Fatalf("ordinary gameplay field became managed: %s", key)
		}
	}
	if gameSettingsRecipeManaged(M{"name": "Craftopia"}, craftopiaSettingsPath, "Host/port") {
		t.Fatal("display name grants recipe authority")
	}
}
