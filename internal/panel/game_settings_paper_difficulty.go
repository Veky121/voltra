package panel

const paperDifficultyRecipe = "minecraft/java/paper/egg-paper.json"

func paperDifficultyPresentation(field M) {
	if str(field["key"]) == "difficulty" {
		field["label"] = "Difficulty for new worlds"
		field["help"] = "Existing worlds keep their saved difficulty; use Console to change it and run difficulty to check the loaded value."
		field["description"] = field["help"]
	}
}

func paperDifficultyHelp() M {
	return M{"label": "Existing-world difficulty", "text": "Changing this default may leave an existing world unchanged. Use Console to change the world's difficulty. Run difficulty to check the loaded value."}
}
