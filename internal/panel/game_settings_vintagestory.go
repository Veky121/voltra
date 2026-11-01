package panel

const vintageStorySettingsPath = "/data/serverconfig.json"
const vintageStorySettingsRecipe = "vintage_story/egg-vintage-story.json"

// Presentation-only normalization for three publisher-proven nullable strings.
// Keep the original JSON nodes and patch closure so null-to-string writes,
// secret handling and unknown native values retain the shared implementation.
func vintageStoryNullableSettings(egg M, file string, parsed gameSettingsParsed) gameSettingsParsed {
	if file != vintageStorySettingsPath || !nativeSettingsIsRecipe(egg, vintageStorySettingsRecipe) {
		return parsed
	}
	for i := range parsed.fields {
		field := &parsed.fields[i]
		switch field.key {
		case "/Password", "/ServerDescription", "/ServerUrl":
			if field.node != nil && field.node.Tag == "!!null" {
				field.value, field.kind = "", "text"
				if field.key == "/Password" {
					field.secret = true
				}
			}
		}
	}
	return parsed
}
