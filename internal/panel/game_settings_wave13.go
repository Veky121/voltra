package panel

// These source adapters preserve native bytes, but their receipts do not prove
// a writable settings schema and active-file authority. Do not interpret their
// CFG/XML/JSON files with the generic editor. Files remains available.
func wave13UnprovenSettings(egg M) bool {
	entry, ok := gameSettingsProfile(egg)
	if !ok {
		return false
	}
	switch entry.Path {
	case "scpsl/exiled/egg-s-c-p--s-l--exiled.json", "the_isle/evrima/egg-the-isle.json", "team_fortress_2_classic/egg-team-fortress-2-classic.json", "terratech_worlds/egg-terra-tech-worlds.json", "tower_unite/egg-tower-unite.json", "voyagers_of_nera/egg-voyagers-of-nera.json", "windrose/egg-windrose.json":
		return true
	}
	return false
}
