package gamesettings

const VintageStorySettingsPath = "/data/serverconfig.json"
const VintageStorySettingsRecipe = "vintage_story/egg-vintage-story.json"

// Presentation-only normalization for three publisher-proven nullable strings.
// Keep the original JSON nodes and patch closure so null-to-string writes,
// secret handling and unknown native values retain the shared implementation.
func VintageStoryNullableSettings(egg M, file string, parsed Parsed) Parsed {
	if file != VintageStorySettingsPath || !IsRecipe(egg, VintageStorySettingsRecipe) {
		return parsed
	}
	for i := range parsed.Fields {
		field := &parsed.Fields[i]
		switch field.Key {
		case "/Password", "/ServerDescription", "/ServerUrl":
			if field.Node != nil && field.Node.Tag == "!!null" {
				field.Value, field.Kind = "", "text"
				if field.Key == "/Password" {
					field.Secret = true
				}
			}
		}
	}
	return parsed
}
