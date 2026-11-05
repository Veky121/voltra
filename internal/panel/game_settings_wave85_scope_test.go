package panel

import "testing"

func TestWave85ManagedScope(t *testing.T) {
	asa := batchSettingsRecipeFixture(t, wave85ASA)
	ase := batchSettingsRecipeFixture(t, wave85ASE)
	for _, key := range []string{"/Script/Engine.GameSession/MaxPlayers", "ServerSettings/ActiveMods", "ServerSettings/RCONEnabled"} {
		if wave85ASEManaged(asa, wave85ASAFile, key) || wave85ASEManaged(ase, wave85ASAFile, key) || !wave85ASEManaged(ase, wave85ASEFile, key) {
			t.Fatal("managed scope drift")
		}
	}
	for _, key := range []string{"SessionSettings/SessionName", "ServerSettings/ServerPassword", "ServerSettings/ServerPVE"} {
		if wave85ASEManaged(ase, wave85ASEFile, key) {
			t.Fatal("native authority lost")
		}
	}
}
