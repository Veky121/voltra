package panel

const paperDifficultyRecipe = "minecraft/java/paper/egg-paper.json"

func paperDifficultyPresentation(field M) {
	if str(field["key"]) == "difficulty" {
		field["label"] = "Difficulty default"
		field["description"] = "Sets the saved difficulty default; existing worlds can keep their current difficulty."
	}
}

func paperDifficultyHelp() M {
	return M{"label": "Existing-world difficulty", "text": "Changing this default may leave an existing world unchanged. Use Console to change the world's difficulty. Run difficulty to check the loaded value."}
}
