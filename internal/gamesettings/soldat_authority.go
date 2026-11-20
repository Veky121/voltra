package gamesettings

const SoldatClassicRecipe = "soldat/egg-soldat.json"
const Soldat2Recipe = "soldat_2/egg-soldat2.json"
const soldatClassicStartup = "exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/soldat-classic-native.py run"
const soldat2Startup = "exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/soldat-native.py run soldat2"

func soldatSettingsRecipe(egg M) bool {
	return IsRecipe(egg, SoldatClassicRecipe) || IsRecipe(egg, Soldat2Recipe)
}
func soldatSettingsAuthority(s, egg M) bool {
	expected := soldatClassicStartup
	if IsRecipe(egg, Soldat2Recipe) {
		expected = soldat2Startup
	}
	return str(egg["startup"]) == expected && str(s["startup"]) == expected
}
func soldatSettingsDocument(egg M, file string) bool {
	if IsRecipe(egg, SoldatClassicRecipe) {
		return str(egg["startup"]) == soldatClassicStartup && (file == "/soldat.ini" || file == "/server.ini")
	}
	return IsRecipe(egg, Soldat2Recipe) && str(egg["startup"]) == soldat2Startup && file == "/autoconfig.ini"
}
