package panel

import (
	"testing"
	"voltra/internal/gamesettings"
)

func TestWave85ManagedScope(t *testing.T) {
	asa := batchSettingsRecipeFixture(t, gamesettings.ArkAscendedRecipe)
	ase := batchSettingsRecipeFixture(t, gamesettings.ArkEvolvedRecipe)
	for _, key := range []string{"/Script/Engine.GameSession/MaxPlayers", "ServerSettings/ActiveMods", "ServerSettings/RCONEnabled"} {
		if gamesettings.ArkEvolvedSettingManaged(asa, gamesettings.ArkAscendedSettingsPath, key) || gamesettings.ArkEvolvedSettingManaged(ase, gamesettings.ArkAscendedSettingsPath, key) || !gamesettings.ArkEvolvedSettingManaged(ase, gamesettings.ArkEvolvedSettingsPath, key) {
			t.Fatal("managed scope drift")
		}
	}
	for _, key := range []string{"SessionSettings/SessionName", "ServerSettings/ServerPassword", "ServerSettings/ServerPVE"} {
		if gamesettings.ArkEvolvedSettingManaged(ase, gamesettings.ArkEvolvedSettingsPath, key) {
			t.Fatal("native authority lost")
		}
	}
}
