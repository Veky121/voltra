package panel

// These source adapters preserve native bytes, but their receipts do not prove
// a writable settings schema and active-file authority. Do not interpret their
// CFG/XML/JSON files with the generic editor. Files remains available.
func wave12UnprovenSettings(egg M) bool {
	entry, ok := gameSettingsProfile(egg)
	if !ok {
		return false
	}
	switch entry.Path {
	case "risk_of_rain_2/egg-risk-of-rain2.json", "sunkenland/egg-sunkenland.json", "the_forest/egg-the-forest.json", "truck-simulator/euro-truck-simulator2/egg-euro-truck-simulator2-dedicated-server.json", "subnautica_nitrox_mod/egg-subnautica.json", "space_engineers/torch/egg-space-engineers--torch-server.json", "stationeers/stationeers_bepinex/egg-stationeers--bep-in-ex.json", "truck-simulator/american-truck-simulator/egg-american-truck-simulator-dedicated-server.json":
		return true
	}
	return false
}
