package gamesettings

// These source adapters preserve native bytes, but their receipts do not prove
// a writable settings schema and active-file authority. Do not interpret their
// CFG/XML/JSON files with the generic editor. Files remains available.
func UnprovenSettingsA(egg M) bool {
	entry, ok := ProfileFor(egg)
	if !ok {
		return false
	}
	switch entry.Path {
	case "risk_of_rain_2/egg-risk-of-rain2.json", "sunkenland/egg-sunkenland.json", "the_forest/egg-the-forest.json", "truck-simulator/euro-truck-simulator2/egg-euro-truck-simulator2-dedicated-server.json", "subnautica_nitrox_mod/egg-subnautica.json", "space_engineers/torch/egg-space-engineers--torch-server.json", "stationeers/stationeers_bepinex/egg-stationeers--bep-in-ex.json", "truck-simulator/american-truck-simulator/egg-american-truck-simulator-dedicated-server.json":
		return true
	}
	return false
}

// These source adapters preserve native bytes, but their receipts do not prove
// a writable settings schema and active-file authority. Do not interpret their
// CFG/XML/JSON files with the generic editor. Files remains available.
func UnprovenSettingsB(egg M) bool {
	entry, ok := ProfileFor(egg)
	if !ok {
		return false
	}
	switch entry.Path {
	case "scpsl/exiled/egg-s-c-p--s-l--exiled.json", "the_isle/evrima/egg-the-isle.json", "team_fortress_2_classic/egg-team-fortress-2-classic.json", "terratech_worlds/egg-terra-tech-worlds.json", "tower_unite/egg-tower-unite.json", "voyagers_of_nera/egg-voyagers-of-nera.json", "windrose/egg-windrose.json":
		return true
	}
	return false
}
