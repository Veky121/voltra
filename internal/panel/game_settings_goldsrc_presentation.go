package panel

// Presentation only: the native parser still decides type, editability and
// accepted values. No secret classification or source bytes change here.
func goldSrcCS16SettingPresentation(egg M, file string, field M) {
	if file != goldSrcCS16SettingsPath || !nativeSettingsIsRecipe(egg, "counter_strike/counter_strike_1.6/egg-counter-strike1-6--vanilla.json") {
		return
	}
	key, _ := field["key"].(string)
	labels := map[string]string{
		"mp_timelimit": "Map time limit (minutes)", "mp_winlimit": "Team win limit",
		"mp_maxrounds": "Round limit", "mp_roundtime": "Round duration (minutes)",
		"mp_freezetime": "Freeze duration (seconds)", "mp_buytime": "Buy phase duration (minutes)",
		"mp_startmoney": "Starting money", "mp_footsteps": "Audible footsteps",
		"mp_forcecamera": "Spectator camera", "mp_fadetoblack": "Fade to black after death",
		"mp_friendlyfire": "Friendly fire", "mp_tkpunish": "Punish team killing",
		"mp_autokick": "Automatic player kicks", "mp_hostagepenalty": "Hostage kill penalty",
		"mp_flashlight": "Allow flashlights",
	}
	label, known := labels[key]
	if !known {
		return
	}
	field["label"] = label
	if field["type"] != "number" || field["readonly"] == true || field["secret"] == true {
		return
	}
	if key == "mp_forcecamera" {
		// These three labels/values come from the shipped CS1.6 settings.scr LIST.
		// Preserve noncanonical numeric spellings as numeric inputs rather than
		// displaying a selected value that does not match the underlying field.
		if field["value"] == "0" || field["value"] == "1" || field["value"] == "2" {
			field["type"] = "select"
			field["options"] = []M{
				{"value": "0", "label": "Spectate anyone"},
				{"value": "1", "label": "Spectate teammates only"},
				{"value": "2", "label": "First-person only"},
			}
		}
		return
	}
	spec := goldSrcCS16ScalarSchema()[key]
	field["min"] = spec.minimum
	if spec.maximumLimited {
		field["max"] = spec.maximum
	}
}
