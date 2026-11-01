package panel

const gameSettingsProfileSnapshotKey = "_game_settings_profile_snapshot"

type gameSettingsProfileSnapshot struct {
	uuid, startup string
	entry         gameTemplate
	found         bool
}

// Field presentation dispatches through many recipe-specific rules. Resolve the
// immutable embedded recipe once per GET instead of scanning and hashing the
// entire catalog for every rule on every field. Native bytes, permissions and
// authority checks remain fresh; mutation requests never use this snapshot.
func withGameSettingsProfileSnapshot(egg M) M {
	copy := make(M, len(egg)+1)
	for key, value := range egg {
		copy[key] = value
	}
	entry, found := gameSettingsProfileFrom(egg, gameTemplates().Entries)
	copy[gameSettingsProfileSnapshotKey] = gameSettingsProfileSnapshot{str(egg["uuid"]), str(egg["startup"]), entry, found}
	return copy
}
